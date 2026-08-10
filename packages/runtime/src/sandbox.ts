import { spawn } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as macProfile from "./macos-sandbox-profile.js";
import { probeMacOsSandboxAvailability } from "./macos-sandbox-availability.js";
import { createParentGuardedTerminalLaunch } from "./process-guardian.js";
import { CONTAINER_IMAGE_ENV } from "./sandbox-container.js";
import { HostDirectSandboxAdapter } from "./sandbox-host-direct.js";
import {
  scopedWorkspaceWritePaths,
  validateLaunchRequest,
} from "./sandbox-launch-policy.js";
import { OciContainerSandboxAdapter } from "./sandbox-oci.js";
import { launchSandboxProcess } from "./sandbox-process-lifecycle.js";
import type {
  OsSandboxAdapter,
  PlatformSandboxOptions,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
import { launchTerminalSandboxWrapper } from "./sandbox-terminal.js";
import { UnsupportedSandboxAdapter } from "./unsupported-sandbox.js";

export type {
  OsSandboxAdapter,
  PlatformSandboxOptions,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
export { UnsupportedSandboxAdapter } from "./unsupported-sandbox.js";
export {
  buildOciContainerArgs,
  OciContainerSandboxAdapter,
} from "./sandbox-oci.js";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const BUBBLEWRAP_EXEC = "/usr/bin/bwrap";
const LINUX_RUNTIME_READ_PATHS = [
  "/lib",
  "/lib64",
  "/usr/lib",
  "/usr/lib64",
  "/usr/local/lib",
  "/usr/local/share",
  "/usr/share",
  "/etc",
] as const;

export function createPlatformSandboxAdapter(
  platform = process.platform,
  options: PlatformSandboxOptions = {},
): OsSandboxAdapter {
  const containerImage =
    options.containerImage ?? process.env[CONTAINER_IMAGE_ENV];
  if (containerImage && (options.preferContainer || platform !== "linux")) {
    return new OciContainerSandboxAdapter(containerImage, {
      ...(options.containerExecutable
        ? { executable: options.containerExecutable }
        : {}),
    });
  }
  if (HostDirectSandboxAdapter.enabled()) return new HostDirectSandboxAdapter();
  if (platform === "darwin") return new MacOsSandboxAdapter();
  if (platform === "linux") return new LinuxBubblewrapSandboxAdapter();
  return new UnsupportedSandboxAdapter(platform);
}

export class MacOsSandboxAdapter implements OsSandboxAdapter {
  readonly id = "macos-sandbox-exec";
  private availability: Promise<void> | undefined;

  constructor(
    private readonly executable = SANDBOX_EXEC,
    private readonly spawnProcess = spawn,
    private readonly availabilityCheck = () =>
      probeMacOsSandboxAvailability(executable, spawnProcess),
  ) {}

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    validateLaunchRequest(request);
    try {
      await access(this.executable);
    } catch {
      throw new Error(
        `macOS process sandbox requires sandbox-exec at ${this.executable}`,
      );
    }
    this.availability ??= this.availabilityCheck();
    await this.availability;
    const sandboxHome = await mkdtemp(
      path.join(tmpdir(), "napier-process-sandbox-"),
    );
    const profile = buildMacOsSandboxProfile(request, sandboxHome);
    const target = {
      command: this.executable,
      args: ["-p", profile, "--", request.command, ...request.args],
      cwd: request.cwd,
      env: {
        ...request.env,
        HOME: sandboxHome,
        TMPDIR: sandboxHome,
      },
    };
    if (request.terminal) {
      const launch = request.parentDeathGuard
        ? createParentGuardedTerminalLaunch(target)
        : target;
      return launchTerminalSandboxWrapper({
        ...launch,
        columns: request.terminal.columns,
        rows: request.terminal.rows,
        sandboxHome,
      });
    }
    return launchSandboxProcess({
      ...target,
      sandboxHome,
      parentDeathGuard: request.parentDeathGuard === true,
      spawnProcess: this.spawnProcess,
    });
  }
}

export class LinuxBubblewrapSandboxAdapter implements OsSandboxAdapter {
  readonly id = "linux-bubblewrap";

  constructor(
    private readonly executable = BUBBLEWRAP_EXEC,
    private readonly spawnProcess = spawn,
  ) {}

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    validateLaunchRequest(request);
    try {
      await access(this.executable);
    } catch {
      throw new Error(
        `Linux process sandbox requires Bubblewrap at ${this.executable}`,
      );
    }
    const sandboxHome = await mkdtemp(
      path.join(tmpdir(), "napier-process-sandbox-"),
    );
    const args = buildLinuxBubblewrapArgs(request, sandboxHome);
    const target = {
      command: this.executable,
      args,
      cwd: "/",
      env: {
        ...request.env,
        HOME: "/tmp",
        TMPDIR: "/tmp",
      },
    };
    if (request.terminal) {
      return launchTerminalSandboxWrapper({
        ...target,
        columns: request.terminal.columns,
        rows: request.terminal.rows,
        sandboxHome,
      });
    }
    return launchSandboxProcess({
      ...target,
      sandboxHome,
      parentDeathGuard: false,
      spawnProcess: this.spawnProcess,
    });
  }
}

export function buildMacOsSandboxProfile(
  request: SandboxLaunchRequest,
  sandboxHome: string,
): string {
  validateLaunchRequest(request);
  const capabilities = new Set(request.approvedCapabilities);
  const writePaths = scopedWorkspaceWritePaths(request);
  const metadataPaths = destinationDirectories([
    path.dirname(request.command),
    request.workspaceRoot,
    request.cwd,
    sandboxHome,
    ...(request.runtimeReadPaths ?? []),
  ]);
  const rules = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    ...macProfile.processExecRules(request.command, request.runtimeReadPaths),
    "(allow signal (target self))",
    "(allow sysctl-read)",
    '(allow mach-lookup (global-name "com.apple.system.logger"))',
    '(allow file-read-data (literal "/"))',
    "(allow file-read-metadata",
    ...metadataPaths.map(
      (directory) => `  (literal ${macProfile.literal(directory)})`,
    ),
    ")",
    "(allow file-read*",
    '  (subpath "/System")',
    '  (subpath "/usr/lib")',
    '  (subpath "/private/etc")',
    `  (literal ${macProfile.literal(request.command)})`,
    ")",
    `(allow file-read* file-write* (subpath ${macProfile.literal(sandboxHome)}))`,
  ];
  if (
    capabilities.has("workspace.read") ||
    capabilities.has("workspace.write")
  ) {
    rules.push(
      `(allow file-read* (subpath ${macProfile.literal(request.workspaceRoot)}))`,
    );
  }
  for (const runtimePath of request.runtimeReadPaths ?? []) {
    rules.push(
      `(allow file-read* (subpath ${macProfile.literal(runtimePath)}))`,
    );
  }
  if (capabilities.has("workspace.write")) {
    for (const writePath of writePaths.length > 0
      ? writePaths
      : [request.workspaceRoot]) {
      rules.push(
        `(allow file-write* (subpath ${macProfile.literal(writePath)}))`,
      );
    }
  }
  if (capabilities.has("network.connect")) {
    rules.push("(allow network-outbound)");
  }
  return rules.join("\n");
}

export function buildLinuxBubblewrapArgs(
  request: SandboxLaunchRequest,
  sandboxHome: string,
): string[] {
  validateLaunchRequest(request);
  if (!path.isAbsolute(sandboxHome)) {
    throw new Error("Linux sandbox home must be absolute");
  }
  const capabilities = new Set(request.approvedCapabilities);
  const writePaths = scopedWorkspaceWritePaths(request);
  const workspaceMounted =
    capabilities.has("workspace.read") || capabilities.has("workspace.write");
  const directories = destinationDirectories([
    path.dirname(request.command),
    ...(workspaceMounted ? [request.workspaceRoot] : []),
    ...(request.runtimeReadPaths ?? []),
    ...LINUX_RUNTIME_READ_PATHS,
  ]);
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    ...(capabilities.has("network.connect") ? ["--share-net"] : []),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    sandboxHome,
    "/tmp",
    ...directories.flatMap((directory) => ["--dir", directory]),
  ];
  for (const runtimePath of LINUX_RUNTIME_READ_PATHS) {
    args.push("--ro-bind-try", runtimePath, runtimePath);
  }
  if (workspaceMounted) {
    args.push(
      capabilities.has("workspace.write") && writePaths.length === 0
        ? "--bind"
        : "--ro-bind",
      request.workspaceRoot,
      request.workspaceRoot,
    );
    for (const writePath of writePaths) {
      args.push("--bind", writePath, writePath);
    }
  }
  for (const runtimePath of request.runtimeReadPaths ?? []) {
    args.push("--ro-bind", runtimePath, runtimePath);
  }
  args.push(
    "--ro-bind",
    request.command,
    request.command,
    "--chdir",
    workspaceMounted ? request.cwd : "/tmp",
    "--",
    request.command,
    ...request.args,
  );
  return args;
}

function destinationDirectories(targets: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const target of targets) {
    let current = path.resolve(target);
    while (current !== path.parse(current).root) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return [...directories].sort((left, right) => {
    const depthDelta = pathDepth(left) - pathDepth(right);
    return depthDelta || left.localeCompare(right);
  });
}

function pathDepth(value: string): number {
  return value.split(path.sep).filter(Boolean).length;
}

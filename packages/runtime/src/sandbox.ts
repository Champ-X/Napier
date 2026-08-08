import { spawn } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { probeMacOsSandboxAvailability } from "./macos-sandbox-availability.js";
import { createParentGuardedTerminalLaunch } from "./process-guardian.js";
import {
  containerScratchBaseDir,
  CONTAINER_IMAGE_ENV,
  resolveContainerLaunchExecutable,
  validateContainerEnvName,
  validateContainerImage,
} from "./sandbox-container.js";
import { HostDirectSandboxAdapter } from "./sandbox-host-direct.js";
import { launchSandboxProcess } from "./sandbox-process-lifecycle.js";
import type {
  OsSandboxAdapter,
  PlatformSandboxOptions,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
import {
  launchTerminalSandboxWrapper,
  validateTerminalDimensions,
} from "./sandbox-terminal.js";
import { UnsupportedSandboxAdapter } from "./unsupported-sandbox.js";

export type {
  OsSandboxAdapter,
  PlatformSandboxOptions,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
export { UnsupportedSandboxAdapter } from "./unsupported-sandbox.js";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const BUBBLEWRAP_EXEC = "/usr/bin/bwrap";
const MAX_RUNTIME_READ_PATHS = 8;
const MAX_WORKSPACE_WRITE_PATHS = 8;
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

export class OciContainerSandboxAdapter implements OsSandboxAdapter {
  readonly id = "oci-container";
  private readonly executable: string | undefined;

  constructor(
    private readonly image: string,
    options: { executable?: string; spawnProcess?: typeof spawn } = {},
  ) {
    this.executable = options.executable;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  private readonly spawnProcess: typeof spawn;

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    validateLaunchRequest(request);
    if (request.terminal) {
      throw new Error(
        "OCI PTY launch requires image-bound terminal runtime support",
      );
    }
    if (request.parentDeathGuard) {
      throw new Error(
        "OCI parent-death guarding requires container runtime identity binding",
      );
    }
    validateContainerImage(this.image);
    const executable = await resolveContainerLaunchExecutable(this.executable);
    const sandboxHome = await mkdtemp(
      path.join(await containerScratchBaseDir(), "napier-process-sandbox-"),
    );
    const args = buildOciContainerArgs(request, sandboxHome, this.image);
    return launchSandboxProcess({
      command: executable,
      args,
      cwd: "/",
      env: containerProcessEnv(request.env),
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
    `(allow process-exec (literal ${sandboxLiteral(request.command)}))`,
    "(allow signal (target self))",
    "(allow sysctl-read)",
    '(allow mach-lookup (global-name "com.apple.system.logger"))',
    '(allow file-read-data (literal "/"))',
    "(allow file-read-metadata",
    ...metadataPaths.map(
      (directory) => `  (literal ${sandboxLiteral(directory)})`,
    ),
    ")",
    "(allow file-read*",
    '  (subpath "/System")',
    '  (subpath "/usr/lib")',
    '  (subpath "/private/etc")',
    `  (literal ${sandboxLiteral(request.command)})`,
    ")",
    `(allow file-read* file-write* (subpath ${sandboxLiteral(sandboxHome)}))`,
  ];
  if (
    capabilities.has("workspace.read") ||
    capabilities.has("workspace.write")
  ) {
    rules.push(
      `(allow file-read* (subpath ${sandboxLiteral(request.workspaceRoot)}))`,
    );
  }
  for (const runtimePath of request.runtimeReadPaths ?? []) {
    rules.push(`(allow file-read* (subpath ${sandboxLiteral(runtimePath)}))`);
  }
  if (capabilities.has("workspace.write")) {
    for (const writePath of writePaths.length > 0
      ? writePaths
      : [request.workspaceRoot]) {
      rules.push(`(allow file-write* (subpath ${sandboxLiteral(writePath)}))`);
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

export function buildOciContainerArgs(
  request: SandboxLaunchRequest,
  sandboxHome: string,
  image: string,
): string[] {
  validateLaunchRequest(request);
  if (!path.isAbsolute(sandboxHome)) {
    throw new Error("Container sandbox home must be absolute");
  }
  validateContainerImage(image);
  const capabilities = new Set(request.approvedCapabilities);
  const writePaths = scopedWorkspaceWritePaths(request);
  const workspaceMounted =
    capabilities.has("workspace.read") || capabilities.has("workspace.write");
  const args = [
    "run",
    "--rm",
    "--init",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "1g",
    "--cpus",
    "2",
    "--network",
    capabilities.has("network.connect") ? "bridge" : "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--mount",
    bindMount(sandboxHome, "/tmp", false),
    "--workdir",
    workspaceMounted ? request.cwd : "/tmp",
    "--env",
    "HOME=/tmp",
    "--env",
    "TMPDIR=/tmp",
  ];
  for (const key of Object.keys(request.env).sort()) {
    validateContainerEnvName(key);
    args.push("--env", key);
  }
  if (workspaceMounted) {
    args.push(
      "--mount",
      bindMount(
        request.workspaceRoot,
        request.workspaceRoot,
        !capabilities.has("workspace.write") || writePaths.length > 0,
      ),
    );
    for (const writePath of writePaths) {
      args.push("--mount", bindMount(writePath, writePath, false));
    }
  }
  for (const runtimePath of request.runtimeReadPaths ?? []) {
    args.push("--mount", bindMount(runtimePath, runtimePath, true));
  }
  args.push(image, request.command, ...request.args);
  return args;
}

function validateLaunchRequest(request: SandboxLaunchRequest): void {
  if (!path.isAbsolute(request.command)) {
    throw new Error("Sandboxed commands must use an absolute executable path");
  }
  if (!path.isAbsolute(request.cwd)) {
    throw new Error("Sandboxed process cwd must be absolute");
  }
  if (!path.isAbsolute(request.workspaceRoot)) {
    throw new Error("Sandbox workspace root must be absolute");
  }
  if (!isPathInside(request.cwd, request.workspaceRoot)) {
    throw new Error("Sandboxed process cwd must stay inside the workspace");
  }
  if (!request.approvedCapabilities.includes("process.spawn")) {
    throw new Error("Sandbox launch requires approved process.spawn");
  }
  if (
    request.approvedCapabilities.includes("workspace.write") &&
    !request.approvedCapabilities.includes("workspace.read")
  ) {
    throw new Error("workspace.write requires workspace.read");
  }
  scopedWorkspaceWritePaths(request);
  if (
    request.runtimeReadPaths !== undefined &&
    (request.runtimeReadPaths.length > MAX_RUNTIME_READ_PATHS ||
      request.runtimeReadPaths.some(
        (runtimePath) =>
          !path.isAbsolute(runtimePath) ||
          path.resolve(runtimePath) === path.parse(runtimePath).root ||
          /[\u0000-\u001f\u007f]/u.test(runtimePath),
      ))
  ) {
    throw new Error(
      `Sandbox runtime read paths must contain at most ${MAX_RUNTIME_READ_PATHS} absolute non-root paths`,
    );
  }
  validateTerminalDimensions(request.terminal);
}

function scopedWorkspaceWritePaths(request: SandboxLaunchRequest): string[] {
  const paths = request.workspaceWritePaths ?? [];
  if (
    paths.length > 0 &&
    !request.approvedCapabilities.includes("workspace.write")
  ) {
    throw new Error("Sandbox workspace write paths require workspace.write");
  }
  if (
    paths.length > MAX_WORKSPACE_WRITE_PATHS ||
    paths.some(
      (writePath) =>
        !path.isAbsolute(writePath) ||
        path.resolve(writePath) === path.resolve(request.workspaceRoot) ||
        !isPathInside(writePath, request.workspaceRoot) ||
        /[\u0000-\u001f\u007f]/u.test(writePath),
    ) ||
    new Set(paths.map((writePath) => path.resolve(writePath))).size !==
      paths.length
  ) {
    throw new Error(
      `Sandbox workspace write paths must contain at most ${MAX_WORKSPACE_WRITE_PATHS} distinct absolute non-root workspace paths`,
    );
  }
  const resolved = paths.map((writePath) => path.resolve(writePath)).sort();
  if (
    resolved.some((candidate, index) =>
      resolved.some(
        (other, otherIndex) =>
          index !== otherIndex && isPathInside(candidate, other),
      ),
    )
  ) {
    throw new Error("Sandbox workspace write paths cannot overlap");
  }
  return resolved;
}

function bindMount(source: string, target: string, readonly: boolean): string {
  return [
    "type=bind",
    `source=${path.resolve(source)}`,
    `target=${path.resolve(target)}`,
    readonly ? "readonly" : "",
  ]
    .filter(Boolean)
    .join(",");
}

function containerProcessEnv(
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith("DOCKER_") && typeof entry[1] === "string",
      ),
    ),
    ...env,
  };
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

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function sandboxLiteral(value: string): string {
  return JSON.stringify(path.resolve(value));
}

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertContainerImageIdentityStable,
  resolveContainerCommandRuntime,
  resolveContainerImageIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
} from "./sandbox-container-runtime.js";
import {
  containerScratchBaseDir,
  containerClientEnvironment,
  resolveContainerLaunchExecutable,
  serializeContainerEnvironment,
  validateContainerImage,
} from "./sandbox-container.js";
import {
  scopedWorkspaceWritePaths,
  validateLaunchRequest,
} from "./sandbox-launch-policy.js";
import { launchSandboxProcess } from "./sandbox-process-lifecycle.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxCommandRuntime,
  SandboxCommandRuntimeBinding,
  SandboxLaunchRequest,
} from "./sandbox-types.js";

export class OciContainerSandboxAdapter implements OsSandboxAdapter {
  readonly id = "oci-container";
  private readonly executable: string | undefined;
  private readonly containerClient: ContainerClient | undefined;
  private imageIdentity: Promise<ContainerImageIdentity> | undefined;
  private readonly runtimeBindings = new Map<
    SandboxCommandRuntime,
    Promise<SandboxCommandRuntimeBinding>
  >();

  constructor(
    private readonly image: string,
    options: {
      executable?: string;
      spawnProcess?: typeof spawn;
      containerClient?: ContainerClient;
    } = {},
  ) {
    this.executable = options.executable;
    this.containerClient = options.containerClient;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  private readonly spawnProcess: typeof spawn;

  async resolveCommandRuntime(
    runtime: SandboxCommandRuntime,
  ): Promise<SandboxCommandRuntimeBinding> {
    const cached = this.runtimeBindings.get(runtime);
    if (cached) return cached;
    const resolving = this.resolveRuntime(runtime);
    this.runtimeBindings.set(runtime, resolving);
    try {
      return await resolving;
    } catch (error) {
      this.runtimeBindings.delete(runtime);
      throw error;
    }
  }

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
    const identity = await this.resolveImage(executable);
    const sandboxHome = await mkdtemp(
      path.join(await containerScratchBaseDir(), "napier-process-sandbox-"),
    );
    try {
      await writeFile(
        containerEnvironmentFile(sandboxHome),
        serializeContainerEnvironment(request.env),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      const args = buildOciContainerArgs(
        request,
        sandboxHome,
        identity.imageId,
      );
      return await launchSandboxProcess({
        command: identity.clientExecutable,
        args,
        cwd: "/",
        env: containerClientEnvironment(),
        sandboxHome,
        parentDeathGuard: false,
        spawnProcess: this.spawnProcess,
      });
    } catch (error) {
      await rm(sandboxHome, { recursive: true, force: true });
      throw error;
    }
  }

  private async resolveRuntime(
    runtime: SandboxCommandRuntime,
  ): Promise<SandboxCommandRuntimeBinding> {
    const executable = await resolveContainerLaunchExecutable(this.executable);
    return resolveContainerCommandRuntime(
      await this.resolveImage(executable),
      runtime,
      this.containerClient,
    );
  }

  private async resolveImage(
    executable: string,
  ): Promise<ContainerImageIdentity> {
    this.imageIdentity ??= resolveContainerImageIdentity(
      this.image,
      executable,
      this.containerClient,
    );
    try {
      const identity = await this.imageIdentity;
      await assertContainerImageIdentityStable(identity);
      return identity;
    } catch (error) {
      this.imageIdentity = undefined;
      this.runtimeBindings.clear();
      throw error;
    }
  }
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
  serializeContainerEnvironment(request.env);
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
    "--env-file",
    containerEnvironmentFile(sandboxHome),
  ];
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

function containerEnvironmentFile(sandboxHome: string): string {
  return path.join(sandboxHome, "environment.list");
}

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertContainerImageIdentityStable,
  removeContainerResource,
  resolveContainerCommandRuntime,
  resolveContainerImageIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIdentity,
  type ContainerUserIds,
  validateOciContainerName,
} from "./sandbox-container-runtime.js";
import { resolveContainerLspRuntime } from "./sandbox-container-lsp-runtime.js";
import {
  containerScratchBaseDir,
  containerClientEnvironment,
  resolveContainerLaunchExecutable,
  serializeContainerEnvironment,
  validateContainerImage,
} from "./sandbox-container.js";
import {
  createParentGuardedTerminalLaunch,
  type ParentGuardedOciCleanup,
} from "./process-guardian.js";
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
  SandboxLspRuntimeBinding,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
import { launchTerminalSandboxWrapper } from "./sandbox-terminal.js";

export class OciContainerSandboxAdapter implements OsSandboxAdapter {
  readonly id = "oci-container";
  private readonly executable: string | undefined;
  private readonly containerClient: ContainerClient | undefined;
  private readonly terminalLauncher: typeof launchTerminalSandboxWrapper;
  private readonly userIds: ContainerUserIds | undefined;
  private readonly daemonEndpoint: string | undefined;
  private imageIdentity: Promise<ContainerImageIdentity> | undefined;
  private readonly runtimeBindings = new Map<
    SandboxCommandRuntime,
    Promise<SandboxCommandRuntimeBinding>
  >();
  private lspRuntimeBinding: Promise<SandboxLspRuntimeBinding> | undefined;

  constructor(
    private readonly image: string,
    options: {
      executable?: string;
      spawnProcess?: typeof spawn;
      containerClient?: ContainerClient;
      terminalLauncher?: typeof launchTerminalSandboxWrapper;
      userIds?: ContainerUserIds;
      daemonEndpoint?: string;
    } = {},
  ) {
    this.executable = options.executable;
    this.containerClient = options.containerClient;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.terminalLauncher =
      options.terminalLauncher ?? launchTerminalSandboxWrapper;
    this.userIds = options.userIds;
    this.daemonEndpoint = options.daemonEndpoint;
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

  async resolveLspRuntime(): Promise<SandboxLspRuntimeBinding> {
    const executable = await resolveContainerLaunchExecutable(this.executable);
    await this.resolveImage(executable);
    this.lspRuntimeBinding ??= this.resolveLsp();
    try {
      return await this.lspRuntimeBinding;
    } catch (error) {
      this.lspRuntimeBinding = undefined;
      throw error;
    }
  }

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    validateLaunchRequest(request);
    validateContainerImage(this.image);
    const executable = await resolveContainerLaunchExecutable(this.executable);
    const identity = await this.resolveImage(executable);
    const sandboxHome = await mkdtemp(
      path.join(await containerScratchBaseDir(), "napier-process-sandbox-"),
    );
    const containerName = createContainerName();
    const clientEnvironment = containerClientEnvironment();
    const cleanup: ParentGuardedOciCleanup = {
      kind: "oci-container",
      command: identity.clientExecutable,
      commandSha256: identity.clientExecutableSha256,
      containerName,
      env: clientEnvironment,
    };
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
        containerName,
        identity.user,
      );
      const target = {
        command: identity.clientExecutable,
        args,
        cwd: "/",
        env: clientEnvironment,
        cleanup,
      };
      if (request.terminal) {
        const guarded = createParentGuardedTerminalLaunch(target);
        return await this.terminalLauncher({
          ...guarded,
          columns: request.terminal.columns,
          rows: request.terminal.rows,
          sandboxHome,
        });
      }
      return await launchSandboxProcess({
        ...target,
        sandboxHome,
        parentDeathGuard: request.parentDeathGuard === true,
        ...(request.parentDeathGuard
          ? { guardianCleanup: cleanup }
          : {
              beforeCleanup: () =>
                removeContainerResource(
                  identity,
                  containerName,
                  this.containerClient,
                  this.userIds,
                  this.daemonEndpoint,
                ),
            }),
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
      this.userIds,
      this.daemonEndpoint,
    );
  }

  private async resolveLsp(): Promise<SandboxLspRuntimeBinding> {
    const executable = await resolveContainerLaunchExecutable(this.executable);
    return resolveContainerLspRuntime(
      await this.resolveImage(executable),
      this.containerClient,
      this.userIds,
      this.daemonEndpoint,
    );
  }

  private async resolveImage(
    executable: string,
  ): Promise<ContainerImageIdentity> {
    this.imageIdentity ??= resolveContainerImageIdentity(
      this.image,
      executable,
      this.containerClient,
      this.userIds,
      this.daemonEndpoint,
    );
    try {
      const identity = await this.imageIdentity;
      await assertContainerImageIdentityStable(
        identity,
        this.containerClient,
        this.userIds,
        this.daemonEndpoint,
      );
      return identity;
    } catch (error) {
      this.imageIdentity = undefined;
      this.runtimeBindings.clear();
      this.lspRuntimeBinding = undefined;
      throw error;
    }
  }
}

export function buildOciContainerArgs(
  request: SandboxLaunchRequest,
  sandboxHome: string,
  image: string,
  containerName: string,
  user: ContainerUserIdentity,
): string[] {
  validateLaunchRequest(request);
  if (!path.isAbsolute(sandboxHome)) {
    throw new Error("Container sandbox home must be absolute");
  }
  validateContainerImage(image);
  validateOciContainerName(containerName);
  validateContainerUserIdentity(user);
  serializeContainerEnvironment(request.env);
  const capabilities = new Set(request.approvedCapabilities);
  const writePaths = scopedWorkspaceWritePaths(request);
  const workspaceMounted =
    capabilities.has("workspace.read") || capabilities.has("workspace.write");
  const args = [
    "run",
    "--init",
    "--name",
    containerName,
    "--user",
    `${String(user.userId)}:${String(user.groupId)}`,
    ...(request.terminal ? ["--interactive", "--tty"] : []),
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
    "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    "--tmpfs",
    `/home/napier:rw,nosuid,nodev,size=64m,mode=0700,uid=${String(user.userId)},gid=${String(user.groupId)}`,
    "--workdir",
    workspaceMounted ? request.cwd : "/tmp",
    "--env",
    "HOME=/home/napier",
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

function createContainerName(): string {
  return `napier-${randomBytes(16).toString("hex")}`;
}

function validateContainerUserIdentity(user: ContainerUserIdentity): void {
  if (
    !Number.isSafeInteger(user.userId) ||
    user.userId < 0 ||
    user.userId > 2_147_483_647 ||
    !Number.isSafeInteger(user.groupId) ||
    user.groupId < 0 ||
    user.groupId > 2_147_483_647 ||
    !/^[a-f0-9]{64}$/u.test(user.identitySha256)
  ) {
    throw new Error("OCI container user identity is invalid");
  }
}

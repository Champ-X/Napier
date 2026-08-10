import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertContainerImageIdentityStable,
  removeContainerLaunchResources,
  resolveContainerCommandRuntime,
  resolveContainerImageIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIdentity,
  type ContainerUserIds,
  validateOciContainerName,
} from "./sandbox-container-runtime.js";
import {
  createHostProjection,
  createContainerServiceNetwork,
  resolveContainerLocalService,
  validateContainerServiceNetworkName,
} from "./sandbox-container-service.js";
import { resolveContainerLspRuntime } from "./sandbox-container-lsp-runtime.js";
import { resolveContainerNodeDebuggerRuntime } from "./sandbox-container-node-debugger-runtime.js";
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
  SandboxNodeDebuggerRuntimeBinding,
  SandboxLaunchRequest,
} from "./sandbox-types.js";
import { launchTerminalSandboxWrapper } from "./sandbox-terminal.js";

export class OciContainerSandboxAdapter implements OsSandboxAdapter {
  readonly id = "oci-container";
  readonly setupIdentitySha256: string | undefined;
  private readonly executable: string | undefined;
  private readonly containerClient: ContainerClient | undefined;
  private readonly terminalLauncher: typeof launchTerminalSandboxWrapper;
  private readonly userIds: ContainerUserIds | undefined;
  private readonly daemonEndpoint: string | undefined;
  private readonly createLocalServiceProjection: typeof createHostProjection;
  private readonly expectedIdentity:
    | {
        clientExecutableSha256: string;
        daemonEndpointSha256: string;
        userIdentitySha256: string;
        identitySha256: string;
      }
    | undefined;
  private imageIdentity: Promise<ContainerImageIdentity> | undefined;
  private readonly runtimeBindings = new Map<
    SandboxCommandRuntime,
    Promise<SandboxCommandRuntimeBinding>
  >();
  private lspRuntimeBinding: Promise<SandboxLspRuntimeBinding> | undefined;
  private nodeDebuggerRuntimeBinding:
    | Promise<SandboxNodeDebuggerRuntimeBinding>
    | undefined;

  constructor(
    private readonly image: string,
    options: {
      executable?: string;
      spawnProcess?: typeof spawn;
      containerClient?: ContainerClient;
      terminalLauncher?: typeof launchTerminalSandboxWrapper;
      userIds?: ContainerUserIds;
      daemonEndpoint?: string;
      createLocalServiceProjection?: typeof createHostProjection;
      expectedIdentity?: {
        clientExecutableSha256: string;
        daemonEndpointSha256: string;
        userIdentitySha256: string;
        identitySha256: string;
      };
    } = {},
  ) {
    this.executable = options.executable;
    this.containerClient = options.containerClient;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.terminalLauncher =
      options.terminalLauncher ?? launchTerminalSandboxWrapper;
    this.userIds = options.userIds;
    this.daemonEndpoint = options.daemonEndpoint;
    this.createLocalServiceProjection =
      options.createLocalServiceProjection ?? createHostProjection;
    this.expectedIdentity = options.expectedIdentity;
    this.setupIdentitySha256 = options.expectedIdentity?.identitySha256;
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

  async resolveNodeDebuggerRuntime(): Promise<SandboxNodeDebuggerRuntimeBinding> {
    const executable = await resolveContainerLaunchExecutable(this.executable);
    await this.resolveImage(executable);
    this.nodeDebuggerRuntimeBinding ??= this.resolveNodeDebugger();
    try {
      return await this.nodeDebuggerRuntimeBinding;
    } catch (error) {
      this.nodeDebuggerRuntimeBinding = undefined;
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
    const networkName = request.localService
      ? createContainerServiceNetworkName()
      : undefined;
    const clientEnvironment = containerClientEnvironment();
    const cleanup: ParentGuardedOciCleanup = {
      kind: "oci-container",
      command: identity.clientExecutable,
      commandSha256: identity.clientExecutableSha256,
      containerName,
      ...(networkName ? { networkName } : {}),
      env: clientEnvironment,
    };
    let child: SandboxedProcess | undefined;
    let closeLocalServiceProjection: (() => Promise<void>) | undefined;
    try {
      await writeFile(
        containerEnvironmentFile(sandboxHome),
        serializeContainerEnvironment(request.env),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      if (networkName) {
        await createContainerServiceNetwork(
          identity,
          networkName,
          this.containerClient,
          this.userIds,
          this.daemonEndpoint,
        );
      }
      const args = buildOciContainerArgs(
        request,
        sandboxHome,
        identity.imageId,
        containerName,
        identity.user,
        networkName,
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
      child = await launchSandboxProcess({
        ...target,
        sandboxHome,
        parentDeathGuard: request.parentDeathGuard === true,
        ...(request.parentDeathGuard
          ? { guardianCleanup: cleanup }
          : {
              beforeCleanup: async () => {
                await closeLocalServiceProjection?.();
                await removeContainerLaunchResources(
                  identity,
                  containerName,
                  networkName,
                  this.containerClient,
                  this.userIds,
                  this.daemonEndpoint,
                );
              },
            }),
        ...(request.parentDeathGuard
          ? {
              beforeCleanup: async () => {
                await closeLocalServiceProjection?.();
              },
            }
          : {}),
        spawnProcess: this.spawnProcess,
      });
      if (!request.localService || !networkName) return child;
      const projection = await resolveContainerLocalService({
        identity,
        containerName,
        networkName,
        nodeExecutable: request.command,
        service: request.localService,
        child,
        ...(this.containerClient ? { client: this.containerClient } : {}),
        ...(this.userIds ? { injectedUserIds: this.userIds } : {}),
        ...(this.daemonEndpoint
          ? { injectedDaemonEndpoint: this.daemonEndpoint }
          : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        createProjection: this.createLocalServiceProjection,
      });
      closeLocalServiceProjection = projection.close;
      return { ...child, localService: projection.binding };
    } catch (error) {
      if (child) {
        await child.terminate().catch(() => undefined);
      } else if (networkName) {
        await removeContainerLaunchResources(
          identity,
          containerName,
          networkName,
          this.containerClient,
          this.userIds,
          this.daemonEndpoint,
        ).catch(() => undefined);
      }
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

  private async resolveNodeDebugger(): Promise<SandboxNodeDebuggerRuntimeBinding> {
    const executable = await resolveContainerLaunchExecutable(this.executable);
    return resolveContainerNodeDebuggerRuntime(
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
      this.assertExpectedIdentity(identity);
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
      this.nodeDebuggerRuntimeBinding = undefined;
      throw error;
    }
  }

  private assertExpectedIdentity(identity: ContainerImageIdentity): void {
    const expected = this.expectedIdentity;
    if (
      expected &&
      (identity.clientExecutableSha256 !== expected.clientExecutableSha256 ||
        identity.daemon.endpointSha256 !== expected.daemonEndpointSha256 ||
        identity.user.identitySha256 !== expected.userIdentitySha256 ||
        identity.identitySha256 !== expected.identitySha256)
    ) {
      throw new Error("Configured Sandbox runtime identity changed");
    }
  }
}

export function buildOciContainerArgs(
  request: SandboxLaunchRequest,
  sandboxHome: string,
  image: string,
  containerName: string,
  user: ContainerUserIdentity,
  serviceNetworkName?: string,
): string[] {
  validateLaunchRequest(request);
  if (!path.isAbsolute(sandboxHome)) {
    throw new Error("Container sandbox home must be absolute");
  }
  validateContainerImage(image);
  validateOciContainerName(containerName);
  validateContainerUserIdentity(user);
  if (request.localService) {
    if (!serviceNetworkName) {
      throw new Error("OCI local service network identity is required");
    }
    validateContainerServiceNetworkName(serviceNetworkName);
  } else if (serviceNetworkName !== undefined) {
    throw new Error("OCI local service network identity is unexpected");
  }
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
    ...(request.terminal
      ? ["--interactive", "--tty"]
      : request.stdinMode === "open"
        ? ["--interactive"]
        : []),
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
    request.localService
      ? serviceNetworkName!
      : capabilities.has("network.connect")
        ? "bridge"
        : "none",
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

function createContainerServiceNetworkName(): string {
  return `napier-network-${randomBytes(16).toString("hex")}`;
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

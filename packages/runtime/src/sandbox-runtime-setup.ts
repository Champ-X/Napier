import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  loadOfficialSandboxRelease,
  pullOfficialSandboxRelease,
  type OfficialSandboxRelease,
  type SandboxReleasePullDependencies,
} from "./sandbox-official-release.js";
import {
  containerClientEnvironment,
  probeContainerRuntimeAvailability,
  resolveContainerLaunchExecutable,
} from "./sandbox-container.js";
import {
  probeContainerRuntimeIdentity,
  resolveContainerDaemonIdentity,
  resolveContainerImageIdentity,
  runContainerClient,
  type ContainerClient,
  type ContainerImageIdentity,
} from "./sandbox-container-runtime.js";

export const OFFICIAL_SANDBOX_IMAGE = "napier-sandbox:0.1.0";
const BUILD_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const BUILD_TIMEOUT_MS = 15 * 60 * 1_000;

export interface SandboxRuntimeTarget {
  imageReference: string;
  acquisition: "local_verified" | "external_release" | "packaged_source";
  release?: OfficialSandboxRelease;
  dockerfileSha256: string;
  contextSha256: string;
  platform: NodeJS.Platform;
  arch: string;
}

export interface SandboxRuntimeInspection {
  target: SandboxRuntimeTarget;
  status:
    | "ready"
    | "pullable"
    | "buildable"
    | "runtime_unavailable"
    | "unsupported";
  identity?: ContainerImageIdentity;
}

export interface SandboxBuildRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface SandboxBuildResult {
  exitCode: number;
  outputBytes: number;
  outputSha256: string;
}

export interface SandboxRuntimeSetupDependencies {
  inspect?: () => Promise<SandboxRuntimeInspection>;
  runBuild?: (request: SandboxBuildRequest) => Promise<SandboxBuildResult>;
  loadRelease?: typeof loadOfficialSandboxRelease;
  pullRelease?: typeof pullOfficialSandboxRelease;
  releasePull?: SandboxReleasePullDependencies;
}

export class SandboxToolchainDriftError extends Error {
  constructor() {
    super("Official Sandbox image toolchain identity is invalid");
    this.name = "SandboxToolchainDriftError";
  }
}

export async function verifyOfficialSandboxRuntimeToolchain(
  identity: ContainerImageIdentity,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const [observed, source] = await Promise.all([
    probeContainerRuntimeIdentity(identity, abortableContainerClient(signal)),
    officialSandboxSource(),
  ]);
  signal.throwIfAborted();
  const [packageJsonSha256, packageLockSha256] = await Promise.all([
    sha256File(path.join(source.contextPath, "package.json")),
    sha256File(path.join(source.contextPath, "package-lock.json")),
  ]);
  if (
    !observed.shell ||
    observed.debugger?.nodeVersion !== "24.16.0" ||
    observed.python?.version !== "3.13.5" ||
    observed.git?.version !== "git version 2.47.3" ||
    observed.lsp?.languageServerVersion !== "5.3.0" ||
    observed.lsp?.typescriptVersion !== "5.9.3" ||
    observed.verification?.packageJsonSha256 !== packageJsonSha256 ||
    observed.verification.packageLockSha256 !== packageLockSha256 ||
    observed.verification.typecheck.version !== "5.9.3" ||
    observed.verification.test.version !== "4.1.9" ||
    observed.verification.format.version !== "3.8.4"
  ) {
    throw new SandboxToolchainDriftError();
  }
}

export async function inspectOfficialSandboxRuntime(
  dependencies: Pick<SandboxRuntimeSetupDependencies, "loadRelease"> = {},
): Promise<SandboxRuntimeInspection> {
  const sourceTarget = await officialSandboxTarget();
  if (!["darwin", "linux", "win32"].includes(process.platform)) {
    return { target: sourceTarget, status: "unsupported" };
  }
  if (!(await probeContainerRuntimeAvailability())) {
    return { target: sourceTarget, status: "runtime_unavailable" };
  }
  const executable = await resolveContainerLaunchExecutable(undefined);
  const localIdentity = await matchingImageIdentity(sourceTarget, executable);
  if (localIdentity) {
    return {
      target: { ...sourceTarget, acquisition: "local_verified" },
      status: "ready",
      identity: localIdentity,
    };
  }
  const release = await (
    dependencies.loadRelease ?? loadOfficialSandboxRelease
  )(sourceTarget.contextSha256);
  if (release) {
    const releaseTarget = {
      ...sourceTarget,
      imageReference: release.reference,
      acquisition: "external_release" as const,
      release,
    };
    const releaseIdentity = await matchingImageIdentity(
      releaseTarget,
      executable,
    );
    return releaseIdentity
      ? { target: releaseTarget, status: "ready", identity: releaseIdentity }
      : { target: releaseTarget, status: "pullable" };
  }
  return { target: sourceTarget, status: "buildable" };
}

export async function pullOfficialSandboxRuntime(
  input: { signal: AbortSignal },
  dependencies: SandboxRuntimeSetupDependencies = {},
): Promise<
  | (SandboxRuntimeInspection & {
      status: "ready";
      identity: ContainerImageIdentity;
    })
  | undefined
> {
  const inspect = dependencies.inspect ?? inspectOfficialSandboxRuntime;
  const before = await inspect();
  if (before.status === "ready" && before.identity) {
    return before as SandboxRuntimeInspection & {
      status: "ready";
      identity: ContainerImageIdentity;
    };
  }
  if (before.status !== "pullable" || !before.target.release) {
    throw new Error("Official Sandbox release cannot be pulled on this host");
  }
  const pulled = await (dependencies.pullRelease ?? pullOfficialSandboxRelease)(
    before.target.release,
    input.signal,
    dependencies.releasePull,
  );
  if (pulled.status === "unavailable") return undefined;
  input.signal.throwIfAborted();
  const after = await inspect();
  if (
    after.status !== "ready" ||
    !after.identity ||
    after.identity.imageId !== pulled.identity.imageId ||
    canonicalRelease(after.target.release) !==
      canonicalRelease(before.target.release)
  ) {
    throw new Error("Official Sandbox release verification failed");
  }
  return after as SandboxRuntimeInspection & {
    status: "ready";
    identity: ContainerImageIdentity;
  };
}

export async function buildOfficialSandboxRuntime(
  input: { signal: AbortSignal; force?: boolean },
  dependencies: SandboxRuntimeSetupDependencies = {},
): Promise<
  SandboxRuntimeInspection & {
    status: "ready";
    identity: ContainerImageIdentity;
  }
> {
  const inspect = dependencies.inspect ?? inspectOfficialSandboxRuntime;
  const before = await inspect();
  if (!input.force && before.status === "ready" && before.identity) {
    return before as SandboxRuntimeInspection & {
      status: "ready";
      identity: ContainerImageIdentity;
    };
  }
  if (
    before.status !== "buildable" &&
    before.status !== "pullable" &&
    !(input.force && before.status === "ready" && before.identity)
  ) {
    throw new Error("Official Sandbox image cannot be built on this host");
  }
  input.signal.throwIfAborted();
  const executable = await resolveContainerLaunchExecutable(undefined);
  await resolveContainerDaemonIdentity(executable);
  const source = await officialSandboxSource();
  const buildTarget = await officialSandboxTarget();
  const result = await (dependencies.runBuild ?? runSandboxBuild)({
    command: executable,
    args: [
      "build",
      "--file",
      source.dockerfilePath,
      "--tag",
      buildTarget.imageReference,
      "--label",
      `io.napier.sandbox.context-sha256=${buildTarget.contextSha256}`,
      source.contextPath,
    ],
    cwd: source.contextPath,
    env: containerClientEnvironment(),
    signal: input.signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Official Sandbox image build failed (exit ${String(result.exitCode)}, diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
  input.signal.throwIfAborted();
  const identity = await matchingImageIdentity(buildTarget, executable);
  if (!identity) {
    throw new Error(
      `Official Sandbox image verification failed (diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
  if (!sameSandboxSource(buildTarget, before.target)) {
    throw new Error("Official Sandbox build target changed during setup");
  }
  return {
    target: buildTarget,
    status: "ready",
    identity,
  } as SandboxRuntimeInspection & {
    status: "ready";
    identity: ContainerImageIdentity;
  };
}

export function runSandboxBuild(
  request: SandboxBuildRequest,
): Promise<SandboxBuildResult> {
  request.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const outputHash = createHash("sha256");
    let outputBytes = 0;
    let settled = false;
    let outputLimited = false;
    const child = execFile(
      request.command,
      request.args,
      {
        cwd: request.cwd,
        env: request.env,
        timeout: BUILD_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: BUILD_OUTPUT_LIMIT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener("abort", abort);
        const output = `${stdout}${stderr}`;
        outputBytes = Buffer.byteLength(output);
        outputHash.update(output);
        outputLimited =
          outputBytes > BUILD_OUTPUT_LIMIT_BYTES ||
          Boolean(
            error &&
            "code" in error &&
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          );
        if (request.signal.aborted) {
          reject(new Error("Official Sandbox image build was cancelled"));
          return;
        }
        if (outputLimited) {
          reject(
            new Error("Official Sandbox image build exceeded its output limit"),
          );
          return;
        }
        resolve({
          exitCode: error ? numericExitCode(error) : 0,
          outputBytes,
          outputSha256: outputHash.digest("hex"),
        });
      },
    );
    const abort = (): void => {
      child.kill("SIGKILL");
    };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
  });
}

function abortableContainerClient(signal: AbortSignal): ContainerClient {
  return (executable, args) => {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = execFile(
        executable,
        [...args],
        {
          env: containerClientEnvironment(),
          timeout: 10_000,
          killSignal: "SIGKILL",
          maxBuffer: 4_096,
          windowsHide: true,
        },
        (error, stdout) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          if (error) {
            reject(new Error("OCI container identity probe failed"));
            return;
          }
          resolve(stdout);
        },
      );
      const abort = (): void => {
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  };
}

async function officialSandboxTarget(): Promise<SandboxRuntimeTarget> {
  const source = await officialSandboxSource();
  const [dockerfileSha256, packageJsonSha256, packageLockSha256] =
    await Promise.all([
      sha256File(source.dockerfilePath),
      sha256File(path.join(source.contextPath, "package.json")),
      sha256File(path.join(source.contextPath, "package-lock.json")),
    ]);
  return {
    imageReference: OFFICIAL_SANDBOX_IMAGE,
    acquisition: "packaged_source",
    dockerfileSha256,
    contextSha256: sha256(
      canonicalJson({
        dockerfile: "docker/napier-sandbox/Dockerfile",
        dockerfileSha256,
        packageJson: "docker/napier-sandbox/package.json",
        packageJsonSha256,
        packageLock: "docker/napier-sandbox/package-lock.json",
        packageLockSha256,
      }),
    ),
    platform: process.platform,
    arch: process.arch,
  };
}

async function matchingImageIdentity(
  target: SandboxRuntimeTarget,
  executable: string,
): Promise<ContainerImageIdentity | undefined> {
  try {
    const labels = (
      await runContainerClient(executable, [
        "image",
        "inspect",
        "--format",
        '{{ index .Config.Labels "io.napier.sandbox.context-sha256" }}\t{{ index .Config.Labels "org.opencontainers.image.revision" }}',
        target.imageReference,
      ])
    )
      .trim()
      .split("\t");
    if (
      labels[0] !== target.contextSha256 ||
      (target.release && labels[1] !== target.release.sourceSha)
    ) {
      return undefined;
    }
    return resolveContainerImageIdentity(target.imageReference, executable);
  } catch {
    return undefined;
  }
}

function sameSandboxSource(
  left: SandboxRuntimeTarget,
  right: SandboxRuntimeTarget,
): boolean {
  return (
    left.dockerfileSha256 === right.dockerfileSha256 &&
    left.contextSha256 === right.contextSha256 &&
    left.platform === right.platform &&
    left.arch === right.arch
  );
}

function canonicalRelease(release: OfficialSandboxRelease | undefined): string {
  return release ? canonicalJson(release) : "";
}

async function officialSandboxSource(): Promise<{
  contextPath: string;
  dockerfilePath: string;
}> {
  const sourceContext = path.resolve(
    import.meta.dirname,
    "../../../docker/napier-sandbox",
  );
  const packagedContext = path.resolve(import.meta.dirname, "sandbox-image");
  const contextPath = await realpath(
    await existingDockerfileContext(sourceContext, packagedContext),
  );
  const dockerfilePath = await realpath(path.join(contextPath, "Dockerfile"));
  const info = await lstat(dockerfilePath);
  if (!info.isFile() || info.size <= 0 || info.size > 64 * 1024) {
    throw new Error("Official Sandbox Dockerfile is unavailable");
  }
  await readFile(dockerfilePath);
  return { contextPath, dockerfilePath };
}

async function existingDockerfileContext(
  sourceContext: string,
  packagedContext: string,
): Promise<string> {
  for (const candidate of [sourceContext, packagedContext]) {
    try {
      const info = await lstat(path.join(candidate, "Dockerfile"));
      if (info.isFile()) return candidate;
    } catch {
      // Try the next immutable packaged location.
    }
  }
  throw new Error("Official Sandbox Dockerfile is unavailable");
}

function numericExitCode(error: { code?: string | number | null }): number {
  return typeof error.code === "number" ? error.code : 1;
}

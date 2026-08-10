import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  containerClientEnvironment,
  probeContainerRuntimeAvailability,
  resolveContainerLaunchExecutable,
} from "./sandbox-container.js";
import {
  resolveContainerDaemonIdentity,
  resolveContainerImageIdentity,
  runContainerClient,
  type ContainerImageIdentity,
} from "./sandbox-container-runtime.js";

export const OFFICIAL_SANDBOX_IMAGE = "napier-sandbox:0.1.0";
const BUILD_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const BUILD_TIMEOUT_MS = 15 * 60 * 1_000;

export interface SandboxRuntimeTarget {
  imageReference: string;
  dockerfileSha256: string;
  contextSha256: string;
  platform: NodeJS.Platform;
  arch: string;
}

export interface SandboxRuntimeInspection {
  target: SandboxRuntimeTarget;
  status: "ready" | "buildable" | "runtime_unavailable" | "unsupported";
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
}

export async function inspectOfficialSandboxRuntime(): Promise<SandboxRuntimeInspection> {
  const target = await officialSandboxTarget();
  if (!["darwin", "linux", "win32"].includes(process.platform)) {
    return { target, status: "unsupported" };
  }
  if (!(await probeContainerRuntimeAvailability())) {
    return { target, status: "runtime_unavailable" };
  }
  try {
    const executable = await resolveContainerLaunchExecutable(undefined);
    const sourceSha256 = (
      await runContainerClient(executable, [
        "image",
        "inspect",
        "--format",
        '{{ index .Config.Labels "io.napier.sandbox.context-sha256" }}',
        target.imageReference,
      ])
    ).trim();
    if (sourceSha256 !== target.contextSha256) {
      return { target, status: "buildable" };
    }
    return {
      target,
      status: "ready",
      identity: await resolveContainerImageIdentity(
        target.imageReference,
        executable,
      ),
    };
  } catch {
    return { target, status: "buildable" };
  }
}

export async function buildOfficialSandboxRuntime(
  input: { signal: AbortSignal },
  dependencies: SandboxRuntimeSetupDependencies = {},
): Promise<
  SandboxRuntimeInspection & {
    status: "ready";
    identity: ContainerImageIdentity;
  }
> {
  const inspect = dependencies.inspect ?? inspectOfficialSandboxRuntime;
  const before = await inspect();
  if (before.status === "ready" && before.identity) {
    return before as SandboxRuntimeInspection & {
      status: "ready";
      identity: ContainerImageIdentity;
    };
  }
  if (before.status !== "buildable") {
    throw new Error("Official Sandbox image cannot be built on this host");
  }
  input.signal.throwIfAborted();
  const executable = await resolveContainerLaunchExecutable(undefined);
  await resolveContainerDaemonIdentity(executable);
  const source = await officialSandboxSource();
  const result = await (dependencies.runBuild ?? runSandboxBuild)({
    command: executable,
    args: [
      "build",
      "--file",
      source.dockerfilePath,
      "--tag",
      before.target.imageReference,
      "--label",
      `io.napier.sandbox.context-sha256=${before.target.contextSha256}`,
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
  const after = await inspect();
  if (after.status !== "ready" || !after.identity) {
    throw new Error(
      `Official Sandbox image verification failed (diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
  if (canonicalJson(after.target) !== canonicalJson(before.target)) {
    throw new Error("Official Sandbox build target changed during setup");
  }
  return after as SandboxRuntimeInspection & {
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

async function officialSandboxTarget(): Promise<SandboxRuntimeTarget> {
  const source = await officialSandboxSource();
  const dockerfileSha256 = await sha256File(source.dockerfilePath);
  return {
    imageReference: OFFICIAL_SANDBOX_IMAGE,
    dockerfileSha256,
    contextSha256: sha256(
      canonicalJson({
        dockerfile: "docker/napier-sandbox/Dockerfile",
        dockerfileSha256,
      }),
    ),
    platform: process.platform,
    arch: process.arch,
  };
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

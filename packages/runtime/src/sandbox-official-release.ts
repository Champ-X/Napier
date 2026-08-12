import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  containerClientEnvironment,
  resolveContainerLaunchExecutable,
} from "./sandbox-container.js";
import {
  resolveContainerDaemonIdentity,
  resolveContainerImageIdentity,
  runContainerClient,
  type ContainerClient,
  type ContainerImageIdentity,
} from "./sandbox-container-runtime.js";
import { sha256 } from "./ed25519.js";
import {
  type OfficialSandboxRelease,
  validateOfficialSandboxRelease,
} from "./sandbox-official-release-model.js";

export {
  type OfficialSandboxRelease,
  validateOfficialSandboxRelease,
} from "./sandbox-official-release-model.js";

const RELEASE_RECEIPT = "sandbox-external-publication-0.1.0.json";
const PACKAGED_RECEIPT = "external-publication.json";
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_PULL_OUTPUT_BYTES = 1024 * 1024;
const PULL_TIMEOUT_MS = 15 * 60 * 1_000;

export interface SandboxReleasePullRequest {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface SandboxReleasePullResult {
  exitCode: number;
  outputBytes: number;
  outputSha256: string;
}

export interface SandboxReleasePullDependencies {
  runPull?: (
    request: SandboxReleasePullRequest,
  ) => Promise<SandboxReleasePullResult>;
  resolveExecutable?: () => Promise<string>;
  client?: ContainerClient;
}

export type SandboxReleaseDiscardDependencies = Pick<
  SandboxReleasePullDependencies,
  "resolveExecutable" | "client"
>;

export async function loadOfficialSandboxRelease(
  expectedContextSha256: string,
): Promise<OfficialSandboxRelease | undefined> {
  for (const candidate of releaseReceiptCandidates()) {
    let bytes: Buffer;
    try {
      const candidateInfo = await lstat(candidate);
      if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink()) {
        throw new Error("Official Sandbox release receipt is invalid");
      }
      const filePath = await realpath(candidate);
      const info = await lstat(filePath);
      if (
        !info.isFile() ||
        info.size <= 0 ||
        info.size > MAX_RECEIPT_BYTES
      ) {
        throw new Error("Official Sandbox release receipt is invalid");
      }
      bytes = await readFile(filePath);
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    return validateOfficialSandboxRelease(
      JSON.parse(bytes.toString("utf8")) as unknown,
      expectedContextSha256,
      sha256(bytes),
    );
  }
  return undefined;
}

export async function pullOfficialSandboxRelease(
  release: OfficialSandboxRelease,
  signal: AbortSignal,
  dependencies: SandboxReleasePullDependencies = {},
): Promise<
  | { status: "pulled"; identity: ContainerImageIdentity }
  | { status: "unavailable"; diagnosticSha256: string }
> {
  signal.throwIfAborted();
  const platform = hostImagePlatform();
  if (!release.platforms.includes(platform)) {
    throw new Error("Official Sandbox release does not support this host");
  }
  const executable = await (
    dependencies.resolveExecutable ??
    (() => resolveContainerLaunchExecutable(undefined))
  )();
  const controlClient = dependencies.client ?? runContainerClient;
  const daemonEndpoint = await resolveReleaseDaemonEndpoint(
    executable,
    controlClient,
  );
  const configRoot = await mkdtemp(
    path.join(tmpdir(), "napier-sandbox-release-"),
  );
  let pulled = false;
  try {
    await writeFile(
      path.join(configRoot, "config.json"),
      '{"auths":{}}\n',
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    const environment: NodeJS.ProcessEnv = {
      ...containerClientEnvironment(),
      DOCKER_CONFIG: configRoot,
      DOCKER_HOST: daemonEndpoint,
    };
    delete environment.DOCKER_CONTEXT;
    delete environment.DOCKER_CERT_PATH;
    delete environment.DOCKER_TLS_VERIFY;
    const client: ContainerClient = dependencies.client
      ? dependencies.client
      : (clientExecutable, args) =>
          runSandboxReleaseClient(
            clientExecutable,
            ["--config", configRoot, ...args],
            environment,
          );
    const pull = await (dependencies.runPull ?? runSandboxReleasePull)({
      command: executable,
      args: [
        "--config",
        configRoot,
        "pull",
        "--platform",
        platform,
        release.reference,
      ],
      env: environment,
      signal,
    });
    signal.throwIfAborted();
    if (pull.exitCode !== 0) {
      await discardReleaseReference(executable, release.reference, client);
      return {
        status: "unavailable",
        diagnosticSha256: pull.outputSha256,
      };
    }
    pulled = true;
    try {
      const labels = (
        await client(executable, [
          "image",
          "inspect",
          "--format",
          '{{ index .Config.Labels "io.napier.sandbox.context-sha256" }}\t{{ index .Config.Labels "org.opencontainers.image.revision" }}',
          release.reference,
        ])
      )
        .trim()
        .split("\t");
      if (
        labels.length !== 2 ||
        labels[0] !== release.contextSha256 ||
        labels[1] !== release.sourceSha
      ) {
        throw new Error("Official Sandbox release labels are invalid");
      }
      const identity = await resolveContainerImageIdentity(
        release.reference,
        executable,
        client,
      );
      if (identity.imagePlatform !== platform) {
        throw new Error("Official Sandbox release platform is invalid");
      }
      return { status: "pulled", identity };
    } catch (error) {
      if (pulled) {
        await discardReleaseReference(executable, release.reference, client);
      }
      throw error;
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
}

export async function discardOfficialSandboxRelease(
  release: OfficialSandboxRelease,
  signal: AbortSignal,
  dependencies: SandboxReleaseDiscardDependencies = {},
): Promise<void> {
  signal.throwIfAborted();
  const executable = await (
    dependencies.resolveExecutable ??
    (() => resolveContainerLaunchExecutable(undefined))
  )();
  const controlClient = dependencies.client ?? runContainerClient;
  const daemonEndpoint = await resolveReleaseDaemonEndpoint(
    executable,
    controlClient,
  );
  const configRoot = await mkdtemp(
    path.join(tmpdir(), "napier-sandbox-release-discard-"),
  );
  try {
    await writeFile(
      path.join(configRoot, "config.json"),
      '{"auths":{}}\n',
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    const environment: NodeJS.ProcessEnv = {
      ...containerClientEnvironment(),
      DOCKER_CONFIG: configRoot,
      DOCKER_HOST: daemonEndpoint,
    };
    delete environment.DOCKER_CONTEXT;
    delete environment.DOCKER_CERT_PATH;
    delete environment.DOCKER_TLS_VERIFY;
    const client: ContainerClient = dependencies.client
      ? dependencies.client
      : (clientExecutable, args) =>
          runSandboxReleaseClient(
            clientExecutable,
            ["--config", configRoot, ...args],
            environment,
          );
    await discardReleaseReference(executable, release.reference, client);
    signal.throwIfAborted();
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
}

async function discardReleaseReference(
  executable: string,
  reference: string,
  client: ContainerClient,
): Promise<void> {
  try {
    await client(executable, ["image", "rm", reference]);
  } catch {
    try {
      await client(executable, ["image", "inspect", reference]);
    } catch {
      return;
    }
    throw new Error("Rejected Official Sandbox release cleanup failed");
  }
}

async function resolveReleaseDaemonEndpoint(
  executable: string,
  client: ContainerClient,
): Promise<string> {
  const explicitHost = process.env["DOCKER_HOST"]?.trim();
  const explicitContext = process.env["DOCKER_CONTEXT"]?.trim();
  const endpoint = (
    explicitHost && !explicitContext
      ? explicitHost
      : await client(executable, [
          "context",
          "inspect",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ])
  ).trim();
  await resolveContainerDaemonIdentity(executable, client, endpoint);
  return endpoint;
}

function runSandboxReleaseClient(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        env: environment,
        timeout: 10_000,
        killSignal: "SIGKILL",
        maxBuffer: 4_096,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error("OCI container identity probe failed"));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function runSandboxReleasePull(
  request: SandboxReleasePullRequest,
): Promise<SandboxReleasePullResult> {
  request.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let settled = false;
    const child = execFile(
      request.command,
      request.args,
      {
        env: request.env,
        timeout: PULL_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_PULL_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener("abort", abort);
        if (request.signal.aborted) {
          reject(request.signal.reason);
          return;
        }
        const output = `${stdout}${stderr}`;
        const outputBytes = Buffer.byteLength(output);
        hash.update(output);
        if (
          outputBytes > MAX_PULL_OUTPUT_BYTES ||
          (error &&
            "code" in error &&
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        ) {
          reject(
            new Error("Official Sandbox release pull exceeded its output limit"),
          );
          return;
        }
        resolve({
          exitCode: error ? numericExitCode(error) : 0,
          outputBytes,
          outputSha256: hash.digest("hex"),
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

function releaseReceiptCandidates(): string[] {
  return [
    path.resolve(import.meta.dirname, "../../../docs/artifacts", RELEASE_RECEIPT),
    path.resolve(import.meta.dirname, "sandbox-image", PACKAGED_RECEIPT),
  ];
}

function hostImagePlatform(): "linux/amd64" | "linux/arm64" {
  if (process.arch === "x64") return "linux/amd64";
  if (process.arch === "arm64") return "linux/arm64";
  throw new Error("Official Sandbox release does not support this architecture");
}

function numericExitCode(error: { code?: string | number | null }): number {
  return typeof error.code === "number" ? error.code : 1;
}

function missing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

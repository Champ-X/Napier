import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

export const CONTAINER_IMAGE_ENV = "NAPIER_CONTAINER_SANDBOX_IMAGE";
const CONTAINER_EXECUTABLE_CANDIDATES = ["docker"] as const;
const CONTAINER_SCRATCH_DIR_ENV = "NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR";
const CONTAINER_PROBE_TIMEOUT_MS = 3_000;
const MAX_CONTAINER_ENVIRONMENT_ENTRIES = 128;
const MAX_CONTAINER_ENVIRONMENT_BYTES = 64 * 1024;
const CONTAINER_CLIENT_ENV_NAMES = [
  "DOCKER_CERT_PATH",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
] as const;

/**
 * Resolves a container runtime executable from PATH so the OCI sandbox works
 * with Homebrew, colima, and other non-`/usr/bin` installs. Only absolute,
 * executable candidates are accepted; returns undefined when none resolve.
 */
export async function resolveContainerExecutable(
  candidates: readonly string[] = CONTAINER_EXECUTABLE_CANDIDATES,
  pathValue: string | undefined = process.env["PATH"],
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const directories = (pathValue ?? "").split(delimiter).filter(Boolean);
  for (const candidate of candidates) {
    for (const executableName of executableNames(candidate, platform)) {
      if (path.isAbsolute(executableName)) {
        if (await isExecutableFile(executableName)) return executableName;
        continue;
      }
      for (const directory of directories) {
        const resolved = path.join(directory, executableName);
        if (await isExecutableFile(resolved)) return resolved;
      }
    }
  }
  return undefined;
}

/**
 * Verifies that the resolved Docker client can reach a server. A CLI binary on
 * PATH alone is not runtime readiness (for example Docker Desktop may be
 * stopped), so Doctor uses this bounded server-version call before suggesting
 * the container fallback.
 */
export async function probeContainerRuntimeAvailability(
  options: {
    candidates?: readonly string[];
    pathValue?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const executable = await resolveContainerExecutable(
    options.candidates,
    options.pathValue,
  );
  if (!executable || options.signal?.aborted) return false;
  const env = containerClientEnvironment();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      resolve(available);
    };
    const child = execFile(
      executable,
      ["version", "--format", "{{.Server.Version}}"],
      {
        env,
        timeout: options.timeoutMs ?? CONTAINER_PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 4_096,
        windowsHide: true,
      },
      (error, stdout) => finish(!error && stdout.trim().length > 0),
    );
    const abort = (): void => {
      child.kill("SIGKILL");
      finish(false);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export function containerClientEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return Object.fromEntries(
    CONTAINER_CLIENT_ENV_NAMES.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * Serializes command-only environment values for Docker's --env-file input.
 * Keeping these values out of the Docker client process prevents command
 * variables such as PATH, HOME, DOCKER_*, or loader settings from changing
 * which daemon/client configuration performs the sandbox launch.
 */
export function serializeContainerEnvironment(
  environment: Record<string, string>,
): string {
  const entries = Object.entries(environment).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (entries.length > MAX_CONTAINER_ENVIRONMENT_ENTRIES) {
    throw new Error(
      `Container sandbox environment must contain at most ${MAX_CONTAINER_ENVIRONMENT_ENTRIES} entries`,
    );
  }
  const lines = entries.map(([name, value]) => {
    validateContainerEnvName(name);
    if (name === "HOME" || name === "TMPDIR") {
      throw new Error(
        `Container sandbox environment name is reserved: ${name}`,
      );
    }
    if (/[\u0000\r\n]/u.test(value)) {
      throw new Error(
        `Container sandbox environment value is invalid: ${name}`,
      );
    }
    return `${name}=${value}`;
  });
  const serialized = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  if (Buffer.byteLength(serialized, "utf8") > MAX_CONTAINER_ENVIRONMENT_BYTES) {
    throw new Error(
      `Container sandbox environment must be at most ${MAX_CONTAINER_ENVIRONMENT_BYTES} bytes`,
    );
  }
  return serialized;
}

/**
 * Base directory for the container sandbox scratch home. Defaults to the OS
 * temp dir, which Docker Desktop and Linux share into containers. Hosts whose
 * VM only mounts a subtree (for example colima sharing $HOME) can point this at
 * a mount-visible path so bind mounts resolve inside the guest. A configured
 * directory is created if it does not exist so the guidance is self-sufficient.
 */
export async function containerScratchBaseDir(): Promise<string> {
  const configured = process.env[CONTAINER_SCRATCH_DIR_ENV]?.trim();
  if (configured && path.isAbsolute(configured)) {
    await mkdir(configured, { recursive: true });
    return configured;
  }
  return tmpdir();
}

/**
 * Resolves the executable an OCI launch will spawn. An injected absolute path
 * is verified as-is; otherwise the container runtime is resolved from PATH.
 */
export async function resolveContainerLaunchExecutable(
  injected: string | undefined,
): Promise<string> {
  if (injected) {
    if (await isExecutableFile(injected)) return injected;
    throw new Error(
      `OCI container sandbox requires an executable at ${injected}`,
    );
  }
  const resolved = await resolveContainerExecutable();
  if (!resolved) {
    throw new Error(
      "OCI container sandbox requires a container runtime (docker) on PATH",
    );
  }
  return resolved;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(
  candidate: string,
  platform: NodeJS.Platform,
): string[] {
  if (
    platform !== "win32" ||
    path.extname(candidate).toLowerCase() === ".exe"
  ) {
    return [candidate];
  }
  return [`${candidate}.exe`];
}

export function validateContainerImage(image: string): void {
  if (
    !image ||
    image.length > 200 ||
    /[\s\u0000-\u001f\u007f]/.test(image) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)
  ) {
    throw new Error("OCI container sandbox image is invalid");
  }
}

export function validateContainerEnvName(name: string): void {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name)) {
    throw new Error(`Container sandbox environment name is invalid: ${name}`);
  }
}

import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const CONTAINER_IMAGE_ENV = "NAPIER_CONTAINER_SANDBOX_IMAGE";
const CONTAINER_EXECUTABLE_CANDIDATES = ["docker"] as const;
const CONTAINER_SCRATCH_DIR_ENV = "NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR";

/**
 * Resolves a container runtime executable from PATH so the OCI sandbox works
 * with Homebrew, colima, and other non-`/usr/bin` installs. Only absolute,
 * executable candidates are accepted; returns undefined when none resolve.
 */
export async function resolveContainerExecutable(
  candidates: readonly string[] = CONTAINER_EXECUTABLE_CANDIDATES,
  pathValue: string | undefined = process.env["PATH"],
): Promise<string | undefined> {
  const directories = (pathValue ?? "").split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (await isExecutableFile(candidate)) return candidate;
      continue;
    }
    for (const directory of directories) {
      const resolved = path.join(directory, candidate);
      if (await isExecutableFile(resolved)) return resolved;
    }
  }
  return undefined;
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

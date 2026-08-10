import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const MAX_SHELL_RUNTIME_READ_PATHS = 8;
const POSIX_COMMAND_PATHS = ["/usr/bin", "/bin"] as const;

export interface ShellCommandRuntimePaths {
  executableSearchPaths: string[];
  runtimeReadPaths: string[];
}

export async function defaultShellExecutable(
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform === "win32") {
    const systemRoot = process.env["SystemRoot"]?.trim() || "C:\\Windows";
    return path.join(systemRoot, "System32", "cmd.exe");
  }
  if (platform === "darwin" || platform === "linux") return "/bin/sh";
  throw new Error(`shell runtime is unavailable on ${platform}`);
}

export function shellInvocationArgs(
  script: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32" ? ["/d", "/s", "/c", script] : ["-c", script];
}

export async function resolveShellCommandRuntimePaths(
  executable: string,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
): Promise<ShellCommandRuntimePaths> {
  const candidates =
    platform === "win32"
      ? [path.dirname(executable), path.dirname(nodeExecutable)]
      : [
          path.dirname(executable),
          path.dirname(nodeExecutable),
          ...POSIX_COMMAND_PATHS,
        ];
  const executableSearchPaths = await existingDirectories(candidates);
  const runtimeReadPaths = [...executableSearchPaths];
  const nodeBin = await canonicalDirectory(path.dirname(nodeExecutable));
  const standardCommandPaths = new Set(
    await existingDirectories(
      platform === "win32" ? [path.dirname(executable)] : POSIX_COMMAND_PATHS,
    ),
  );
  if (nodeBin && !standardCommandPaths.has(nodeBin)) {
    const nodeDistributionRoot = await canonicalDirectory(
      path.dirname(nodeBin),
    );
    if (
      nodeDistributionRoot &&
      !runtimeReadPaths.includes(nodeDistributionRoot)
    ) {
      runtimeReadPaths.push(nodeDistributionRoot);
    }
  }
  if (
    executableSearchPaths.length === 0 ||
    runtimeReadPaths.length > MAX_SHELL_RUNTIME_READ_PATHS
  ) {
    throw new Error("shell runtime command paths are unavailable");
  }
  return { executableSearchPaths, runtimeReadPaths };
}

async function existingDirectories(
  candidates: readonly string[],
): Promise<string[]> {
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const canonical = await canonicalDirectory(candidate);
    if (canonical && !resolved.includes(canonical)) resolved.push(canonical);
  }
  return resolved;
}

async function canonicalDirectory(
  candidate: string,
): Promise<string | undefined> {
  try {
    const canonical = await realpath(candidate);
    return (await stat(canonical)).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

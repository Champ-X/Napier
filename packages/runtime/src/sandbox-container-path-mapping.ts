import path from "node:path";

import type { ContainerUserIdentity } from "./sandbox-container-runtime.js";
import type { SandboxLaunchRequest } from "./sandbox-types.js";

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_RUNTIME_ROOT = "/opt/napier-host-runtime";
const HOST_PATH_ENVIRONMENT_NAMES = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
]);

export interface OciContainerPathMapping {
  cwd: string;
  command: string;
  args: string[];
  environment: Record<string, string>;
  workspaceTarget: string;
  writeTargets: string[];
  runtimeTargets: string[];
}

export function createOciContainerPathMapping(
  request: SandboxLaunchRequest,
  user: ContainerUserIdentity,
  hostPlatform: NodeJS.Platform = process.platform,
): OciContainerPathMapping {
  if (user.mapping !== "portable-non-posix") {
    return {
      cwd: request.cwd,
      command: request.command,
      args: [...request.args],
      environment: { ...request.env },
      workspaceTarget: request.workspaceRoot,
      writeTargets: [...(request.workspaceWritePaths ?? [])],
      runtimeTargets: [...(request.runtimeReadPaths ?? [])],
    };
  }
  const hostPath = hostPlatform === "win32" ? path.win32 : path.posix;
  const workspaceRoot = hostPath.resolve(request.workspaceRoot);
  const runtimeRoots = (request.runtimeReadPaths ?? []).map((value, index) => ({
    host: hostPath.resolve(value),
    container: path.posix.join(CONTAINER_RUNTIME_ROOT, String(index)),
  }));
  const map = (value: string, label: string, requireMapped = false): string => {
    if (!portableHostPath(value, hostPlatform)) return value;
    const resolved = hostPath.resolve(value);
    const workspaceRelative = relativeInside(hostPath, resolved, workspaceRoot);
    if (workspaceRelative !== undefined) {
      return containerPath(
        CONTAINER_WORKSPACE_ROOT,
        workspaceRelative,
        hostPath,
      );
    }
    for (const runtime of runtimeRoots) {
      const relative = relativeInside(hostPath, resolved, runtime.host);
      if (relative !== undefined) {
        return containerPath(runtime.container, relative, hostPath);
      }
    }
    if (requireMapped) {
      throw new Error(`Portable OCI ${label} path is outside approved mounts`);
    }
    return value;
  };
  const environment = Object.fromEntries(
    Object.entries(request.env).map(([name, value]) => [
      name,
      HOST_PATH_ENVIRONMENT_NAMES.has(name)
        ? map(value, "environment", true)
        : value,
    ]),
  );
  if (path.posix.basename(request.command) === "git") {
    Object.assign(environment, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: CONTAINER_WORKSPACE_ROOT,
    });
  }
  return {
    cwd: map(request.cwd, "cwd", true),
    command: map(request.command, "command", hostPlatform === "win32"),
    args: request.args.map((value) =>
      map(value, "argument", hostPlatform === "win32"),
    ),
    environment,
    workspaceTarget: CONTAINER_WORKSPACE_ROOT,
    writeTargets: (request.workspaceWritePaths ?? []).map((value) =>
      map(value, "write", true),
    ),
    runtimeTargets: runtimeRoots.map((value) => value.container),
  };
}

function portableHostPath(value: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\]+\\[^\\]+/u.test(value);
  }
  return path.posix.isAbsolute(value);
}

function relativeInside(
  hostPath: typeof path.posix | typeof path.win32,
  candidate: string,
  root: string,
): string | undefined {
  const relative = hostPath.relative(root, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${hostPath.sep}`) &&
      relative !== ".." &&
      !hostPath.isAbsolute(relative))
    ? relative
    : undefined;
}

function containerPath(
  root: string,
  relative: string,
  hostPath: typeof path.posix | typeof path.win32,
): string {
  if (relative === "") return root;
  return path.posix.join(root, ...relative.split(hostPath.sep));
}

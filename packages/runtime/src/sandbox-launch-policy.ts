import path from "node:path";

import type { SandboxLaunchRequest } from "./sandbox-types.js";
import { validateTerminalDimensions } from "./sandbox-terminal.js";

const MAX_SANDBOX_PATHS = 8;

export function validateLaunchRequest(request: SandboxLaunchRequest): void {
  if (!path.isAbsolute(request.command)) {
    throw new Error("Sandboxed commands must use an absolute executable path");
  }
  if (!path.isAbsolute(request.cwd)) {
    throw new Error("Sandboxed process cwd must be absolute");
  }
  if (!path.isAbsolute(request.workspaceRoot)) {
    throw new Error("Sandbox workspace root must be absolute");
  }
  if (!isPathInside(request.cwd, request.workspaceRoot)) {
    throw new Error("Sandboxed process cwd must stay inside the workspace");
  }
  if (!request.approvedCapabilities.includes("process.spawn")) {
    throw new Error("Sandbox launch requires approved process.spawn");
  }
  if (
    request.approvedCapabilities.includes("workspace.write") &&
    !request.approvedCapabilities.includes("workspace.read")
  ) {
    throw new Error("workspace.write requires workspace.read");
  }
  scopedWorkspaceWritePaths(request);
  if (
    request.runtimeReadPaths !== undefined &&
    (request.runtimeReadPaths.length > MAX_SANDBOX_PATHS ||
      request.runtimeReadPaths.some(
        (runtimePath) =>
          !path.isAbsolute(runtimePath) ||
          path.resolve(runtimePath) === path.parse(runtimePath).root ||
          /[\u0000-\u001f\u007f]/u.test(runtimePath),
      ))
  ) {
    throw new Error(
      `Sandbox runtime read paths must contain at most ${MAX_SANDBOX_PATHS} absolute non-root paths`,
    );
  }
  validateTerminalDimensions(request.terminal);
}

export function scopedWorkspaceWritePaths(
  request: SandboxLaunchRequest,
): string[] {
  const paths = request.workspaceWritePaths ?? [];
  if (
    paths.length > 0 &&
    !request.approvedCapabilities.includes("workspace.write")
  ) {
    throw new Error("Sandbox workspace write paths require workspace.write");
  }
  if (
    paths.length > MAX_SANDBOX_PATHS ||
    paths.some(
      (writePath) =>
        !path.isAbsolute(writePath) ||
        path.resolve(writePath) === path.resolve(request.workspaceRoot) ||
        !isPathInside(writePath, request.workspaceRoot) ||
        /[\u0000-\u001f\u007f]/u.test(writePath),
    ) ||
    new Set(paths.map((writePath) => path.resolve(writePath))).size !==
      paths.length
  ) {
    throw new Error(
      `Sandbox workspace write paths must contain at most ${MAX_SANDBOX_PATHS} distinct absolute non-root workspace paths`,
    );
  }
  const resolved = paths.map((writePath) => path.resolve(writePath)).sort();
  if (
    resolved.some((candidate, index) =>
      resolved.some(
        (other, otherIndex) =>
          index !== otherIndex && isPathInside(candidate, other),
      ),
    )
  ) {
    throw new Error("Sandbox workspace write paths cannot overlap");
  }
  return resolved;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

import path from "node:path";

import type { SandboxLaunchRequest } from "./sandbox-types.js";
import {
  rejectLocalServiceForProvider,
  validateSandboxLocalService,
} from "./sandbox-local-service-policy.js";
import { validateTerminalDimensions } from "./sandbox-terminal.js";

const MAX_SANDBOX_PATHS = 8;

export function validateLaunchRequest(
  request: SandboxLaunchRequest,
  platform: NodeJS.Platform = process.platform,
): void {
  const hostPath = platformPath(platform);
  if (request.signal?.aborted) {
    throw new Error("Sandbox launch was aborted");
  }
  if (!hostPath.isAbsolute(request.command)) {
    throw new Error("Sandboxed commands must use an absolute executable path");
  }
  if (!hostPath.isAbsolute(request.cwd)) {
    throw new Error("Sandboxed process cwd must be absolute");
  }
  if (!hostPath.isAbsolute(request.workspaceRoot)) {
    throw new Error("Sandbox workspace root must be absolute");
  }
  if (!isPathInside(request.cwd, request.workspaceRoot, hostPath)) {
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
  scopedWorkspaceWritePaths(request, platform);
  validateSandboxLocalService(request);
  if (
    request.stdinMode === "open" &&
    (request.terminal !== undefined || request.localService !== undefined)
  ) {
    throw new Error(
      "Sandbox open stdin cannot be combined with PTY or local service mode",
    );
  }
  if (
    request.runtimeReadPaths !== undefined &&
    (request.runtimeReadPaths.length > MAX_SANDBOX_PATHS ||
      request.runtimeReadPaths.some(
        (runtimePath) =>
          !hostPath.isAbsolute(runtimePath) ||
          hostPath.resolve(runtimePath) === hostPath.parse(runtimePath).root ||
          /[\u0000-\u001f\u007f]/u.test(runtimePath),
      ))
  ) {
    throw new Error(
      `Sandbox runtime read paths must contain at most ${MAX_SANDBOX_PATHS} absolute non-root paths`,
    );
  }
  validateTerminalDimensions(request.terminal);
}

export function validateNonContainerLaunchRequest(
  request: SandboxLaunchRequest,
  providerId: string,
): void {
  validateLaunchRequest(request);
  rejectLocalServiceForProvider(request, providerId);
}

export function scopedWorkspaceWritePaths(
  request: SandboxLaunchRequest,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const hostPath = platformPath(platform);
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
        !hostPath.isAbsolute(writePath) ||
        hostPath.resolve(writePath) ===
          hostPath.resolve(request.workspaceRoot) ||
        !isPathInside(writePath, request.workspaceRoot, hostPath) ||
        /[\u0000-\u001f\u007f]/u.test(writePath),
    ) ||
    new Set(paths.map((writePath) => hostPath.resolve(writePath))).size !==
      paths.length
  ) {
    throw new Error(
      `Sandbox workspace write paths must contain at most ${MAX_SANDBOX_PATHS} distinct absolute non-root workspace paths`,
    );
  }
  const resolved = paths.map((writePath) => hostPath.resolve(writePath)).sort();
  if (
    resolved.some((candidate, index) =>
      resolved.some(
        (other, otherIndex) =>
          index !== otherIndex && isPathInside(candidate, other, hostPath),
      ),
    )
  ) {
    throw new Error("Sandbox workspace write paths cannot overlap");
  }
  return resolved;
}

function isPathInside(
  candidate: string,
  root: string,
  hostPath: typeof path.posix | typeof path.win32 = platformPath(
    process.platform,
  ),
): boolean {
  const relative = hostPath.relative(
    hostPath.resolve(root),
    hostPath.resolve(candidate),
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${hostPath.sep}`) &&
      relative !== ".." &&
      !hostPath.isAbsolute(relative))
  );
}

function platformPath(
  platform: NodeJS.Platform,
): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

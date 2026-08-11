import path from "node:path";

import {
  type ContainerImageIdentity,
  type ContainerUserIdentity,
  validateOciContainerName,
} from "./sandbox-container-runtime.js";
import {
  createOciContainerPathMapping,
  type OciContainerPathMapping,
} from "./sandbox-container-path-mapping.js";
import { validateContainerServiceNetworkName } from "./sandbox-container-service.js";
import { OCI_PROCESS_RESOURCE_ARGUMENTS } from "./sandbox-container-policy.js";
import {
  serializeContainerEnvironment,
  validateContainerImage,
} from "./sandbox-container.js";
import {
  scopedWorkspaceWritePaths,
  validateLaunchRequest,
} from "./sandbox-launch-policy.js";
import type { SandboxLaunchRequest } from "./sandbox-types.js";

export function buildOciContainerArgs(
  request: SandboxLaunchRequest,
  sandboxHome: string,
  image: string,
  containerName: string,
  user: ContainerUserIdentity,
  serviceNetworkName?: string,
  imagePlatform: ContainerImageIdentity["imagePlatform"] = "linux/arm64",
  pathMapping: OciContainerPathMapping = createOciContainerPathMapping(
    request,
    user,
  ),
  hostPlatform: NodeJS.Platform = process.platform,
): string[] {
  const hostPath = hostPlatform === "win32" ? path.win32 : path.posix;
  validateLaunchRequest(request, hostPlatform);
  if (!hostPath.isAbsolute(sandboxHome)) {
    throw new Error("Container sandbox home must be absolute");
  }
  validateContainerImage(image);
  if (!["linux/amd64", "linux/arm64"].includes(imagePlatform)) {
    throw new Error("OCI container image platform is invalid");
  }
  validateOciContainerName(containerName);
  validateContainerUserIdentity(user);
  validateServiceNetwork(request, serviceNetworkName);
  serializeContainerEnvironment(request.env);
  const capabilities = new Set(request.approvedCapabilities);
  const writePaths = scopedWorkspaceWritePaths(request, hostPlatform);
  const workspaceMounted =
    capabilities.has("workspace.read") || capabilities.has("workspace.write");
  const args = [
    "run",
    "--platform",
    imagePlatform,
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
    ...OCI_PROCESS_RESOURCE_ARGUMENTS,
    "--network",
    request.localService
      ? serviceNetworkName!
      : capabilities.has("network.connect")
        ? "bridge"
        : "none",
    "--tmpfs",
    `/home/napier:rw,nosuid,nodev,size=64m,mode=0700,uid=${String(user.userId)},gid=${String(user.groupId)}`,
    "--workdir",
    workspaceMounted ? pathMapping.cwd : "/tmp",
    "--env",
    "HOME=/home/napier",
    "--env",
    "TMPDIR=/tmp",
    "--env-file",
    containerEnvironmentFile(sandboxHome, hostPlatform),
  ];
  if (workspaceMounted) {
    args.push(
      "--mount",
      bindMount(
        request.workspaceRoot,
        pathMapping.workspaceTarget,
        !capabilities.has("workspace.write") || writePaths.length > 0,
        hostPlatform,
      ),
    );
    for (const [index, writePath] of writePaths.entries()) {
      args.push(
        "--mount",
        bindMount(
          writePath,
          pathMapping.writeTargets[index]!,
          false,
          hostPlatform,
        ),
      );
    }
  }
  for (const [index, runtimePath] of (
    request.runtimeReadPaths ?? []
  ).entries()) {
    args.push(
      "--mount",
      bindMount(
        runtimePath,
        pathMapping.runtimeTargets[index]!,
        true,
        hostPlatform,
      ),
    );
  }
  args.push(image, pathMapping.command, ...pathMapping.args);
  return args;
}

export function containerEnvironmentFile(
  sandboxHome: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return (platform === "win32" ? path.win32 : path.posix).join(
    sandboxHome,
    "environment.list",
  );
}

function validateServiceNetwork(
  request: SandboxLaunchRequest,
  serviceNetworkName: string | undefined,
): void {
  if (request.localService) {
    if (!serviceNetworkName) {
      throw new Error("OCI local service network identity is required");
    }
    validateContainerServiceNetworkName(serviceNetworkName);
  } else if (serviceNetworkName !== undefined) {
    throw new Error("OCI local service network identity is unexpected");
  }
}

function bindMount(
  source: string,
  target: string,
  readonly: boolean,
  platform: NodeJS.Platform,
): string {
  const hostPath = platform === "win32" ? path.win32 : path.posix;
  return [
    "type=bind",
    `source=${hostPath.resolve(source)}`,
    `target=${path.posix.resolve(target)}`,
    readonly ? "readonly" : "",
  ]
    .filter(Boolean)
    .join(",");
}

function validateContainerUserIdentity(user: ContainerUserIdentity): void {
  if (
    !Number.isSafeInteger(user.userId) ||
    user.userId < 0 ||
    user.userId > 2_147_483_647 ||
    !Number.isSafeInteger(user.groupId) ||
    user.groupId < 0 ||
    user.groupId > 2_147_483_647 ||
    !["host-posix", "portable-non-posix", "injected"].includes(user.mapping) ||
    !/^[a-f0-9]{64}$/u.test(user.identitySha256)
  ) {
    throw new Error("OCI container user identity is invalid");
  }
}

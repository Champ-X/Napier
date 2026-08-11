import path from "node:path";

import {
  type ContainerImageIdentity,
  type ContainerUserIdentity,
  validateOciContainerName,
} from "./sandbox-container-runtime.js";
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
): string[] {
  validateLaunchRequest(request);
  if (!path.isAbsolute(sandboxHome)) {
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
  const writePaths = scopedWorkspaceWritePaths(request);
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
    workspaceMounted ? request.cwd : "/tmp",
    "--env",
    "HOME=/home/napier",
    "--env",
    "TMPDIR=/tmp",
    "--env-file",
    containerEnvironmentFile(sandboxHome),
  ];
  if (workspaceMounted) {
    args.push(
      "--mount",
      bindMount(
        request.workspaceRoot,
        request.workspaceRoot,
        !capabilities.has("workspace.write") || writePaths.length > 0,
      ),
    );
    for (const writePath of writePaths) {
      args.push("--mount", bindMount(writePath, writePath, false));
    }
  }
  for (const runtimePath of request.runtimeReadPaths ?? []) {
    args.push("--mount", bindMount(runtimePath, runtimePath, true));
  }
  args.push(image, request.command, ...request.args);
  return args;
}

export function containerEnvironmentFile(sandboxHome: string): string {
  return path.join(sandboxHome, "environment.list");
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

function bindMount(source: string, target: string, readonly: boolean): string {
  return [
    "type=bind",
    `source=${path.resolve(source)}`,
    `target=${path.resolve(target)}`,
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
    !/^[a-f0-9]{64}$/u.test(user.identitySha256)
  ) {
    throw new Error("OCI container user identity is invalid");
  }
}

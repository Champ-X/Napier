import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-runtime.js";
import { CONTAINER_RUNTIME_IDENTITY_SOURCE } from "./container-runtime-probe-source.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  containerClientEnvironment,
  resolveContainerLaunchExecutable,
  validateContainerImage,
} from "./sandbox-container.js";
import type {
  SandboxCommandRuntime,
  SandboxCommandRuntimeBinding,
} from "./sandbox-types.js";

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const FILE_SHA256 = /^[a-f0-9]{64}$/u;
const OCI_CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const MAX_POSIX_ID = 2_147_483_647;
const CONTAINER_CLIENT_TIMEOUT_MS = 10_000;
const MAX_CONTAINER_IDENTITY_OUTPUT_BYTES = 4_096;

export interface ContainerImageIdentity {
  imageId: string;
  clientExecutable: string;
  clientExecutableSha256: string;
  daemon: ContainerDaemonIdentity;
  user: ContainerUserIdentity;
  identitySha256: string;
}

export interface ContainerDaemonIdentity {
  location: "local";
  endpointSha256: string;
}

export interface ContainerUserIdentity {
  userId: number;
  groupId: number;
  identitySha256: string;
}

export interface ContainerUserIds {
  userId: number;
  groupId: number;
}

export type ContainerClient = (
  executable: string,
  args: readonly string[],
) => Promise<string>;

interface ContainerRuntimeIdentityOutput {
  node: ContainerExecutableIdentity;
  shell: ContainerExecutableIdentity | null;
  git: ContainerGitIdentity | null;
  python: ContainerPythonIdentity | null;
}

interface ContainerExecutableIdentity {
  executable: string;
  executableSha256: string;
}

interface ContainerPythonIdentity extends ContainerExecutableIdentity {
  version: string;
}

interface ContainerGitIdentity extends ContainerExecutableIdentity {
  version: string;
}

export async function resolveContainerImageIdentity(
  image: string,
  injectedExecutable?: string,
  client: ContainerClient = runContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<ContainerImageIdentity> {
  validateContainerImage(image);
  const executable = await resolveContainerLaunchExecutable(injectedExecutable);
  const clientExecutable = await realpath(executable);
  if (!(await stat(clientExecutable)).isFile()) {
    throw new Error("OCI container client identity is unavailable");
  }
  const clientExecutableSha256 = await sha256File(clientExecutable);
  const daemon = await resolveContainerDaemonIdentity(
    clientExecutable,
    client,
    injectedDaemonEndpoint,
  );
  const imageId = (
    await client(clientExecutable, [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      image,
    ])
  ).trim();
  if (!IMAGE_ID.test(imageId)) {
    throw new Error("OCI container image did not resolve to an immutable ID");
  }
  const user = resolveContainerUserIdentity(injectedUserIds);
  return {
    imageId,
    clientExecutable,
    clientExecutableSha256,
    daemon,
    user,
    identitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-image-identity",
        imageId,
        clientExecutablePathSha256: sha256(clientExecutable),
        clientExecutableSha256,
        daemonEndpointSha256: daemon.endpointSha256,
        userIdentitySha256: user.identitySha256,
      }),
    ),
  };
}

export async function resolveContainerDaemonIdentity(
  clientExecutable: string,
  client: ContainerClient = runContainerClient,
  injectedEndpoint?: string,
): Promise<ContainerDaemonIdentity> {
  const explicitHost = process.env["DOCKER_HOST"]?.trim();
  const explicitContext = process.env["DOCKER_CONTEXT"]?.trim();
  const endpoint = (
    injectedEndpoint ??
    (explicitHost && !explicitContext
      ? explicitHost
      : await client(clientExecutable, [
          "context",
          "inspect",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ]))
  ).trim();
  if (
    endpoint.length === 0 ||
    endpoint.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(endpoint) ||
    !isLocalContainerEndpoint(endpoint)
  ) {
    throw new Error("OCI sandbox requires a local Docker daemon endpoint");
  }
  return {
    location: "local",
    endpointSha256: sha256(endpoint),
  };
}

export function resolveContainerUserIdentity(
  injected?: ContainerUserIds,
): ContainerUserIdentity {
  const observed =
    injected ??
    (typeof process.getuid === "function" &&
    typeof process.getgid === "function"
      ? { userId: process.getuid(), groupId: process.getgid() }
      : undefined);
  if (
    !observed ||
    !Number.isSafeInteger(observed.userId) ||
    observed.userId < 0 ||
    observed.userId > MAX_POSIX_ID ||
    !Number.isSafeInteger(observed.groupId) ||
    observed.groupId < 0 ||
    observed.groupId > MAX_POSIX_ID
  ) {
    throw new Error("OCI container host user identity is unavailable");
  }
  return {
    userId: observed.userId,
    groupId: observed.groupId,
    identitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-user-identity",
        userId: observed.userId,
        groupId: observed.groupId,
      }),
    ),
  };
}

function isLocalContainerEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("unix://")) {
    return endpoint.slice("unix://".length).startsWith("/");
  }
  const lower = endpoint.toLowerCase();
  return (
    lower.startsWith("npipe:////./pipe/") || /^fd:\/\/(?:[0-9]+)?$/u.test(lower)
  );
}

export async function assertContainerImageIdentityStable(
  identity: ContainerImageIdentity,
  client: ContainerClient = runContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<void> {
  if (
    (await sha256File(identity.clientExecutable)) !==
    identity.clientExecutableSha256
  ) {
    throw new Error("OCI container client identity changed");
  }
  const daemon = await resolveContainerDaemonIdentity(
    identity.clientExecutable,
    client,
    injectedDaemonEndpoint,
  );
  if (daemon.endpointSha256 !== identity.daemon.endpointSha256) {
    throw new Error("OCI container daemon identity changed");
  }
  const user = resolveContainerUserIdentity(injectedUserIds);
  if (user.identitySha256 !== identity.user.identitySha256) {
    throw new Error("OCI container host user identity changed");
  }
}

export async function resolveContainerCommandRuntime(
  identity: ContainerImageIdentity,
  runtime: SandboxCommandRuntime,
  client: ContainerClient = runContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<SandboxCommandRuntimeBinding> {
  await assertContainerImageIdentityStable(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  const output = await client(identity.clientExecutable, [
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--user",
    `${String(identity.user.userId)}:${String(identity.user.groupId)}`,
    "--pids-limit",
    "32",
    "--memory",
    "128m",
    "--cpus",
    "0.25",
    "--entrypoint",
    "node",
    identity.imageId,
    "-e",
    CONTAINER_RUNTIME_IDENTITY_SOURCE,
  ]);
  const observed = parseRuntimeIdentity(output);
  const selected =
    runtime === "node"
      ? observed.node
      : runtime === "shell"
        ? observed.shell
        : runtime === "python"
          ? observed.python
          : observed.git;
  if (!selected) {
    throw new Error(`OCI image-bound ${runtime} runtime is unavailable`);
  }
  const executableSearchPaths = [
    path.posix.dirname(observed.node.executable),
    path.posix.dirname(selected.executable),
    "/usr/bin",
    "/bin",
  ].filter((value, index, values) => values.indexOf(value) === index);
  return {
    runtime,
    executable: selected.executable,
    executableSha256: selected.executableSha256,
    ...(runtime === "shell" ? { executableSearchPaths } : {}),
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-command-runtime-identity",
        imageIdentitySha256: identity.identitySha256,
        runtime,
        executable: selected.executable,
        executableSha256: selected.executableSha256,
        ...(runtime === "python"
          ? { pythonVersion: observed.python!.version }
          : {}),
        ...(runtime === "git" ? { gitVersion: observed.git!.version } : {}),
      }),
    ),
  };
}

export async function removeContainerResource(
  identity: ContainerImageIdentity,
  containerName: string,
  client: ContainerClient = runContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<void> {
  validateOciContainerName(containerName);
  await assertContainerImageIdentityStable(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  try {
    await client(identity.clientExecutable, [
      "container",
      "rm",
      "--force",
      containerName,
    ]);
    return;
  } catch {
    const remaining = await client(identity.clientExecutable, [
      "container",
      "ls",
      "--all",
      "--filter",
      `name=^/${containerName}$`,
      "--format",
      "{{.ID}}",
    ]);
    if (remaining.trim() === "") return;
    throw new Error("OCI container resource cleanup failed");
  }
}

export function validateOciContainerName(containerName: string): void {
  if (!OCI_CONTAINER_NAME.test(containerName)) {
    throw new Error("OCI container resource identity is invalid");
  }
}

function runContainerClient(
  executable: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        env: containerClientEnvironment(),
        timeout: CONTAINER_CLIENT_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_CONTAINER_IDENTITY_OUTPUT_BYTES,
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

function parseRuntimeIdentity(output: string): ContainerRuntimeIdentityOutput {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("OCI container runtime identity output is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OCI container runtime identity output is invalid");
  }
  const record = value as Record<string, unknown>;
  return {
    node: executableIdentity(record["node"]),
    shell:
      record["shell"] === null ? null : executableIdentity(record["shell"]),
    git: record["git"] === null ? null : gitExecutableIdentity(record["git"]),
    python:
      record["python"] === null
        ? null
        : pythonExecutableIdentity(record["python"]),
  };
}

function gitExecutableIdentity(value: unknown): ContainerGitIdentity {
  const executable = executableIdentity(value);
  const version = (value as Record<string, unknown>)["version"];
  if (
    typeof version !== "string" ||
    !/^git version [^\u0000-\u001f\u007f]{1,160}$/u.test(version)
  ) {
    throw new Error("OCI container Git identity is invalid");
  }
  return { ...executable, version };
}

function pythonExecutableIdentity(value: unknown): ContainerPythonIdentity {
  const executable = executableIdentity(value);
  const version = (value as Record<string, unknown>)["version"];
  if (typeof version !== "string") {
    throw new Error("OCI container Python identity is invalid");
  }
  const match = /^3\.(\d+)\.(\d+)$/u.exec(version);
  if (!match || Number(match[1]) < 9) {
    throw new Error("OCI container Python identity is invalid");
  }
  return { ...executable, version };
}

function executableIdentity(value: unknown): ContainerExecutableIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OCI container executable identity is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["executable"] !== "string" ||
    !record["executable"].startsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(record["executable"]) ||
    typeof record["executableSha256"] !== "string" ||
    !FILE_SHA256.test(record["executableSha256"])
  ) {
    throw new Error("OCI container executable identity is invalid");
  }
  return {
    executable: record["executable"],
    executableSha256: record["executableSha256"],
  };
}

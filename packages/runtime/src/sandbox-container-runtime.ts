import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-runtime.js";
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
const CONTAINER_CLIENT_TIMEOUT_MS = 10_000;
const MAX_CONTAINER_IDENTITY_OUTPUT_BYTES = 4_096;
const RUNTIME_IDENTITY_SOURCE = String.raw`
const crypto = require("node:crypto");
const fs = require("node:fs");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const identity = (file) => { const executable = fs.realpathSync(file); return { executable, executableSha256: hash(executable) }; };
let shell = null;
try { shell = identity("/bin/sh"); } catch {}
process.stdout.write(JSON.stringify({ node: identity(process.execPath), shell }));
`;

export interface ContainerImageIdentity {
  imageId: string;
  clientExecutable: string;
  clientExecutableSha256: string;
  identitySha256: string;
}

export type ContainerClient = (
  executable: string,
  args: readonly string[],
) => Promise<string>;

interface ContainerRuntimeIdentityOutput {
  node: ContainerExecutableIdentity;
  shell: ContainerExecutableIdentity | null;
}

interface ContainerExecutableIdentity {
  executable: string;
  executableSha256: string;
}

export async function resolveContainerImageIdentity(
  image: string,
  injectedExecutable?: string,
  client: ContainerClient = runContainerClient,
): Promise<ContainerImageIdentity> {
  validateContainerImage(image);
  const executable = await resolveContainerLaunchExecutable(injectedExecutable);
  const clientExecutable = await realpath(executable);
  if (!(await stat(clientExecutable)).isFile()) {
    throw new Error("OCI container client identity is unavailable");
  }
  const clientExecutableSha256 = await sha256File(clientExecutable);
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
  return {
    imageId,
    clientExecutable,
    clientExecutableSha256,
    identitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-image-identity",
        imageId,
        clientExecutablePathSha256: sha256(clientExecutable),
        clientExecutableSha256,
      }),
    ),
  };
}

export async function assertContainerImageIdentityStable(
  identity: ContainerImageIdentity,
): Promise<void> {
  if (
    (await sha256File(identity.clientExecutable)) !==
    identity.clientExecutableSha256
  ) {
    throw new Error("OCI container client identity changed");
  }
}

export async function resolveContainerCommandRuntime(
  identity: ContainerImageIdentity,
  runtime: SandboxCommandRuntime,
  client: ContainerClient = runContainerClient,
): Promise<SandboxCommandRuntimeBinding> {
  if (runtime === "python") {
    throw new Error(
      "OCI image-bound Python runtime identity is not implemented",
    );
  }
  await assertContainerImageIdentityStable(identity);
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
    RUNTIME_IDENTITY_SOURCE,
  ]);
  const observed = parseRuntimeIdentity(output);
  const selected = runtime === "node" ? observed.node : observed.shell;
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
      }),
    ),
  };
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
  };
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

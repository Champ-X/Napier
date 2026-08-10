import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  type ContainerImageIdentity,
  resolveContainerImageIdentity,
} from "./sandbox-container-runtime.js";
import { OciContainerSandboxAdapter } from "./sandbox-oci.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";

const CONFIG_FILE = "sandbox.json";
const MAX_CONFIG_BYTES = 8 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface SandboxInstallation {
  kind: "napier.sandbox-installation";
  schemaVersion: 1;
  provider: "oci-container";
  imageReference: string;
  imageId: string;
  clientExecutableSha256: string;
  daemonEndpointSha256: string;
  userIdentitySha256: string;
  identitySha256: string;
  verifiedAt: string;
  contentSha256: string;
}

export async function loadSandboxInstallation(
  dataRoot: string,
): Promise<SandboxInstallation | undefined> {
  try {
    const filePath = configurationPath(dataRoot);
    const info = await lstat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_CONFIG_BYTES) {
      throw new Error("Sandbox installation file is invalid");
    }
    return validateSandboxInstallation(
      JSON.parse(await readFile(filePath, "utf8")) as unknown,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function saveSandboxInstallation(
  dataRoot: string,
  imageReference: string,
  identity: ContainerImageIdentity,
  now = new Date(),
): Promise<SandboxInstallation> {
  await mkdir(path.resolve(dataRoot), { recursive: true });
  const installation = createSandboxInstallation(imageReference, identity, now);
  await writeConfiguration(
    configurationPath(dataRoot),
    `${canonicalJson(installation)}\n`,
  );
  return installation;
}

export function createSandboxInstallation(
  imageReference: string,
  identity: ContainerImageIdentity,
  now = new Date(),
): SandboxInstallation {
  const withoutHash = {
    kind: "napier.sandbox-installation" as const,
    schemaVersion: 1 as const,
    provider: "oci-container" as const,
    imageReference,
    imageId: identity.imageId,
    clientExecutableSha256: identity.clientExecutableSha256,
    daemonEndpointSha256: identity.daemon.endpointSha256,
    userIdentitySha256: identity.user.identitySha256,
    identitySha256: identity.identitySha256,
    verifiedAt: now.toISOString(),
  };
  const installation = {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
  return installation;
}

export async function createConfiguredSandboxAdapter(input: {
  dataRoot: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<OsSandboxAdapter | undefined> {
  const explicitImage = input.env?.["NAPIER_CONTAINER_SANDBOX_IMAGE"]?.trim();
  if (explicitImage) return new OciContainerSandboxAdapter(explicitImage);
  const installation = await loadSandboxInstallation(input.dataRoot);
  if (!installation) return undefined;
  return new OciContainerSandboxAdapter(installation.imageId, {
    expectedIdentity: {
      clientExecutableSha256: installation.clientExecutableSha256,
      daemonEndpointSha256: installation.daemonEndpointSha256,
      userIdentitySha256: installation.userIdentitySha256,
      identitySha256: installation.identitySha256,
    },
  });
}

export async function assertSandboxInstallationCurrent(
  installation: SandboxInstallation,
): Promise<void> {
  const identity = await resolveContainerImageIdentity(installation.imageId);
  if (
    identity.imageId !== installation.imageId ||
    identity.clientExecutableSha256 !== installation.clientExecutableSha256 ||
    identity.daemon.endpointSha256 !== installation.daemonEndpointSha256 ||
    identity.user.identitySha256 !== installation.userIdentitySha256 ||
    identity.identitySha256 !== installation.identitySha256
  ) {
    throw new Error("Configured Sandbox runtime identity changed");
  }
}

export function validateSandboxInstallation(
  value: unknown,
): SandboxInstallation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sandbox installation is invalid");
  }
  const installation = value as Record<string, unknown>;
  const keys = [
    "clientExecutableSha256",
    "contentSha256",
    "daemonEndpointSha256",
    "identitySha256",
    "imageId",
    "imageReference",
    "kind",
    "provider",
    "schemaVersion",
    "userIdentitySha256",
    "verifiedAt",
  ].sort();
  if (canonicalJson(Object.keys(installation).sort()) !== canonicalJson(keys)) {
    throw new Error("Sandbox installation shape is invalid");
  }
  if (
    installation["kind"] !== "napier.sandbox-installation" ||
    installation["schemaVersion"] !== 1 ||
    installation["provider"] !== "oci-container" ||
    !imageReference(installation["imageReference"]) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(installation["imageId"])) ||
    !hashFields(installation) ||
    typeof installation["verifiedAt"] !== "string" ||
    Number.isNaN(Date.parse(installation["verifiedAt"]))
  ) {
    throw new Error("Sandbox installation content is invalid");
  }
  const { contentSha256, ...withoutHash } = installation;
  if (contentSha256 !== sha256(canonicalJson(withoutHash))) {
    throw new Error("Sandbox installation hash mismatch");
  }
  return installation as unknown as SandboxInstallation;
}

function hashFields(value: Record<string, unknown>): boolean {
  return [
    "clientExecutableSha256",
    "daemonEndpointSha256",
    "userIdentitySha256",
    "identitySha256",
    "contentSha256",
  ].every((key) => SHA256.test(String(value[key])));
}

function imageReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/u.test(value)
  );
}

function configurationPath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), CONFIG_FILE);
}

async function writeConfiguration(
  filePath: string,
  content: string,
): Promise<void> {
  const root = await realpath(path.dirname(filePath));
  const target = path.join(root, path.basename(filePath));
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

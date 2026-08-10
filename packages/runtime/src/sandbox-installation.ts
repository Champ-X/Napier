import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
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
import { createPlatformSandboxAdapter } from "./sandbox.js";
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

export interface SandboxInstallationBinding {
  status: "installed" | "invalid" | "not_installed";
  bindingSha256?: string;
  installation?: SandboxInstallation;
}

export async function inspectSandboxInstallationBinding(
  dataRoot: string,
): Promise<SandboxInstallationBinding> {
  const filePath = configurationPath(dataRoot);
  await recoverInterruptedSandboxRemoval(filePath);
  let bytes: Buffer;
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_CONFIG_BYTES) {
      return { status: "invalid" };
    }
    bytes = await readFile(filePath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { status: "not_installed" };
    }
    throw error;
  }
  const bindingSha256 = sha256(bytes);
  try {
    return {
      status: "installed",
      bindingSha256,
      installation: validateSandboxInstallation(
        JSON.parse(bytes.toString("utf8")) as unknown,
      ),
    };
  } catch {
    return { status: "invalid", bindingSha256 };
  }
}

export async function loadSandboxInstallation(
  dataRoot: string,
): Promise<SandboxInstallation | undefined> {
  try {
    const filePath = configurationPath(dataRoot);
    await recoverInterruptedSandboxRemoval(filePath);
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

export async function removeSandboxInstallation(
  dataRoot: string,
  expectedBindingSha256: string,
): Promise<void> {
  const root = await realpath(path.resolve(dataRoot));
  const filePath = path.join(root, CONFIG_FILE);
  const tombstone = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.remove`;
  await rename(filePath, tombstone);
  try {
    const info = await lstat(tombstone);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_CONFIG_BYTES) {
      throw new Error("Sandbox installation file is invalid");
    }
    const bytes = await readFile(tombstone);
    if (sha256(bytes) !== expectedBindingSha256) {
      throw new Error("Sandbox uninstall preview is stale");
    }
  } catch (error) {
    await rename(tombstone, filePath);
    throw error;
  }
  try {
    await rm(tombstone);
  } catch (error) {
    await rename(tombstone, filePath);
    throw error;
  }
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

export function createSandboxFallbackAdapter(input: {
  env?: Readonly<Record<string, string | undefined>>;
} = {}): OsSandboxAdapter {
  const environment = input.env ?? process.env;
  const explicitImage =
    environment["NAPIER_CONTAINER_SANDBOX_IMAGE"]?.trim();
  return explicitImage
    ? new OciContainerSandboxAdapter(explicitImage)
    : createPlatformSandboxAdapter(process.platform, { containerImage: "" });
}

export function createInvalidSandboxInstallationAdapter(): OsSandboxAdapter {
  return {
    id: "configured-sandbox-invalid",
    async launch() {
      throw new Error(
        "Persisted Sandbox configuration is invalid; process tasks fail closed",
      );
    },
  };
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

async function recoverInterruptedSandboxRemoval(
  filePath: string,
): Promise<void> {
  const directory = path.dirname(filePath);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  const tombstones = names.filter((name) =>
    /^sandbox\.json\.[0-9]+\.[a-f0-9]{16}\.remove$/u.test(name),
  );
  if (tombstones.length === 0) return;
  try {
    await lstat(filePath);
    throw new Error("Sandbox removal recovery found conflicting bindings");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  if (tombstones.length !== 1) {
    throw new Error("Sandbox removal recovery is ambiguous");
  }
  await rename(path.join(directory, tombstones[0]!), filePath);
}

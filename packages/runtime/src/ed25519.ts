import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export function parseEd25519PrivateKey(
  value: string,
  label: string,
): KeyObject {
  try {
    const key = value.startsWith("base64:")
      ? createPrivateKey({
          key: decodeCanonicalBase64(value.slice("base64:".length)),
          format: "der",
          type: "pkcs8",
        })
      : createPrivateKey(value);
    assertEd25519Key(key, label);
    return key;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${label} must be Ed25519`
    ) {
      throw error;
    }
    throw new Error(`${label} is not a valid PKCS#8 private key`);
  }
}

export function parseEd25519PublicKeySpki(
  value: string,
  label: string,
): KeyObject {
  if (typeof value !== "string" || value.length > 4_096) {
    throw new Error(`${label} public key is invalid`);
  }
  const bytes = decodeCanonicalBase64(value);
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    assertEd25519Key(key, label);
    return key;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${label} must be Ed25519`
    ) {
      throw error;
    }
    throw new Error(`${label} public key is invalid`);
  }
}

export function exportEd25519PublicKeySpki(key: KeyObject): string {
  assertEd25519Key(key, "Public key");
  return Buffer.from(key.export({ format: "der", type: "spki" })).toString(
    "base64",
  );
}

export function ed25519KeyId(publicKeySpki: string): string {
  return sha256(Buffer.from(publicKeySpki, "base64"));
}

export function signEd25519Statement(
  statement: unknown,
  privateKey: KeyObject,
): string {
  assertEd25519Key(privateKey, "Signing key");
  return sign(null, Buffer.from(canonicalJson(statement)), privateKey).toString(
    "base64url",
  );
}

export function verifyEd25519Statement(
  statement: unknown,
  signature: string,
  publicKey: KeyObject,
): boolean {
  assertEd25519Key(publicKey, "Verification key");
  return verify(
    null,
    Buffer.from(canonicalJson(statement)),
    publicKey,
    decodeEd25519Signature(signature),
  );
}

export function decodeEd25519Signature(value: string): Buffer {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > 128
  ) {
    throw new Error("Ed25519 signature value is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 64 || bytes.toString("base64url") !== value) {
    throw new Error("Ed25519 signature value is invalid");
  }
  return bytes;
}

export function assertEd25519Key(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} must be Ed25519`);
  }
}

export function decodeCanonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Base64 evidence is invalid");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new Error("Base64 evidence is invalid");
  }
  return bytes;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

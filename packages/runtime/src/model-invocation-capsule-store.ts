import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { ModelInvocationCapsuleReceipt } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import {
  createModelInvocationCapsule,
  createModelInvocationCapsuleReceipt,
  MAX_MODEL_INVOCATION_CAPSULE_BYTES,
  type CreateModelInvocationCapsuleInput,
  type ModelInvocationCapsule,
  validateModelInvocationCapsule,
} from "./model-invocation-capsule.js";

export const MAX_MODEL_INVOCATION_CAPSULES = 256;
export const MAX_MODEL_INVOCATION_CAPSULE_STORAGE_BYTES = 128 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;

export class ModelInvocationCapsuleStore {
  readonly rootPath: string;

  constructor(dataRoot: string) {
    this.rootPath = path.join(path.resolve(dataRoot), "model-invocations");
  }

  async put(
    input: CreateModelInvocationCapsuleInput,
  ): Promise<ModelInvocationCapsuleReceipt> {
    const capsule = createModelInvocationCapsule(input);
    const serialized = canonicalJson(capsule);
    const capsuleBytes = Buffer.byteLength(serialized, "utf8");
    if (capsuleBytes > MAX_MODEL_INVOCATION_CAPSULE_BYTES) {
      throw new Error("Model invocation capsule exceeds its byte limit");
    }
    await this.ensureRoot();
    const targetPath = this.pathFor(capsule.contentSha256);
    if (await pathExists(targetPath)) {
      const existing = await this.read(capsule.contentSha256);
      if (existing.contentSha256 !== capsule.contentSha256) {
        throw new Error("Model invocation capsule CAS collision");
      }
      return createModelInvocationCapsuleReceipt(existing, capsuleBytes);
    }
    await this.assertStorageCapacity(capsuleBytes);
    const temporaryPath = path.join(
      this.rootPath,
      `.${capsule.contentSha256}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      const installed = await linkExclusive(temporaryPath, targetPath);
      await unlink(temporaryPath);
      if (!installed) {
        const existing = await this.read(capsule.contentSha256);
        if (existing.contentSha256 !== capsule.contentSha256) {
          throw new Error("Model invocation capsule CAS collision");
        }
        return createModelInvocationCapsuleReceipt(existing, capsuleBytes);
      }
      await chmod(targetPath, 0o600);
      try {
        await this.assertStorageWithinLimits();
      } catch (error) {
        await unlink(targetPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return createModelInvocationCapsuleReceipt(capsule, capsuleBytes);
  }

  async read(capsuleSha256: string): Promise<ModelInvocationCapsule> {
    if (!HASH.test(capsuleSha256)) {
      throw new Error("Model invocation capsule SHA-256 is invalid");
    }
    const capsulePath = this.pathFor(capsuleSha256);
    const info = await lstat(capsulePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size > MAX_MODEL_INVOCATION_CAPSULE_BYTES
    ) {
      throw new Error("Model invocation capsule file is invalid");
    }
    const serialized = await readFile(capsulePath, "utf8");
    const capsule = validateModelInvocationCapsule(JSON.parse(serialized));
    if (capsule.contentSha256 !== capsuleSha256) {
      throw new Error("Model invocation capsule path binding is invalid");
    }
    return capsule;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const info = await lstat(this.rootPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Model invocation capsule directory is invalid");
    }
    await chmod(this.rootPath, 0o700);
  }

  private async assertStorageCapacity(nextBytes: number): Promise<void> {
    const entries = await this.capsuleEntries();
    if (entries.length >= MAX_MODEL_INVOCATION_CAPSULES) {
      throw new Error("Model invocation capsule count limit reached");
    }
    const totalBytes = await this.storageBytes(entries);
    if (totalBytes + nextBytes > MAX_MODEL_INVOCATION_CAPSULE_STORAGE_BYTES) {
      throw new Error("Model invocation capsule storage byte limit reached");
    }
  }

  private async assertStorageWithinLimits(): Promise<void> {
    const entries = await this.capsuleEntries();
    if (entries.length > MAX_MODEL_INVOCATION_CAPSULES) {
      throw new Error("Model invocation capsule count limit reached");
    }
    if (
      (await this.storageBytes(entries)) >
      MAX_MODEL_INVOCATION_CAPSULE_STORAGE_BYTES
    ) {
      throw new Error("Model invocation capsule storage byte limit reached");
    }
  }

  private async capsuleEntries(): Promise<string[]> {
    return (await readdir(this.rootPath)).filter((name) =>
      /^[a-f0-9]{64}\.json$/u.test(name),
    );
  }

  private async storageBytes(entries: readonly string[]): Promise<number> {
    let totalBytes = 0;
    for (const name of entries) {
      const info = await stat(path.join(this.rootPath, name));
      if (!info.isFile()) {
        throw new Error("Model invocation capsule storage is invalid");
      }
      totalBytes += info.size;
    }
    return totalBytes;
  }

  private pathFor(capsuleSha256: string): string {
    return path.join(this.rootPath, `${capsuleSha256}.json`);
  }
}

async function linkExclusive(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  try {
    await link(sourcePath, targetPath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return false;
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

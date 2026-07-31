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

const HASH = /^[a-f0-9]{64}$/u;
const DIRECTORY = /^[a-z][a-z0-9-]{0,63}$/u;

export interface LocalPrivateCapsuleStoreOptions<T> {
  dataRoot: string;
  directory: string;
  label: string;
  maxObjectBytes: number;
  maxObjects: number;
  maxStorageBytes: number;
  parse(serialized: string): T;
  contentSha256(value: T): string;
}

export interface LocalPrivateCapsulePutResult<T> {
  value: T;
  bytes: number;
}

export class LocalPrivateCapsuleStore<T> {
  readonly rootPath: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: LocalPrivateCapsuleStoreOptions<T>) {
    if (
      !DIRECTORY.test(options.directory) ||
      !options.label.trim() ||
      !positiveInteger(options.maxObjectBytes) ||
      !positiveInteger(options.maxObjects) ||
      !positiveInteger(options.maxStorageBytes) ||
      options.maxStorageBytes < options.maxObjectBytes
    ) {
      throw new Error("Local private capsule store options are invalid");
    }
    this.rootPath = path.join(
      path.resolve(options.dataRoot),
      options.directory,
    );
  }

  async put(
    contentSha256: string,
    serialized: string,
  ): Promise<LocalPrivateCapsulePutResult<T>> {
    const previous = this.writeTail;
    let release = (): void => undefined;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.putExclusive(contentSha256, serialized);
    } finally {
      release();
    }
  }

  private async putExclusive(
    contentSha256: string,
    serialized: string,
  ): Promise<LocalPrivateCapsulePutResult<T>> {
    if (!HASH.test(contentSha256)) {
      throw new Error(`${this.options.label} capsule SHA-256 is invalid`);
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes < 1 || bytes > this.options.maxObjectBytes) {
      throw new Error(`${this.options.label} capsule exceeds its byte limit`);
    }
    const value = this.parseAndBind(serialized, contentSha256);
    await this.ensureRoot();
    const targetPath = this.pathFor(contentSha256);
    if (await pathExists(targetPath)) {
      const existing = await this.read(contentSha256);
      return { value: existing, bytes };
    }
    await this.assertStorageCapacity(bytes);
    const temporaryPath = path.join(
      this.rootPath,
      `.${contentSha256}.${randomUUID()}.tmp`,
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
        const existing = await this.read(contentSha256);
        return { value: existing, bytes };
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
    return { value, bytes };
  }

  async read(contentSha256: string): Promise<T> {
    if (!HASH.test(contentSha256)) {
      throw new Error(`${this.options.label} capsule SHA-256 is invalid`);
    }
    const capsulePath = this.pathFor(contentSha256);
    const info = await lstat(capsulePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size < 1 ||
      info.size > this.options.maxObjectBytes
    ) {
      throw new Error(`${this.options.label} capsule file is invalid`);
    }
    return this.parseAndBind(
      await readFile(capsulePath, "utf8"),
      contentSha256,
    );
  }

  private parseAndBind(serialized: string, expectedSha256: string): T {
    const value = this.options.parse(serialized);
    if (this.options.contentSha256(value) !== expectedSha256) {
      throw new Error(`${this.options.label} capsule path binding is invalid`);
    }
    return value;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const info = await lstat(this.rootPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`${this.options.label} capsule directory is invalid`);
    }
    await chmod(this.rootPath, 0o700);
  }

  private async assertStorageCapacity(nextBytes: number): Promise<void> {
    const entries = await this.capsuleEntries();
    if (entries.length >= this.options.maxObjects) {
      throw new Error(`${this.options.label} capsule count limit reached`);
    }
    if (
      (await this.storageBytes(entries)) + nextBytes >
      this.options.maxStorageBytes
    ) {
      throw new Error(
        `${this.options.label} capsule storage byte limit reached`,
      );
    }
  }

  private async assertStorageWithinLimits(): Promise<void> {
    const entries = await this.capsuleEntries();
    if (entries.length > this.options.maxObjects) {
      throw new Error(`${this.options.label} capsule count limit reached`);
    }
    if ((await this.storageBytes(entries)) > this.options.maxStorageBytes) {
      throw new Error(
        `${this.options.label} capsule storage byte limit reached`,
      );
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
        throw new Error(`${this.options.label} capsule storage is invalid`);
      }
      totalBytes += info.size;
    }
    return totalBytes;
  }

  private pathFor(contentSha256: string): string {
    return path.join(this.rootPath, `${contentSha256}.json`);
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

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

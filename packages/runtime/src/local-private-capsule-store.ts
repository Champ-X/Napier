import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withWorkspacePathLock } from "./workspace-write-lock.js";

const HASH = /^[a-f0-9]{64}$/u;
const DIRECTORY = /^[a-z][a-z0-9-]{0,63}$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface LocalPrivateCapsuleStoreOptions<T> {
  dataRoot: string;
  directory: string;
  label: string;
  maxObjectBytes: number;
  maxObjects: number;
  maxStorageBytes: number;
  /** Require POSIX no-follow/directory/nonblocking flags and directory fsync before accepting checkpoints.
   * Default compatibility mode tolerates only unsupported directory operations; it does not promise directory durability.
   * File fsync, private-file validation and immutable installation remain mandatory in both modes. */
  requireDurableDirectory?: boolean;
  /** Must validate the capsule's content hash, not merely read its declared hash. */
  parse(serialized: string): T;
  contentSha256(value: T): string;
}

export interface LocalPrivateCapsulePutResult<T> { value: T; bytes: number }
interface CapsuleRoot { handle: FileHandle | undefined; identity: Stats }

/** A missing platform capability, never a disk, permission, integrity or file-fsync failure. */
export class LocalPrivateCapsuleDurabilityUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalPrivateCapsuleDurabilityUnavailableError";
  }
}

/** Immutable installs in a trusted local dataRoot. Strict checkpoint operations fail closed on unsupported durability. */
export class LocalPrivateCapsuleStore<T> {
  readonly rootPath: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: LocalPrivateCapsuleStoreOptions<T>) {
    if (!DIRECTORY.test(options.directory) || !options.label.trim() ||
        !positiveInteger(options.maxObjectBytes) || !positiveInteger(options.maxObjects) ||
        !positiveInteger(options.maxStorageBytes) || options.maxStorageBytes < options.maxObjectBytes) {
      throw new Error("Local private capsule store options are invalid");
    }
    this.rootPath = path.join(path.resolve(options.dataRoot), options.directory);
  }

  async put(contentSha256: string, serialized: string): Promise<LocalPrivateCapsulePutResult<T>> {
    const previous = this.writeTail;
    let release = (): void => undefined;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.putExclusive(contentSha256, serialized); }
    finally { release(); }
  }

  private async putExclusive(contentSha256: string, serialized: string): Promise<LocalPrivateCapsulePutResult<T>> {
    this.assertDurabilityCapabilities();
    this.assertHash(contentSha256);
    const data = Buffer.from(serialized, "utf8");
    if (data.length < 1 || data.length > this.options.maxObjectBytes)
      throw new Error(`${this.options.label} capsule exceeds its byte limit`);
    if (this.decode(data) !== serialized)
      throw new Error(`${this.options.label} capsule UTF-8 serialization is not exact`);
    this.parseAndBind(serialized, contentSha256);
    const root = await this.ensureRoot();
    try {
      const canonicalRoot = await realpath(this.rootPath);
      // A distinct target avoids re-entering the candidate store's outer root lock.
      return await this.withInstallLock(canonicalRoot, async () => {
        await this.assertRootCurrent(root);
        try {
          const existing = await this.readStored(contentSha256, root, true);
          await this.syncDirectory(root.handle);
          await this.assertRootCurrent(root);
          return existing;
        } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
        await this.assertStorageCapacity(data.length);
        return this.install(contentSha256, data, root);
      });
    } finally { await root.handle?.close(); }
  }

  private async install(contentSha256: string, data: Buffer, root: CapsuleRoot): Promise<LocalPrivateCapsulePutResult<T>> {
    const temporaryPath = path.join(this.rootPath, `.${contentSha256}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(data);
      await handle.sync();
      const identity = await handle.stat();
      await this.assertRootCurrent(root);
      const installed = await linkExclusive(temporaryPath, this.pathFor(contentSha256));
      await unlink(temporaryPath);
      // Our new inode was synced before linking; an EEXIST winner may need its own durability retry.
      const stored = await this.readStored(contentSha256, root, !installed, installed ? identity : undefined);
      // Never retract a visible final path: another reader may already own its receipt.
      // A failed sync leaves an unacknowledged immutable object that a later put can verify and sync.
      await this.syncDirectory(root.handle);
      await this.assertRootCurrent(root);
      return stored;
    } finally {
      await handle.close();
      await unlink(temporaryPath).catch((error: unknown) => { if (errorCode(error) !== "ENOENT") throw error; });
    }
  }

  async read(contentSha256: string): Promise<T> {
    return (await this.readWithBytes(contentSha256)).value;
  }

  async readWithBytes(contentSha256: string): Promise<LocalPrivateCapsulePutResult<T>> {
    this.assertDurabilityCapabilities();
    this.assertHash(contentSha256);
    const root = await this.openRoot();
    try { return await this.readStored(contentSha256, root, false); }
    finally { await root.handle?.close(); }
  }

  private async readStored(contentSha256: string, root: CapsuleRoot, durable: boolean,
    expectedIdentity?: Stats): Promise<LocalPrivateCapsulePutResult<T>> {
    await this.assertRootCurrent(root);
    const target = this.pathFor(contentSha256);
    const initial = await lstat(target);
    this.assertFile(initial);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      this.assertFile(before);
      if (!sameIdentity(initial, before)) throw new Error(`${this.options.label} capsule file changed before read`);
      if (expectedIdentity && !sameIdentity(before, expectedIdentity))
        throw new Error(`${this.options.label} capsule installation identity changed`);
      // Bounded FD reads cannot follow a replaced leaf path or allocate according to later growth.
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(target);
      this.assertFile(after);
      this.assertFile(current);
      if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs || !sameIdentity(current, before))
        throw new Error(`${this.options.label} capsule file changed during read`);
      const value = this.parseAndBind(this.decode(buffer.subarray(0, length)), contentSha256);
      if (durable) await handle.sync();
      await this.assertRootCurrent(root);
      return { value, bytes: length };
    } finally { await handle.close(); }
  }

  private parseAndBind(serialized: string, expectedSha256: string): T {
    const value = this.options.parse(serialized);
    if (this.options.contentSha256(value) !== expectedSha256)
      throw new Error(`${this.options.label} capsule path binding is invalid`);
    return value;
  }

  private decode(bytes: Uint8Array): string {
    try { return utf8.decode(bytes); }
    catch (cause) { throw new Error(`${this.options.label} capsule UTF-8 is invalid`, { cause }); }
  }

  private assertHash(hash: string): void {
    if (!HASH.test(hash)) throw new Error(`${this.options.label} capsule SHA-256 is invalid`);
  }

  private assertFile(info: Stats): void {
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
        info.size < 1 || info.size > this.options.maxObjectBytes)
      throw new Error(`${this.options.label} capsule file is invalid`);
  }

  private async openRoot(): Promise<CapsuleRoot> {
    const identity = await lstat(this.rootPath);
    if (!identity.isDirectory() || identity.isSymbolicLink())
      throw new Error(`${this.options.label} capsule directory is invalid`);
    const handle = await this.openDirectory(this.rootPath);
    const root = { handle, identity };
    try { await this.assertRootCurrent(root); return root; }
    catch (error) { await handle?.close(); throw error; }
  }

  private async assertRootCurrent(root: CapsuleRoot): Promise<void> {
    const [opened, current] = await Promise.all([root.handle?.stat() ?? root.identity, lstat(this.rootPath)]);
    if (!opened.isDirectory() || !current.isDirectory() || current.isSymbolicLink() ||
        (current.mode & 0o077) !== 0 || !sameIdentity(opened, current) || !sameIdentity(root.identity, current))
      throw new Error(`${this.options.label} capsule directory is invalid`);
  }

  private async ensureRoot(): Promise<CapsuleRoot> {
    const created = await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const identity = await lstat(this.rootPath);
    if (!identity.isDirectory() || identity.isSymbolicLink())
      throw new Error(`${this.options.label} capsule directory is invalid`);
    const handle = await this.openDirectory(this.rootPath);
    const root = { handle, identity };
    try {
      await handle?.chmod(0o700);
      await this.assertRootCurrent(root);
      await this.syncDirectory(handle);
      // Persist newly-created ancestors too; a synced child entry alone does not persist its parent directory entry.
      const canonicalRoot = await realpath(this.rootPath);
      const lastParent = created ? path.dirname(await realpath(created)) : path.dirname(canonicalRoot);
      for (let parent = path.dirname(canonicalRoot); ; parent = path.dirname(parent)) {
        const directory = await this.openDirectory(parent);
        try { await this.syncDirectory(directory); } finally { await directory?.close(); }
        if (parent === lastParent || parent === path.dirname(parent)) break;
      }
      return root;
    } catch (cause) {
      await handle?.close();
      if (cause instanceof LocalPrivateCapsuleDurabilityUnavailableError) throw cause;
      throw new Error(`${this.options.label} capsule directory durability is unavailable`, { cause });
    }
  }

  private assertDurabilityCapabilities(): void {
    if (this.options.requireDurableDirectory && ![constants.O_NOFOLLOW, constants.O_DIRECTORY, constants.O_NONBLOCK].every(
      (flag) => typeof flag === "number" && flag > 0,
    )) throw new LocalPrivateCapsuleDurabilityUnavailableError(
      `${this.options.label} capsule filesystem guarantees are unavailable on ${process.platform}`,
    );
  }

  private async openDirectory(directory: string): Promise<FileHandle | undefined> {
    try { return await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) {
      if (!unsupportedDirectoryOperation(error)) throw error;
      if (this.options.requireDurableDirectory) throw new LocalPrivateCapsuleDurabilityUnavailableError(
        `${this.options.label} capsule directory durability is unavailable`, { cause: error },
      );
      return undefined;
    }
  }

  private async syncDirectory(handle: FileHandle | undefined): Promise<void> {
    if (!handle) {
      if (this.options.requireDurableDirectory) throw new LocalPrivateCapsuleDurabilityUnavailableError(
        `${this.options.label} capsule directory durability is unavailable`,
      );
      return;
    }
    try { await handle.sync(); }
    catch (error) {
      if (!unsupportedDirectoryOperation(error)) throw error;
      if (this.options.requireDurableDirectory) throw new LocalPrivateCapsuleDurabilityUnavailableError(
        `${this.options.label} capsule directory durability is unavailable`, { cause: error },
      );
    }
  }

  private async withInstallLock<R>(canonicalRoot: string, operation: () => Promise<R>): Promise<R> {
    const label = `${this.options.label} capsule storage`;
    for (let attempt = 0; ; attempt += 1) {
      try { return await withWorkspacePathLock(path.dirname(canonicalRoot),
        path.join(canonicalRoot, ".capsule-install"), operation, label); }
      catch (error) {
        if (attempt >= 200 || !(error instanceof Error) || error.message !== `${label} target is already being edited`)
          throw error;
        await delay(25);
      }
    }
  }

  private async assertStorageCapacity(nextBytes: number): Promise<void> {
    const entries = (await readdir(this.rootPath)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    if (entries.length >= this.options.maxObjects)
      throw new Error(`${this.options.label} capsule count limit reached`);
    let totalBytes = 0;
    for (const name of entries) {
      const info = await lstat(path.join(this.rootPath, name));
      this.assertFile(info);
      totalBytes += info.size;
    }
    if (totalBytes + nextBytes > this.options.maxStorageBytes)
      throw new Error(`${this.options.label} capsule storage byte limit reached`);
  }

  private pathFor(contentSha256: string): string { return path.join(this.rootPath, `${contentSha256}.json`); }
}

async function linkExclusive(sourcePath: string, targetPath: string): Promise<boolean> {
  try { await link(sourcePath, targetPath); return true; }
  catch (error) { if (errorCode(error) === "EEXIST") return false; throw error; }
}
function sameIdentity(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}
function unsupportedDirectoryOperation(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EISDIR"].includes(code);
}

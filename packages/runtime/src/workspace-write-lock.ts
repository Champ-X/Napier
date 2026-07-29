import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function withWorkspacePathLock<T>(
  dataRoot: string,
  target: string,
  operation: () => Promise<T>,
  label = "apply_patch",
): Promise<T> {
  return withWorkspacePathLocks(dataRoot, [target], label, operation);
}

export async function withWorkspacePathLocks<T>(
  dataRoot: string,
  targets: readonly string[],
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockIdentities = [
    ...new Set(
      targets.map((target) => {
        const resolved = path.resolve(target);
        return process.platform === "darwin" || process.platform === "win32"
          ? resolved.toLowerCase()
          : resolved;
      }),
    ),
  ].sort();
  if (lockIdentities.length === 0) {
    throw new Error(`${label} requires at least one lock target`);
  }
  const locksRoot = path.join(path.resolve(dataRoot), "file-edit-locks");
  await mkdir(locksRoot, { recursive: true });
  const acquired: Array<{
    handle: Awaited<ReturnType<typeof open>>;
    path: string;
  }> = [];
  try {
    for (const identity of lockIdentities) {
      const lockPath = path.join(
        locksRoot,
        `${createHash("sha256").update(identity).digest("hex")}.lock`,
      );
      const handle = await acquireLock(lockPath, label);
      acquired.push({ handle, path: lockPath });
    }
    return await operation();
  } finally {
    for (const lock of acquired.reverse()) {
      await lock.handle.close().catch(() => undefined);
      await unlink(lock.path).catch(() => undefined);
    }
  }
}

async function acquireLock(
  lockPath: string,
  label: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (
        errorCode(error) === "EEXIST" &&
        attempt === 0 &&
        (await removeAbandonedLock(lockPath))
      ) {
        continue;
      }
      if (errorCode(error) === "EEXIST") {
        throw new Error(`${label} target is already being edited`);
      }
      throw error;
    }
  }
  if (!lock) throw new Error(`${label} could not acquire its edit lock`);
  try {
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    await lock.sync();
    return lock;
  } catch (error) {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
}

async function removeAbandonedLock(lockPath: string): Promise<boolean> {
  let record: { pid?: unknown };
  try {
    record = JSON.parse(await readFile(lockPath, "utf8")) as {
      pid?: unknown;
    };
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
  if (
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    isProcessAlive(record.pid)
  ) {
    return false;
  }
  try {
    await unlink(lockPath);
    return true;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

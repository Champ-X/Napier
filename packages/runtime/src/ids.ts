import { randomUUID } from "node:crypto";

const PREFIX_PATTERN = /^[a-z][a-z0-9_]{1,15}$/;
const PROCESS_LEASE_OWNER_PATTERN = /^process:(\d+):/u;

export function createId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid ID prefix: ${prefix}`);
  }
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function createProcessLeaseOwnerId(prefix: string): string {
  return `process:${String(process.pid)}:${createId(prefix)}`;
}

export function preserveRunLeaseOnStartup(
  lease: { ownerId: string; expiresAt: string } | undefined,
  hasToken: boolean,
  timestampMs: number,
  interruptActiveLeases: boolean,
): boolean {
  return Boolean(
    lease &&
    hasToken &&
    Number.isFinite(Date.parse(lease.expiresAt)) &&
    Date.parse(lease.expiresAt) > timestampMs &&
    (!interruptActiveLeases || isLeaseOwnerProcessAlive(lease.ownerId)),
  );
}

function isLeaseOwnerProcessAlive(ownerId: string): boolean {
  const match = PROCESS_LEASE_OWNER_PATTERN.exec(ownerId);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

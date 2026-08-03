import { createHash } from "node:crypto";

const INDEX_HEADER_BYTES = 12;
const INDEX_ENTRY_BASE_BYTES = 62;
const INDEX_CHECKSUM_BYTES = 20;
const INDEX_SIGNATURE = "DIRC";
const INDEX_NAME_MASK = 0x0fff;
const INDEX_STAGE_MASK = 0x3000;
const INDEX_EXTENDED_FLAG = 0x4000;
const MAX_INDEX_ENTRY_COUNT = 1_000_000;

export interface GitConflictIndexEntry {
  stage: 1 | 2 | 3;
  mode: "100644" | "100755";
  objectSha1: string;
}

export function parseGitConflictIndex(
  index: Buffer,
  targetPath: string,
): GitConflictIndexEntry[] {
  return parseGitConflictIndexSet(index, [targetPath]).get(targetPath) ?? [];
}

export function parseGitConflictIndexSet(
  index: Buffer,
  targetPaths: readonly string[],
): ReadonlyMap<string, GitConflictIndexEntry[]> {
  const payloadEnd = index.length - INDEX_CHECKSUM_BYTES;
  const { version, count } = readIndexHeader(index, payloadEnd);
  if (
    (version !== 2 && version !== 3) ||
    count > MAX_INDEX_ENTRY_COUNT ||
    count * INDEX_ENTRY_BASE_BYTES > payloadEnd - INDEX_HEADER_BYTES
  ) {
    throw new Error("Git conflict index version is unsupported");
  }
  const targets = targetPathBuckets(targetPaths);
  const matches = new Map(
    targetPaths.map((targetPath) => [
      targetPath,
      [] as GitConflictIndexEntry[],
    ]),
  );
  let offset = INDEX_HEADER_BYTES;
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entryStart = offset;
    if (entryStart + INDEX_ENTRY_BASE_BYTES > payloadEnd) {
      throw new Error("Git conflict index entry is truncated");
    }
    const rawMode = index.readUInt32BE(entryStart + 24);
    const objectSha1 = index
      .subarray(entryStart + 40, entryStart + 60)
      .toString("hex");
    const flags = index.readUInt16BE(entryStart + 60);
    const extended = (flags & INDEX_EXTENDED_FLAG) !== 0;
    if (extended && version < 3) {
      throw new Error("Git conflict index entry flags are unsupported");
    }
    const nameStart = entryStart + INDEX_ENTRY_BASE_BYTES + (extended ? 2 : 0);
    if (nameStart >= payloadEnd) {
      throw new Error("Git conflict index entry name is truncated");
    }
    const encodedLength = flags & INDEX_NAME_MASK;
    const nameEnd =
      encodedLength < INDEX_NAME_MASK
        ? nameStart + encodedLength
        : index.indexOf(0, nameStart);
    if (nameEnd < nameStart || nameEnd >= payloadEnd || index[nameEnd] !== 0) {
      throw new Error("Git conflict index entry name is invalid");
    }
    const entryBytes = nameEnd + 1 - entryStart;
    offset = entryStart + Math.ceil(entryBytes / 8) * 8;
    if (
      offset > payloadEnd ||
      index.subarray(nameEnd + 1, offset).some((value) => value !== 0)
    ) {
      throw new Error("Git conflict index entry padding is invalid");
    }
    const name = index.subarray(nameStart, nameEnd);
    const targetPath = matchingTargetPath(name, targets);
    if (!targetPath) continue;
    const stage = (flags & INDEX_STAGE_MASK) >> 12;
    if (stage === 0) continue;
    if (
      (stage !== 1 && stage !== 2 && stage !== 3) ||
      (rawMode !== 0o100644 && rawMode !== 0o100755)
    ) {
      throw new Error("Git conflict index target is unsupported");
    }
    matches.get(targetPath)!.push({
      stage,
      mode: rawMode === 0o100755 ? "100755" : "100644",
      objectSha1,
    });
  }
  return matches;
}

function matchingTargetPath(
  name: Buffer,
  targets: Map<number, Array<{ path: string; bytes: Buffer }>>,
): string | undefined {
  return targets.get(name[0] ?? -1)?.find((target) => target.bytes.equals(name))
    ?.path;
}

function targetPathBuckets(
  targetPaths: readonly string[],
): Map<number, Array<{ path: string; bytes: Buffer }>> {
  const buckets = new Map<number, Array<{ path: string; bytes: Buffer }>>();
  for (const targetPath of targetPaths) {
    const bytes = Buffer.from(targetPath, "utf8");
    const key = bytes[0] ?? -1;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ path: targetPath, bytes });
    buckets.set(key, bucket);
  }
  return buckets;
}

function readIndexHeader(
  index: Buffer,
  payloadEnd: number,
): { version: number; count: number } {
  if (
    payloadEnd < INDEX_HEADER_BYTES ||
    index.subarray(0, 4).toString("ascii") !== INDEX_SIGNATURE ||
    !validChecksum(index, payloadEnd)
  ) {
    throw new Error("Git conflict index is invalid");
  }
  return {
    version: index.readUInt32BE(4),
    count: index.readUInt32BE(8),
  };
}

function validChecksum(index: Buffer, payloadEnd: number): boolean {
  return createHash("sha1")
    .update(index.subarray(0, payloadEnd))
    .digest()
    .equals(index.subarray(payloadEnd));
}

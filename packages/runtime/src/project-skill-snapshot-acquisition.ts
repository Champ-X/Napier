import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, type FileHandle } from "node:fs/promises";
import path from "node:path";

import {
  formatSkillInvocation,
  type Skill,
} from "@earendil-works/pi-agent-core";

import {
  assertProjectSkillAnchorCurrent,
  assertProjectSkillDirectoryCurrent,
  checkProjectSkillSignal,
  handleProjectSkillRelativePath,
  sameProjectSkillIdentity,
  sameProjectSkillStableState,
} from "./project-skill-snapshot-anchor.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { parseProjectSkillInMemory } from "./project-skill-snapshot-memory.js";
import {
  ProjectSkillSnapshotError,
  compareProjectSkillText,
  validProjectSkillName,
  type ProjectSkillAcquiredEntry,
  type ProjectSkillAcquisitionFailure,
  type ProjectSkillDirectoryState,
  type ProjectSkillFailureDraft,
  type ProjectSkillRootAnchor,
  type ProjectSkillSnapshotEntry,
  type ProjectSkillSnapshotHooks,
} from "./project-skill-snapshot-model.js";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DIRECTORY_SCAN_ENTRIES = 4096;
const OVERFLOW_IDENTITY = sha256("project_skill_direct_directory_overflow:65");
const VIRTUAL_ROOT = "/project/skills";

export async function inspectProjectSkillDirectories(
  anchor: ProjectSkillRootAnchor,
  requested: Set<string>,
  signal: AbortSignal | undefined,
  hooks: ProjectSkillSnapshotHooks,
): Promise<ProjectSkillDirectoryState> {
  checkProjectSkillSignal(signal);
  const entries = new Map<string, "directory" | "symlink" | "other">();
  const identityHashes: string[] = [];
  const directory = await opendir(anchor.relativePath).catch(() => undefined);
  if (!directory) throw new ProjectSkillSnapshotError("workspace_untrusted");
  let count = 0;
  let scanned = 0;
  try {
    for (;;) {
      checkProjectSkillSignal(signal);
      const item = await directory.read();
      checkProjectSkillSignal(signal);
      if (!item) break;
      scanned += 1;
      if (scanned > MAX_DIRECTORY_SCAN_ENTRIES) {
        throw new ProjectSkillSnapshotError("workspace_untrusted");
      }
      await hooks.afterDirectoryEntry?.(scanned);
      checkProjectSkillSignal(signal);
      const kind = item.isDirectory()
        ? "directory"
        : item.isSymbolicLink()
          ? "symlink"
          : "other";
      if (requested.has(item.name)) entries.set(item.name, kind);
      if (kind !== "directory") continue;
      count += 1;
      if (count === 65) {
        identityHashes.splice(0, identityHashes.length, OVERFLOW_IDENTITY);
        break;
      }
      identityHashes.push(sha256(item.name));
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  identityHashes.sort(compareProjectSkillText);
  await assertProjectSkillAnchorCurrent(anchor, signal);
  return { count, identityHashes, entries };
}

export async function acquireProjectSkillEntries(
  anchor: ProjectSkillRootAnchor,
  configuredNames: readonly string[],
  directories: ProjectSkillDirectoryState,
  signal: AbortSignal | undefined,
  hooks: ProjectSkillSnapshotHooks,
): Promise<{
  failures: ProjectSkillFailureDraft[];
  entries: ProjectSkillSnapshotEntry[];
  skills: Skill[];
  aggregateRawBytes: number;
}> {
  const counts = new Map<string, number>();
  for (const raw of configuredNames) {
    if (validProjectSkillName(raw)) {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  const failures: ProjectSkillFailureDraft[] = [];
  const entries: ProjectSkillSnapshotEntry[] = [];
  const skills: Skill[] = [];
  let aggregateRawBytes = 0;
  for (const [position, raw] of configuredNames.entries()) {
    checkProjectSkillSignal(signal);
    const preflight = acquisitionPreflight(raw, position, counts, directories);
    if (preflight) {
      failures.push(preflight);
      continue;
    }
    const acquired = await acquireEntry(anchor, raw, signal, hooks);
    if ("code" in acquired) {
      failures.push({ position, raw, ...acquired });
      continue;
    }
    if (aggregateRawBytes + acquired.entry.sizeBytes > MAX_TOTAL_BYTES) {
      failures.push({
        position,
        raw,
        code: "skill_limit_exceeded",
        diagnostic: "aggregate_bytes",
      });
      continue;
    }
    aggregateRawBytes += acquired.entry.sizeBytes;
    entries.push(acquired.entry);
    skills.push(acquired.skill);
  }
  return { failures, entries, skills, aggregateRawBytes };
}

function acquisitionPreflight(
  raw: string,
  position: number,
  counts: Map<string, number>,
  directories: ProjectSkillDirectoryState,
): ProjectSkillFailureDraft | undefined {
  if (!validProjectSkillName(raw)) {
    return {
      position,
      raw,
      code: "skill_invalid",
      diagnostic: "invalid_name",
    };
  }
  if ((counts.get(raw) ?? 0) > 1) {
    return {
      position,
      raw,
      code: "skill_ambiguous",
      diagnostic: "duplicate_request",
    };
  }
  const kind = directories.entries.get(raw);
  if (!kind) {
    return {
      position,
      raw,
      code: "skill_not_found",
      diagnostic: "direct_directory_missing",
    };
  }
  if (kind === "symlink") {
    return {
      position,
      raw,
      code: "skill_untrusted",
      diagnostic: "directory_symlink",
    };
  }
  if (kind !== "directory") {
    return {
      position,
      raw,
      code: "skill_invalid",
      diagnostic: "directory_kind",
    };
  }
}

async function acquireEntry(
  anchor: ProjectSkillRootAnchor,
  skillName: string,
  signal: AbortSignal | undefined,
  hooks: ProjectSkillSnapshotHooks,
): Promise<ProjectSkillAcquiredEntry | ProjectSkillAcquisitionFailure> {
  checkProjectSkillSignal(signal);
  await assertProjectSkillAnchorCurrent(anchor, signal);
  const directory = path.join(anchor.path, skillName);
  const relativeDirectory = path.join(anchor.relativePath, skillName);
  const target = path.join(directory, "SKILL.md");
  const dirBefore = await lstat(directory).catch(() => undefined);
  checkProjectSkillSignal(signal);
  if (!dirBefore?.isDirectory() || dirBefore.isSymbolicLink()) {
    return { code: "skill_untrusted", diagnostic: "directory_changed" };
  }
  const dirHandle = await open(
    relativeDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!dirHandle) {
    return { code: "skill_untrusted", diagnostic: "directory_nofollow" };
  }
  try {
    const dirOpened = await dirHandle.stat();
    checkProjectSkillSignal(signal);
    if (
      !dirOpened.isDirectory() ||
      !sameProjectSkillIdentity(dirBefore, dirOpened)
    ) {
      return { code: "skill_catalog_drift", diagnostic: "directory_identity" };
    }
    await assertProjectSkillAnchorCurrent(anchor, signal);
    const dirTraversal = await handleProjectSkillRelativePath(
      dirHandle,
      dirOpened,
      directory,
      signal,
    );
    if (dirTraversal.strategy !== anchor.traversalStrategy) {
      throw new ProjectSkillSnapshotError("workspace_untrusted");
    }
    await hooks.afterSkillDirectoryOpen?.(skillName);
    checkProjectSkillSignal(signal);
    return await acquireFileEntry({
      dirHandle,
      dirOpened,
      relativeDir: dirTraversal.path,
      directory,
      target,
      skillName,
      signal,
      hooks,
    });
  } finally {
    await dirHandle.close();
  }
}

async function acquireFileEntry(input: {
  dirHandle: FileHandle;
  dirOpened: Stats;
  relativeDir: string;
  directory: string;
  target: string;
  skillName: string;
  signal: AbortSignal | undefined;
  hooks: ProjectSkillSnapshotHooks;
}): Promise<ProjectSkillAcquiredEntry | ProjectSkillAcquisitionFailure> {
  await assertProjectSkillDirectoryCurrent(
    input.dirHandle,
    input.dirOpened,
    input.directory,
    input.signal,
  );
  const relativeTarget = path.join(input.relativeDir, "SKILL.md");
  const fileBefore = await lstat(relativeTarget).catch(() => undefined);
  checkProjectSkillSignal(input.signal);
  const preflight = filePreflight(fileBefore);
  if (preflight) return preflight;
  const fileHandle = await open(
    relativeTarget,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!fileHandle) {
    return { code: "skill_untrusted", diagnostic: "file_nofollow" };
  }
  try {
    const opened = await fileHandle.stat();
    checkProjectSkillSignal(input.signal);
    await assertProjectSkillDirectoryCurrent(
      input.dirHandle,
      input.dirOpened,
      input.directory,
      input.signal,
    );
    if (!opened.isFile() || !sameProjectSkillIdentity(fileBefore!, opened)) {
      return { code: "skill_catalog_drift", diagnostic: "file_identity" };
    }
    if (opened.size < 1) {
      return { code: "skill_invalid", diagnostic: "opened_file_bytes" };
    }
    if (opened.size > MAX_FILE_BYTES) {
      return {
        code: "skill_limit_exceeded",
        diagnostic: "opened_file_bytes",
      };
    }
    await input.hooks.afterSkillFileOpen?.(input.skillName);
    checkProjectSkillSignal(input.signal);
    const bytes = await boundedRead(fileHandle, input.signal);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return { code: "skill_limit_exceeded", diagnostic: "file_overread" };
    }
    await input.hooks.afterSkillFileRead?.(input.skillName);
    checkProjectSkillSignal(input.signal);
    return finalizeAcquiredEntry({ ...input, fileHandle, opened, bytes });
  } finally {
    await fileHandle.close();
  }
}

function filePreflight(
  file: Stats | undefined,
): ProjectSkillAcquisitionFailure | undefined {
  if (!file) return { code: "skill_not_found", diagnostic: "skill_md_missing" };
  if (file.isSymbolicLink()) {
    return { code: "skill_untrusted", diagnostic: "file_symlink" };
  }
  if (!file.isFile()) return { code: "skill_invalid", diagnostic: "file_kind" };
  if (file.size < 1) return { code: "skill_invalid", diagnostic: "file_bytes" };
  if (file.size > MAX_FILE_BYTES) {
    return { code: "skill_limit_exceeded", diagnostic: "file_bytes" };
  }
}

async function finalizeAcquiredEntry(
  input: {
    dirHandle: FileHandle;
    dirOpened: Stats;
    directory: string;
    target: string;
    skillName: string;
    signal: AbortSignal | undefined;
  } & {
    fileHandle: FileHandle;
    opened: Stats;
    bytes: Buffer;
  },
): Promise<ProjectSkillAcquiredEntry | ProjectSkillAcquisitionFailure> {
  const [heldAfter, dirHeldAfter, fileAfter, dirAfter] = await Promise.all([
    input.fileHandle.stat(),
    input.dirHandle.stat(),
    lstat(input.target).catch(() => undefined),
    lstat(input.directory).catch(() => undefined),
  ]);
  checkProjectSkillSignal(input.signal);
  if (
    !fileAfter?.isFile() ||
    fileAfter.isSymbolicLink() ||
    !dirAfter?.isDirectory() ||
    dirAfter.isSymbolicLink() ||
    !sameProjectSkillStableState(input.opened, heldAfter) ||
    !sameProjectSkillStableState(input.opened, fileAfter) ||
    !sameProjectSkillStableState(input.dirOpened, dirHeldAfter) ||
    !sameProjectSkillStableState(input.dirOpened, dirAfter)
  ) {
    return { code: "skill_catalog_drift", diagnostic: "path_drift" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return { code: "skill_invalid", diagnostic: "utf8" };
  }
  if (text.includes("\0") || !Buffer.from(text, "utf8").equals(input.bytes)) {
    return { code: "skill_invalid", diagnostic: "text_encoding" };
  }
  checkProjectSkillSignal(input.signal);
  const parsed = await parseProjectSkillInMemory(
    input.skillName,
    text,
    input.signal,
  );
  if (!parsed) return { code: "skill_invalid", diagnostic: "frontmatter" };
  if (parsed.disableModelInvocation) {
    return { code: "skill_disabled", diagnostic: "model_invocation_disabled" };
  }
  const formattedInvocation = formatSkillInvocation(parsed);
  const metadata = {
    name: parsed.name,
    description: parsed.description,
    disableModelInvocation: false as const,
  };
  const entry: ProjectSkillSnapshotEntry = {
    canonicalName: input.skillName,
    requestedNameSha256: sha256(input.skillName),
    relativePath: `skills/${input.skillName}/SKILL.md`,
    virtualPath: `${VIRTUAL_ROOT}/${input.skillName}/SKILL.md`,
    directoryKind: "directory",
    fileKind: "regular_file",
    symlinkFree: true,
    sizeBytes: input.bytes.byteLength,
    lineCount: 1 + (text.match(/\n/gu)?.length ?? 0),
    rawContentSha256: sha256(input.bytes),
    metadataSha256: sha256(canonicalJson(metadata)),
    invocationSha256: sha256(formattedInvocation),
    rawContentBase64: input.bytes.toString("base64"),
    metadata,
    formattedInvocation,
  };
  return { entry, skill: parsed };
}

async function boundedRead(
  handle: FileHandle,
  signal?: AbortSignal,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    checkProjectSkillSignal(signal);
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    );
    checkProjectSkillSignal(signal);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

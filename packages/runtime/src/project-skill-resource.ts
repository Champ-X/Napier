import { constants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { isSkillResourcePath } from "@napier/contracts/skill-resource";

import { sha256 } from "./ed25519.js";

const MAX_RESOURCE_BYTES = 64 * 1024;
const MAX_SKILL_BYTES = 128 * 1024;

export type ProjectSkillResourceErrorCode =
  | "resource_invalid"
  | "resource_not_found"
  | "resource_untrusted"
  | "resource_limit_exceeded"
  | "resource_catalog_drift";

export class ProjectSkillResourceError extends Error {
  constructor(
    readonly code: ProjectSkillResourceErrorCode,
    readonly diagnostic: string,
  ) {
    super(`Skill resource load failed: ${code}`);
    this.name = "ProjectSkillResourceError";
  }
}

export interface ProjectSkillResourceContent {
  skillName: string;
  resourcePath: string;
  relativePath: string;
  virtualPath: string;
  fileKind: "regular_file";
  symlinkFree: true;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: string;
  text: string;
}

export interface ProjectSkillResourceHooks {
  afterDirectoryOpen?(relativeDirectory: string): void | Promise<void>;
  afterResourceOpen?(): void | Promise<void>;
  afterResourceRead?(): void | Promise<void>;
}

type HeldDirectory = {
  target: string;
  relative: string;
  handle: FileHandle;
  identity: Stats;
};

type ResourceSkillBinding = {
  canonicalName: string;
  sizeBytes: number;
  rawContentSha256: string;
};

export async function loadProjectSkillResource(
  canonicalWorkspace: string,
  skill: Readonly<ResourceSkillBinding>,
  resourcePath: string,
  signal?: AbortSignal,
  hooks: ProjectSkillResourceHooks = {},
): Promise<ProjectSkillResourceContent> {
  check(signal);
  if (!isSkillResourcePath(resourcePath) || resourcePath === "SKILL.md") {
    throw new ProjectSkillResourceError("resource_invalid", "path_syntax");
  }
  const segments = resourcePath.split("/");
  const directories = [
    { target: canonicalWorkspace, relative: ".", catalog: true },
    {
      target: path.join(canonicalWorkspace, "skills"),
      relative: "skills",
      catalog: true,
    },
    {
      target: path.join(canonicalWorkspace, "skills", skill.canonicalName),
      relative: `skills/${skill.canonicalName}`,
      catalog: true,
    },
    ...segments.slice(0, -1).map((_, index) => ({
      target: path.join(
        canonicalWorkspace,
        "skills",
        skill.canonicalName,
        ...segments.slice(0, index + 1),
      ),
      relative: `skills/${skill.canonicalName}/${segments
        .slice(0, index + 1)
        .join("/")}`,
      catalog: false,
    })),
  ];
  const held: HeldDirectory[] = [];
  try {
    for (const directory of directories) {
      held.push(
        await holdDirectory(
          directory.target,
          directory.relative,
          directory.catalog,
          signal,
        ),
      );
      await hooks.afterDirectoryOpen?.(directory.relative);
      check(signal);
      await assertDirectoriesCurrent(held, signal);
    }
    const skillFile = path.join(
      canonicalWorkspace,
      "skills",
      skill.canonicalName,
      "SKILL.md",
    );
    const currentSkill = await readCatalogSkillFile(skillFile, held, signal);
    if (
      currentSkill.byteLength !== skill.sizeBytes ||
      sha256(currentSkill) !== skill.rawContentSha256
    ) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "skill_content_changed",
      );
    }
    const target = path.join(
      canonicalWorkspace,
      "skills",
      skill.canonicalName,
      ...segments,
    );
    const bytes = await readStableFile(
      target,
      MAX_RESOURCE_BYTES,
      held,
      signal,
      hooks,
    );
    const text = decodeText(bytes);
    return {
      skillName: skill.canonicalName,
      resourcePath,
      relativePath: `skills/${skill.canonicalName}/${resourcePath}`,
      virtualPath: `/project/skills/${skill.canonicalName}/${resourcePath}`,
      fileKind: "regular_file",
      symlinkFree: true,
      sizeBytes: bytes.byteLength,
      lineCount: 1 + (text.match(/\n/gu)?.length ?? 0),
      rawContentSha256: sha256(bytes),
      text,
    };
  } finally {
    await Promise.allSettled(held.map((directory) => directory.handle.close()));
  }
}

async function readCatalogSkillFile(
  target: string,
  directories: readonly HeldDirectory[],
  signal?: AbortSignal,
): Promise<Buffer> {
  try {
    return await readStableFile(target, MAX_SKILL_BYTES, directories, signal);
  } catch (error) {
    if (
      error instanceof ProjectSkillResourceError &&
      error.code === "resource_not_found"
    ) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "skill_file_missing",
      );
    }
    throw error;
  }
}

async function holdDirectory(
  target: string,
  relative: string,
  catalog: boolean,
  signal?: AbortSignal,
): Promise<HeldDirectory> {
  check(signal);
  const before = await lstat(target).catch(() => undefined);
  check(signal);
  if (!before) {
    throw new ProjectSkillResourceError(
      catalog ? "resource_catalog_drift" : "resource_not_found",
      catalog ? "catalog_directory_missing" : "resource_directory_missing",
    );
  }
  if (before.isSymbolicLink()) {
    throw new ProjectSkillResourceError(
      "resource_untrusted",
      "directory_symlink",
    );
  }
  if (!before.isDirectory()) {
    throw new ProjectSkillResourceError("resource_untrusted", "directory_kind");
  }
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!handle) {
    throw new ProjectSkillResourceError(
      "resource_untrusted",
      "directory_nofollow",
    );
  }
  try {
    const opened = await handle.stat();
    check(signal);
    if (!opened.isDirectory() || !sameStableState(before, opened)) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "directory_identity",
      );
    }
    return { target, relative, handle, identity: opened };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readStableFile(
  target: string,
  maximumBytes: number,
  directories: readonly HeldDirectory[],
  signal?: AbortSignal,
  hooks?: ProjectSkillResourceHooks,
): Promise<Buffer> {
  check(signal);
  await assertDirectoriesCurrent(directories, signal);
  const before = await lstat(target).catch(() => undefined);
  check(signal);
  if (!before) {
    throw new ProjectSkillResourceError(
      "resource_not_found",
      "resource_file_missing",
    );
  }
  if (before.isSymbolicLink()) {
    throw new ProjectSkillResourceError("resource_untrusted", "file_symlink");
  }
  if (!before.isFile()) {
    throw new ProjectSkillResourceError("resource_invalid", "file_kind");
  }
  if (before.size < 1) {
    throw new ProjectSkillResourceError("resource_invalid", "file_empty");
  }
  if (before.size > maximumBytes) {
    throw new ProjectSkillResourceError(
      "resource_limit_exceeded",
      "file_bytes",
    );
  }
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!handle) {
    throw new ProjectSkillResourceError("resource_untrusted", "file_nofollow");
  }
  try {
    const opened = await handle.stat();
    check(signal);
    if (!opened.isFile() || !sameStableState(before, opened)) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "file_identity",
      );
    }
    await hooks?.afterResourceOpen?.();
    check(signal);
    const bytes = await boundedRead(handle, maximumBytes, signal);
    await hooks?.afterResourceRead?.();
    check(signal);
    const [heldAfter, after] = await Promise.all([
      handle.stat(),
      lstat(target).catch(() => undefined),
    ]);
    await assertDirectoriesCurrent(directories, signal);
    if (
      !after?.isFile() ||
      after.isSymbolicLink() ||
      !sameStableState(opened, heldAfter) ||
      !sameStableState(opened, after)
    ) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "file_changed",
      );
    }
    return bytes;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function boundedRead(
  handle: FileHandle,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    check(signal);
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset,
    );
    check(signal);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maximumBytes) {
    throw new ProjectSkillResourceError(
      "resource_limit_exceeded",
      "file_overread",
    );
  }
  return buffer.subarray(0, offset);
}

async function assertDirectoriesCurrent(
  directories: readonly HeldDirectory[],
  signal?: AbortSignal,
): Promise<void> {
  for (const directory of directories) {
    check(signal);
    const [held, current] = await Promise.all([
      directory.handle.stat(),
      lstat(directory.target).catch(() => undefined),
    ]);
    check(signal);
    if (
      !current?.isDirectory() ||
      current.isSymbolicLink() ||
      !sameStableState(directory.identity, held) ||
      !sameStableState(held, current)
    ) {
      throw new ProjectSkillResourceError(
        "resource_catalog_drift",
        "directory_changed",
      );
    }
  }
}

function decodeText(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectSkillResourceError("resource_invalid", "utf8");
  }
  if (text.includes("\0") || !Buffer.from(text, "utf8").equals(bytes)) {
    throw new ProjectSkillResourceError("resource_invalid", "text_encoding");
  }
  return text;
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return (
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino)
  );
}

function sameStableState(left: Stats, right: Stats): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation aborted", "AbortError");
  }
}

import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import { isPathInsideWorkspace } from "./policy.js";

const MAX_LIST_ENTRIES = 300;
const MAX_READ_BYTES = 96 * 1024;
const MAX_READ_LINE_ANCHORS = 80;
const MAX_HASHABLE_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_MATCHES = 80;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PATCH_EDITS = 32;
const SHA256_PATTERN = "^[a-f0-9]{64}$";
const SHA256_PATTERN_RE = /^[a-f0-9]{64}$/;
const PROTECTED_PATH_SEGMENTS = new Set([".git", ".napier", "node_modules"]);

const listFilesSchema = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "Workspace-relative directory. Defaults to '.'.",
    }),
  ),
  depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
});

const readFileSchema = Type.Object({
  path: Type.String({ description: "Workspace-relative file path." }),
  startLine: Type.Optional(Type.Integer({ minimum: 1 })),
  endLine: Type.Optional(Type.Integer({ minimum: 1 })),
});

const searchFilesSchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  path: Type.Optional(
    Type.String({
      description: "Workspace-relative directory. Defaults to '.'.",
    }),
  ),
});

const applyPatchSchema = Type.Union([
  Type.Object(
    {
      operation: Type.Literal("create"),
      path: Type.String({
        minLength: 1,
        description: "Workspace-relative path for a new UTF-8 text file.",
      }),
      expectedSha256: Type.Null({
        description: "Must be null to assert that the file does not exist.",
      }),
      content: Type.String({
        maxLength: MAX_PATCH_BYTES,
        description: "Complete UTF-8 content for the new file.",
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("replace"),
      path: Type.String({
        minLength: 1,
        description: "Workspace-relative path for an existing UTF-8 file.",
      }),
      expectedSha256: Type.String({
        pattern: SHA256_PATTERN,
        description:
          "SHA-256 of the complete current file, obtained from read_file.",
      }),
      edits: Type.Array(
        Type.Object(
          {
            oldText: Type.String({
              minLength: 1,
              maxLength: MAX_PATCH_BYTES,
              description:
                "Exact text that must occur once in the current edit buffer.",
            }),
            newText: Type.String({
              maxLength: MAX_PATCH_BYTES,
              description: "Replacement text. Empty text removes the match.",
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("hashline_replace"),
      path: Type.String({
        minLength: 1,
        description: "Workspace-relative path for an existing UTF-8 file.",
      }),
      expectedSha256: Type.String({
        pattern: SHA256_PATTERN,
        description:
          "SHA-256 of the complete current file, obtained from read_file.",
      }),
      edits: Type.Array(
        Type.Object(
          {
            line: Type.Optional(
              Type.Integer({
                minimum: 1,
                description:
                  "Optional 1-based line number from read_file. When omitted, the anchor hash must identify exactly one line.",
              }),
            ),
            anchorSha256: Type.String({
              pattern: SHA256_PATTERN,
              description:
                "SHA-256 of the exact line content from read_file lineAnchors.",
            }),
            newText: Type.String({
              maxLength: MAX_PATCH_BYTES,
              description:
                "Replacement line content. May include newlines to expand the matched line into a block.",
            }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: MAX_PATCH_EDITS },
      ),
    },
    { additionalProperties: false },
  ),
]);

export type WorkspacePatchInput =
  | {
      operation: "create";
      path: string;
      expectedSha256: null;
      content: string;
    }
  | {
      operation: "replace";
      path: string;
      expectedSha256: string;
      edits: Array<{ oldText: string; newText: string }>;
    }
  | {
      operation: "hashline_replace";
      path: string;
      expectedSha256: string;
      edits: Array<{
        line?: number;
        anchorSha256: string;
        newText: string;
      }>;
    };

export interface WorkspacePatchResult {
  path: string;
  pathSha256: string;
  operation: WorkspacePatchInput["operation"];
  beforeSha256: string | null;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
  editCount: number;
}

export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  fileSha256: string;
  lineSha256: string;
  sizeBytes: number;
}

export interface WorkspaceSearchDetails {
  count: number;
  truncated: boolean;
  matchSetSha256: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceListDetails {
  count: number;
  truncated: boolean;
  pathSha256: string;
  entrySetSha256: string;
}

export interface WorkspaceReadDetails {
  startLine: number;
  endLine: number;
  totalLines: number;
  path: string;
  pathSha256: string;
  sha256: string;
  sizeBytes: number;
  truncated: boolean;
  lineAnchors: Array<{ line: number; sha256: string }>;
  lineAnchorsTruncated: boolean;
  lineAnchorSetSha256: string;
}

export interface CreateWorkspaceToolsOptions {
  includeWriteTools?: boolean;
  dataRoot?: string;
}

async function resolveWorkspacePath(
  workspaceRoot: string,
  candidate: string,
): Promise<{ root: string; target: string }> {
  if (!isPathInsideWorkspace(candidate, workspaceRoot)) {
    throw new Error("Path escapes the configured workspace");
  }
  const root = await realpath(path.resolve(workspaceRoot));
  const resolved = await realpath(path.resolve(workspaceRoot, candidate));
  if (!isPathInsideWorkspace(resolved, root)) {
    throw new Error("Path resolves outside the configured workspace");
  }
  return { root, target: resolved };
}

function normalizeWritablePath(candidate: string): string {
  if (
    !candidate ||
    path.isAbsolute(candidate) ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    throw new Error(
      "apply_patch path must be a visible workspace-relative path",
    );
  }
  const normalized = path.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("apply_patch path escapes the configured workspace");
  }
  const protectedSegment = normalized
    .split(path.sep)
    .find((segment) => PROTECTED_PATH_SEGMENTS.has(segment));
  if (protectedSegment) {
    throw new Error(
      `apply_patch cannot modify protected path segment: ${protectedSegment}`,
    );
  }
  return normalized;
}

async function inspectWritableTarget(
  workspaceRoot: string,
  relativePath: string,
): Promise<{
  target: string;
  parent: string;
  exists: boolean;
  mode: number;
}> {
  const root = path.resolve(workspaceRoot);
  const rootReal = await realpath(root);
  const target = path.resolve(root, relativePath);
  if (!isPathInsideWorkspace(target, root)) {
    throw new Error("apply_patch path escapes the configured workspace");
  }
  const segments = relativePath.split(path.sep);
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      throw new Error("apply_patch refuses symlink path components");
    }
    if (!info.isDirectory()) {
      throw new Error("apply_patch parent path must be a directory");
    }
  }
  const parent = path.dirname(target);
  const parentReal = await realpath(parent);
  if (!isPathInsideWorkspace(parentReal, rootReal)) {
    throw new Error("apply_patch parent resolves outside the workspace");
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      throw new Error("apply_patch refuses symbolic-link targets");
    }
    if (!info.isFile()) {
      throw new Error("apply_patch target must be a regular file");
    }
    return { target, parent, exists: true, mode: info.mode & 0o777 };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { target, parent, exists: false, mode: 0o644 };
    }
    throw error;
  }
}

function decodeUtf8(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 text`);
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface WorkspaceTextEvidence {
  path: string;
  lineStart: number;
  lineEnd: number;
  totalLines: number;
  fileSha256: string;
  rangeSha256: string;
  fileSizeBytes: number;
  observedLineCount: number;
}

export async function readWorkspaceTextEvidence(
  workspaceRoot: string,
  input: {
    path: string;
    lineStart?: number;
    lineEnd?: number;
  },
): Promise<WorkspaceTextEvidence> {
  const hasLineStart = input.lineStart !== undefined;
  const hasLineEnd = input.lineEnd !== undefined;
  if (
    hasLineStart !== hasLineEnd ||
    (hasLineStart &&
      (!Number.isSafeInteger(input.lineStart) ||
        !Number.isSafeInteger(input.lineEnd) ||
        Number(input.lineStart) < 1 ||
        Number(input.lineEnd) < Number(input.lineStart)))
  ) {
    throw new Error("Workspace evidence line range is invalid");
  }
  const resolved = await resolveWorkspacePath(workspaceRoot, input.path);
  const handle = await open(
    resolved.target,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  let buffer: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new Error("Workspace evidence path must be a file");
    }
    if (info.size > MAX_HASHABLE_TEXT_BYTES) {
      throw new Error(
        `Workspace evidence supports files up to ${MAX_HASHABLE_TEXT_BYTES} bytes`,
      );
    }
    buffer = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (buffer.byteLength > MAX_HASHABLE_TEXT_BYTES) {
    throw new Error(
      `Workspace evidence supports files up to ${MAX_HASHABLE_TEXT_BYTES} bytes`,
    );
  }
  const source = decodeUtf8(buffer, "Workspace evidence target");
  const lines = source.split("\n");
  const lineStart = input.lineStart ?? 1;
  const lineEnd = input.lineEnd ?? lines.length;
  if (lineStart > lines.length || lineEnd > lines.length) {
    throw new Error(
      `Workspace evidence line range exceeds ${lines.length} lines`,
    );
  }
  const selected = lines.slice(lineStart - 1, lineEnd).join("\n");
  return {
    path: path.relative(resolved.root, resolved.target),
    lineStart,
    lineEnd,
    totalLines: lines.length,
    fileSha256: sha256(buffer),
    rangeSha256: sha256(selected),
    fileSizeBytes: buffer.byteLength,
    observedLineCount: lineEnd - lineStart + 1,
  };
}

async function readPatchSource(target: string): Promise<{
  source: string;
  bytes: number;
  sha256: string;
}> {
  const buffer = await readFile(target);
  if (buffer.byteLength > MAX_PATCH_BYTES) {
    throw new Error(
      `apply_patch supports files up to ${MAX_PATCH_BYTES} bytes`,
    );
  }
  return {
    source: decodeUtf8(buffer, "apply_patch target"),
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

function applyExactEdits(
  source: string,
  edits: Array<{ oldText: string; newText: string }>,
): string {
  let updated = source;
  for (const [index, edit] of edits.entries()) {
    if (edit.oldText.includes("\u0000") || edit.newText.includes("\u0000")) {
      throw new Error(`apply_patch edit ${index + 1} contains a null byte`);
    }
    const first = updated.indexOf(edit.oldText);
    const second = first < 0 ? -1 : updated.indexOf(edit.oldText, first + 1);
    if (first < 0) {
      throw new Error(`apply_patch edit ${index + 1} did not match`);
    }
    if (second >= 0) {
      throw new Error(
        `apply_patch edit ${index + 1} is ambiguous; oldText must occur exactly once`,
      );
    }
    updated =
      updated.slice(0, first) +
      edit.newText +
      updated.slice(first + edit.oldText.length);
  }
  return updated;
}

function applyHashlineEdits(
  source: string,
  edits: Array<{
    line?: number;
    anchorSha256: string;
    newText: string;
  }>,
): string {
  const lines = source.split("\n");
  const resolvedEdits: Array<{ lineIndex: number; newText: string }> =
    edits.map((edit, index) => {
      const label = `apply_patch hashline edit ${index + 1}`;
      if (!SHA256_PATTERN_RE.test(edit.anchorSha256)) {
        throw new Error(`${label} anchorSha256 is invalid`);
      }
      if (edit.newText.includes("\u0000")) {
        throw new Error(`${label} contains a null byte`);
      }
      if (edit.line !== undefined) {
        if (!Number.isSafeInteger(edit.line) || edit.line < 1) {
          throw new Error(`${label} line must be a positive integer`);
        }
        const lineIndex = edit.line - 1;
        if (
          lineIndex >= lines.length ||
          sha256(lines[lineIndex] ?? "") !== edit.anchorSha256
        ) {
          throw new Error(`${label} did not match line ${edit.line}`);
        }
        return {
          lineIndex,
          newText: edit.newText,
        };
      }

      const matches = lines.flatMap((line, lineIndex) =>
        sha256(line) === edit.anchorSha256 ? [lineIndex] : [],
      );
      if (matches.length === 0) {
        throw new Error(`${label} did not match`);
      }
      if (matches.length > 1) {
        throw new Error(
          `${label} is ambiguous; provide the read_file line number`,
        );
      }
      const [lineIndex] = matches;
      if (lineIndex === undefined) {
        throw new Error(`${label} did not match`);
      }
      return {
        lineIndex,
        newText: edit.newText,
      };
    });

  const seenLineIndexes = new Set<number>();
  for (const [index, edit] of resolvedEdits.entries()) {
    if (seenLineIndexes.has(edit.lineIndex)) {
      throw new Error(
        `apply_patch hashline edit ${index + 1} targets a line more than once`,
      );
    }
    seenLineIndexes.add(edit.lineIndex);
  }

  for (const edit of resolvedEdits
    .slice()
    .sort((left, right) => right.lineIndex - left.lineIndex)) {
    lines.splice(edit.lineIndex, 1, ...edit.newText.split("\n"));
  }
  return lines.join("\n");
}

async function withEditLock<T>(
  dataRoot: string,
  target: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locksRoot = path.join(path.resolve(dataRoot), "file-edit-locks");
  await mkdir(locksRoot, { recursive: true });
  const lockIdentity =
    process.platform === "darwin" || process.platform === "win32"
      ? target.toLowerCase()
      : target;
  const lockPath = path.join(locksRoot, `${sha256(lockIdentity)}.lock`);
  let lock;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (
        errorCode(error) === "EEXIST" &&
        attempt === 0 &&
        (await removeAbandonedEditLock(lockPath))
      ) {
        continue;
      }
      if (errorCode(error) === "EEXIST") {
        throw new Error("apply_patch target is already being edited");
      }
      throw error;
    }
  }
  if (!lock) throw new Error("apply_patch could not acquire its edit lock");
  try {
    await lock.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    await lock.sync();
    return await operation();
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

async function removeAbandonedEditLock(lockPath: string): Promise<boolean> {
  let record: { pid?: unknown };
  try {
    record = JSON.parse(await readFile(lockPath, "utf8")) as {
      pid?: unknown;
    };
  } catch (error) {
    return isMissingFileError(error);
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
    return isMissingFileError(error);
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

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function applyWorkspacePatch(
  workspaceRoot: string,
  dataRoot: string,
  input: WorkspacePatchInput,
): Promise<WorkspacePatchResult> {
  const relativePath = normalizeWritablePath(input.path);
  const preflight = await inspectWritableTarget(workspaceRoot, relativePath);
  const canonicalTarget = preflight.exists
    ? await realpath(preflight.target)
    : path.join(
        await realpath(preflight.parent),
        path.basename(preflight.target),
      );
  return withEditLock(dataRoot, canonicalTarget, async () => {
    const initial = await inspectWritableTarget(workspaceRoot, relativePath);
    let source = "";
    let beforeBytes = 0;
    let beforeSha256: string | null = null;
    if (input.operation === "create") {
      if (initial.exists) {
        throw new Error("apply_patch create target already exists");
      }
      if (input.expectedSha256 !== null) {
        throw new Error("apply_patch create requires expectedSha256 null");
      }
    } else {
      if (!initial.exists) {
        throw new Error("apply_patch replace target does not exist");
      }
      const current = await readPatchSource(initial.target);
      source = current.source;
      beforeBytes = current.bytes;
      beforeSha256 = current.sha256;
      if (beforeSha256 !== input.expectedSha256) {
        throw new Error(
          `apply_patch precondition failed; current SHA-256 is ${beforeSha256}`,
        );
      }
    }
    const updated =
      input.operation === "create"
        ? input.content
        : input.operation === "replace"
          ? applyExactEdits(source, input.edits)
          : applyHashlineEdits(source, input.edits);
    if (updated.includes("\u0000")) {
      throw new Error("apply_patch output contains a null byte");
    }
    const output = Buffer.from(updated, "utf8");
    if (output.byteLength > MAX_PATCH_BYTES) {
      throw new Error(`apply_patch output exceeds ${MAX_PATCH_BYTES} bytes`);
    }
    const afterSha256 = sha256(output);
    if (beforeSha256 === afterSha256) {
      throw new Error("apply_patch produced no content change");
    }

    const latest = await inspectWritableTarget(workspaceRoot, relativePath);
    if (input.operation === "create") {
      if (latest.exists) {
        throw new Error(
          "apply_patch create precondition changed before commit",
        );
      }
    } else {
      if (!latest.exists) {
        throw new Error("apply_patch target disappeared before commit");
      }
      const latestSource = await readPatchSource(latest.target);
      if (latestSource.sha256 !== input.expectedSha256) {
        throw new Error(
          `apply_patch precondition changed before commit; current SHA-256 is ${latestSource.sha256}`,
        );
      }
    }

    const temporaryPath = path.join(
      latest.parent,
      `.${path.basename(latest.target)}.napier-${randomBytes(8).toString("hex")}.tmp`,
    );
    let temporaryExists = false;
    try {
      const temporary = await open(temporaryPath, "wx", latest.mode);
      temporaryExists = true;
      try {
        await temporary.writeFile(output);
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      if (input.operation === "create") {
        await link(temporaryPath, latest.target);
        await unlink(temporaryPath);
      } else {
        await rename(temporaryPath, latest.target);
      }
      temporaryExists = false;
      await syncDirectory(latest.parent);
    } finally {
      if (temporaryExists) {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
    return {
      path: relativePath,
      pathSha256: sha256(relativePath),
      operation: input.operation,
      beforeSha256,
      afterSha256,
      beforeBytes,
      afterBytes: output.byteLength,
      editCount: input.operation === "create" ? 0 : input.edits.length,
    };
  });
}

function createLineAnchors(
  lines: string[],
  start: number,
  end: number,
): {
  lineAnchors: Array<{ line: number; sha256: string }>;
  lineAnchorsTruncated: boolean;
} {
  const cappedEnd = Math.min(end, start + MAX_READ_LINE_ANCHORS);
  return {
    lineAnchors: lines.slice(start, cappedEnd).map((line, index) => ({
      line: start + index + 1,
      sha256: sha256(line),
    })),
    lineAnchorsTruncated: cappedEnd < end,
  };
}

async function walkFiles(root: string, depth: number): Promise<string[]> {
  const output: string[] = [];
  const visit = async (
    directory: string,
    remainingDepth: number,
  ): Promise<void> => {
    if (output.length >= MAX_LIST_ENTRIES) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".napier"
      )
        continue;
      const absolute = path.join(directory, entry.name);
      output.push(absolute);
      if (entry.isDirectory() && remainingDepth > 0) {
        await visit(absolute, remainingDepth - 1);
      }
      if (output.length >= MAX_LIST_ENTRIES) return;
    }
  };
  await visit(root, depth);
  return output;
}

export function createWorkspaceTools(
  workspaceRoot: string,
  options: CreateWorkspaceToolsOptions = {},
): AgentTool[] {
  const listFiles: AgentTool<
    typeof listFilesSchema,
    WorkspaceListDetails
  > = {
    name: "list_files",
    label: "List files",
    description: "List files and directories inside the configured workspace.",
    parameters: listFilesSchema,
    async execute(_toolCallId, input) {
      const resolved = await resolveWorkspacePath(
        workspaceRoot,
        input.path ?? ".",
      );
      const target = resolved.target;
      const info = await stat(target);
      if (!info.isDirectory())
        throw new Error("list_files path must be a directory");
      const files = await walkFiles(target, input.depth ?? 1);
      const lines = files.map((file) => {
        const relative = path.relative(resolved.root, file) || ".";
        return relative;
      });
      const relativeTarget = path.relative(resolved.root, target) || ".";
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "(empty directory)",
          },
        ],
        details: {
          count: lines.length,
          truncated: lines.length >= MAX_LIST_ENTRIES,
          pathSha256: sha256(relativeTarget),
          entrySetSha256: sha256(JSON.stringify(lines)),
        },
      };
    },
  };

  const readTextFile: AgentTool<typeof readFileSchema, WorkspaceReadDetails> = {
    name: "read_file",
    label: "Read file",
    description: `Read a UTF-8 text file inside the workspace, up to ${MAX_READ_BYTES / 1024} KB.`,
    parameters: readFileSchema,
    async execute(_toolCallId, input) {
      const resolved = await resolveWorkspacePath(workspaceRoot, input.path);
      const target = resolved.target;
      const info = await stat(target);
      if (!info.isFile()) throw new Error("read_file path must be a file");
      if (info.size > MAX_HASHABLE_TEXT_BYTES) {
        throw new Error(
          `read_file supports files up to ${MAX_HASHABLE_TEXT_BYTES} bytes`,
        );
      }
      const buffer = await readFile(target);
      const source = decodeUtf8(buffer, "read_file target");
      const contentSha256 = sha256(buffer);
      const lines = source.split("\n");
      const start = Math.max(0, (input.startLine ?? 1) - 1);
      const end = Math.min(lines.length, input.endLine ?? lines.length);
      const selected = lines.slice(start, end).join("\n");
      const bytes = Buffer.byteLength(selected);
      const text =
        bytes <= MAX_READ_BYTES
          ? selected
          : `${Buffer.from(selected).subarray(0, MAX_READ_BYTES).toString("utf8")}\n\n[truncated]`;
      const { lineAnchors, lineAnchorsTruncated } = createLineAnchors(
        lines,
        start,
        end,
      );
      const relativePath = path.relative(resolved.root, target);
      const lineAnchorSetSha256 = sha256(JSON.stringify(lineAnchors));
      const metadata = JSON.stringify({
        path: relativePath,
        pathSha256: sha256(relativePath),
        sha256: contentSha256,
        sizeBytes: buffer.byteLength,
        lineAnchors,
        lineAnchorsTruncated,
        lineAnchorSetSha256,
      });
      return {
        content: [
          {
            type: "text",
            text: `Napier file metadata: ${metadata}\n\n${text}`,
          },
        ],
        details: {
          startLine: start + 1,
          endLine: end,
          totalLines: lines.length,
          path: relativePath,
          pathSha256: sha256(relativePath),
          sha256: contentSha256,
          sizeBytes: buffer.byteLength,
          truncated: bytes > MAX_READ_BYTES,
          lineAnchors,
          lineAnchorsTruncated,
          lineAnchorSetSha256,
        },
      };
    },
  };

  const searchFiles: AgentTool<
    typeof searchFilesSchema,
    WorkspaceSearchDetails
  > = {
    name: "search_files",
    label: "Search files",
    description: "Search UTF-8 workspace files for a literal text query.",
    parameters: searchFilesSchema,
    async execute(_toolCallId, input) {
      const resolved = await resolveWorkspacePath(
        workspaceRoot,
        input.path ?? ".",
      );
      const target = resolved.target;
      const files = await walkFiles(target, 8);
      const lines: string[] = [];
      const matches: WorkspaceSearchMatch[] = [];
      for (const file of files) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_READ_BYTES) continue;
        let buffer: Buffer;
        let source: string;
        try {
          buffer = await readFile(file);
          source = decodeUtf8(buffer, "search_files target");
        } catch {
          continue;
        }
        const fileSha256 = sha256(buffer);
        const relativePath = path.relative(resolved.root, file);
        for (const [index, line] of source.split("\n").entries()) {
          if (
            matches.length >= MAX_SEARCH_MATCHES ||
            !line.includes(input.query)
          )
            continue;
          const lineSha256 = sha256(line);
          matches.push({
            path: relativePath,
            line: index + 1,
            fileSha256,
            lineSha256,
            sizeBytes: buffer.byteLength,
          });
          lines.push(
            `${relativePath}:${index + 1} [lineSha256=${lineSha256} fileSha256=${fileSha256}]: ${line.trim()}`,
          );
        }
      }
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "No matches found.",
          },
        ],
        details: {
          count: matches.length,
          truncated: matches.length >= MAX_SEARCH_MATCHES,
          matchSetSha256: sha256(JSON.stringify(matches)),
          matches,
        },
      };
    },
  };

  const tools: AgentTool[] = [listFiles, readTextFile, searchFiles];
  if (options.includeWriteTools) {
    if (!options.dataRoot) {
      throw new Error("Write-capable workspace tools require a dataRoot");
    }
    const applyPatch: AgentTool<typeof applyPatchSchema, WorkspacePatchResult> =
      {
        name: "apply_patch",
        label: "Apply patch",
        description:
          "Atomically create or edit one UTF-8 workspace file. Existing files require the complete SHA-256 from read_file, and replacements can match exact text or read_file line hash anchors. Deletion is not supported.",
        parameters: applyPatchSchema,
        async execute(_toolCallId, input) {
          const result = await applyWorkspacePatch(
            workspaceRoot,
            options.dataRoot!,
            input as WorkspacePatchInput,
          );
          return {
            content: [
              {
                type: "text",
                text: [
                  `${result.operation === "create" ? "Created" : "Updated"} ${result.path} atomically.`,
                  `Before SHA-256: ${result.beforeSha256 ?? "absent"}`,
                  `After SHA-256: ${result.afterSha256}`,
                  `Bytes: ${result.beforeBytes} -> ${result.afterBytes}`,
                  `Edits: ${result.editCount}`,
                ].join("\n"),
              },
            ],
            details: result,
          };
        },
      };
    tools.push(applyPatch);
  }
  return tools;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

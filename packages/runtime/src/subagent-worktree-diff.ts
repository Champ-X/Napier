import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  LspRenameEdit,
  LspRenameFile,
} from "./lsp-rename-workspace-edit.js";

export interface SubagentWorktreeFile {
  path: string;
  pathSha256: string;
  fileSha256: string;
  sizeBytes: number;
  mode: number;
  buffer: Buffer;
}

export interface SubagentWorktreeSnapshot {
  files: SubagentWorktreeFile[];
  fileCount: number;
  bytes: number;
  contentSha256: string;
}

export type SubagentWorktreeChangeOperation = "add" | "modify" | "delete";

export interface SubagentWorktreeChange {
  operation: SubagentWorktreeChangeOperation;
  path: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeText?: string;
  afterText?: string;
  mode?: number;
}

export interface SubagentWorktreeCandidate {
  changes: SubagentWorktreeChange[];
  changedPaths: string[];
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  changedFileSetSha256: string;
  candidateSnapshotSha256: string;
}

export function createSubagentWorktreeCandidate(input: {
  baseline: SubagentWorktreeSnapshot;
  candidate: SubagentWorktreeSnapshot;
  writePaths: string[];
}): SubagentWorktreeCandidate {
  const baselineByPath = new Map(
    input.baseline.files.map((file) => [file.path, file]),
  );
  const candidateByPath = new Map(
    input.candidate.files.map((file) => [file.path, file]),
  );
  const writePaths = new Set(input.writePaths);
  const changedPaths = [
    ...new Set([...baselineByPath.keys(), ...candidateByPath.keys()]),
  ]
    .filter(
      (candidate) =>
        baselineByPath.get(candidate)?.fileSha256 !==
        candidateByPath.get(candidate)?.fileSha256,
    )
    .sort();
  if (changedPaths.length < 1) {
    throw new Error("Subagent worktree produced no declared file changes");
  }
  if (changedPaths.some((candidate) => !writePaths.has(candidate))) {
    throw new Error(
      "Subagent worktree changed a file outside its declared write paths",
    );
  }
  const changes = changedPaths.map((candidate) =>
    createChange(baselineByPath.get(candidate), candidateByPath.get(candidate)),
  );
  const renamedFileCount = applyRenameModes(changes);
  const addedFileCount = count(changes, "add");
  const modifiedFileCount = count(changes, "modify");
  const deletedFileCount = count(changes, "delete");
  return {
    changes,
    changedPaths,
    addedFileCount,
    modifiedFileCount,
    deletedFileCount,
    renamedFileCount,
    candidateSnapshotSha256: input.candidate.contentSha256,
    changedFileSetSha256: sha256(
      canonicalJson(
        changes.map((change) => ({
          operation: change.operation,
          pathSha256: change.pathSha256,
          beforeSha256: change.beforeSha256,
          afterSha256: change.afterSha256,
        })),
      ),
    ),
  };
}

export function subagentWorktreeModifiedLspFiles(
  changes: SubagentWorktreeChange[],
): LspRenameFile[] {
  return changes
    .filter(
      (
        change,
      ): change is SubagentWorktreeChange & {
        operation: "modify";
        beforeText: string;
        afterText: string;
        beforeSha256: string;
      } =>
        change.operation === "modify" &&
        change.beforeText !== undefined &&
        change.afterText !== undefined &&
        change.beforeSha256 !== null,
    )
    .map((change) => {
      const lines = change.beforeText.split("\n");
      const edit: LspRenameEdit = {
        path: change.path,
        pathSha256: change.pathSha256,
        fileSha256: change.beforeSha256,
        startLine: 1,
        startCharacter: 1,
        endLine: lines.length,
        endCharacter: lines.at(-1)!.length + 1,
        rangeSha256: sha256(
          canonicalJson({
            startLine: 1,
            startCharacter: 1,
            endLine: lines.length,
            endCharacter: lines.at(-1)!.length + 1,
          }),
        ),
        oldText: change.beforeText,
        oldTextSha256: sha256(change.beforeText),
        newText: change.afterText,
        newTextSha256: sha256(change.afterText),
      };
      return {
        path: change.path,
        pathSha256: change.pathSha256,
        fileSha256: change.beforeSha256,
        edits: [edit],
      };
    });
}

function createChange(
  before: SubagentWorktreeFile | undefined,
  after: SubagentWorktreeFile | undefined,
): SubagentWorktreeChange {
  if (!before && !after) {
    throw new Error("Subagent worktree change is unavailable");
  }
  if (!before) {
    return {
      operation: "add",
      path: after!.path,
      pathSha256: after!.pathSha256,
      beforeSha256: null,
      afterSha256: after!.fileSha256,
      afterText: decodeUtf8(after!.buffer, "Subagent worktree addition"),
    };
  }
  if (!after) {
    return {
      operation: "delete",
      path: before.path,
      pathSha256: before.pathSha256,
      beforeSha256: before.fileSha256,
      afterSha256: null,
      beforeText: decodeUtf8(before.buffer, "Subagent worktree deletion"),
      mode: before.mode,
    };
  }
  return {
    operation: "modify",
    path: before.path,
    pathSha256: before.pathSha256,
    beforeSha256: before.fileSha256,
    afterSha256: after.fileSha256,
    beforeText: decodeUtf8(before.buffer, "Subagent worktree baseline"),
    afterText: decodeUtf8(after.buffer, "Subagent worktree candidate"),
  };
}

function count(
  changes: SubagentWorktreeChange[],
  operation: SubagentWorktreeChangeOperation,
): number {
  return changes.filter((change) => change.operation === operation).length;
}

function applyRenameModes(changes: SubagentWorktreeChange[]): number {
  const additions = new Map<string, SubagentWorktreeChange[]>();
  const deletions = new Map<string, SubagentWorktreeChange[]>();
  for (const change of changes) {
    if (change.operation === "add") {
      const matches = additions.get(change.afterSha256!) ?? [];
      matches.push(change);
      additions.set(change.afterSha256!, matches);
    } else if (change.operation === "delete") {
      const matches = deletions.get(change.beforeSha256!) ?? [];
      matches.push(change);
      deletions.set(change.beforeSha256!, matches);
    }
  }
  let count = 0;
  for (const [contentSha256, added] of additions) {
    const deleted = deletions.get(contentSha256) ?? [];
    if (deleted.length === 0) continue;
    if (added.length !== 1 || deleted.length !== 1) {
      throw new Error(
        "Subagent worktree contains an ambiguous same-content rename",
      );
    }
    if (deleted[0]!.mode !== undefined) added[0]!.mode = deleted[0]!.mode;
    count += 1;
  }
  return count;
}

function decodeUtf8(buffer: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

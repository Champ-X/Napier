import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_WORKSPACE_SNAPSHOT_FILES = 2_000;
export const MAX_WORKSPACE_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_WORKSPACE_DELTA_ENTRIES = 256;

const SNAPSHOT_EXCLUDED_SEGMENTS = new Set([".git", ".napier", "node_modules"]);

export interface WorkspaceSnapshotEntry {
  path: string;
  sha256?: string;
  sizeBytes: number;
  truncated?: boolean;
}

export interface WorkspacePathSnapshot {
  kind: "file" | "directory";
  sha256: string;
  fileCount: number;
  bytes: number;
  truncated: boolean;
  entries: WorkspaceSnapshotEntry[];
}

export interface WorkspaceDeltaEntry {
  kind: "added" | "modified" | "removed";
  path: string;
  beforeSha256?: string;
  afterSha256?: string;
  beforeSizeBytes?: number;
  afterSizeBytes?: number;
}

export interface WorkspaceSnapshotDelta {
  status: "unchanged" | "changed" | "indeterminate";
  changedFileCount: number;
  changedPathSetSha256: string;
  entriesTruncated: boolean;
  entries: WorkspaceDeltaEntry[];
}

export interface WorkspaceSnapshotOptions {
  maxFiles?: number;
  maxBytes?: number;
}

export async function createWorkspacePathSnapshot(
  workspaceRoot: string,
  target: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<WorkspacePathSnapshot> {
  const [canonicalWorkspaceRoot, canonicalTarget] = await Promise.all([
    realpath(path.resolve(workspaceRoot)),
    realpath(path.resolve(target)),
  ]);
  const relativeTarget = path.relative(canonicalWorkspaceRoot, canonicalTarget);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error("workspace snapshot scope escapes the workspace");
  }
  const limits = {
    maxFiles: options.maxFiles ?? MAX_WORKSPACE_SNAPSHOT_FILES,
    maxBytes: options.maxBytes ?? MAX_WORKSPACE_SNAPSHOT_BYTES,
  };
  if (
    !Number.isSafeInteger(limits.maxFiles) ||
    limits.maxFiles < 1 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes < 1
  ) {
    throw new Error("workspace snapshot limits are invalid");
  }
  const info = await stat(canonicalTarget);
  if (info.isFile()) {
    return createFileSnapshot(
      canonicalWorkspaceRoot,
      canonicalTarget,
      info.size,
      limits.maxBytes,
    );
  }
  if (info.isDirectory()) {
    return createDirectorySnapshot(
      canonicalWorkspaceRoot,
      canonicalTarget,
      limits,
    );
  }
  throw new Error("workspace snapshot scope must be a file or directory");
}

export function diffWorkspaceSnapshots(
  before: WorkspacePathSnapshot,
  after: WorkspacePathSnapshot,
  maxEntries = MAX_WORKSPACE_DELTA_ENTRIES,
): WorkspaceSnapshotDelta {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("workspace delta entry limit is invalid");
  }
  if (before.kind !== after.kind || before.truncated || after.truncated) {
    return {
      status: "indeterminate",
      changedFileCount: 0,
      changedPathSetSha256: sha256(
        canonicalJson({
          status: "indeterminate",
          beforeSha256: before.sha256,
          afterSha256: after.sha256,
        }),
      ),
      entriesTruncated: false,
      entries: [],
    };
  }
  const beforeEntries = new Map(
    before.entries.map((entry) => [entry.path, entry]),
  );
  const afterEntries = new Map(
    after.entries.map((entry) => [entry.path, entry]),
  );
  const paths = [
    ...new Set([...beforeEntries.keys(), ...afterEntries.keys()]),
  ].sort();
  const changedEntries = paths.flatMap((entryPath): WorkspaceDeltaEntry[] => {
    const previous = beforeEntries.get(entryPath);
    const current = afterEntries.get(entryPath);
    if (!previous && current) {
      return [
        {
          kind: "added",
          path: entryPath,
          ...(current.sha256 ? { afterSha256: current.sha256 } : {}),
          afterSizeBytes: current.sizeBytes,
        },
      ];
    }
    if (previous && !current) {
      return [
        {
          kind: "removed",
          path: entryPath,
          ...(previous.sha256 ? { beforeSha256: previous.sha256 } : {}),
          beforeSizeBytes: previous.sizeBytes,
        },
      ];
    }
    if (
      previous &&
      current &&
      (previous.sha256 !== current.sha256 ||
        previous.sizeBytes !== current.sizeBytes)
    ) {
      return [
        {
          kind: "modified",
          path: entryPath,
          ...(previous.sha256 ? { beforeSha256: previous.sha256 } : {}),
          ...(current.sha256 ? { afterSha256: current.sha256 } : {}),
          beforeSizeBytes: previous.sizeBytes,
          afterSizeBytes: current.sizeBytes,
        },
      ];
    }
    return [];
  });
  return {
    status: changedEntries.length === 0 ? "unchanged" : "changed",
    changedFileCount: changedEntries.length,
    changedPathSetSha256: sha256(
      canonicalJson(
        changedEntries.map((entry) => ({
          kind: entry.kind,
          pathSha256: sha256(entry.path),
        })),
      ),
    ),
    entriesTruncated: changedEntries.length > maxEntries,
    entries: changedEntries.slice(0, maxEntries),
  };
}

export function unavailableWorkspacePathSnapshot(
  kind: WorkspacePathSnapshot["kind"],
): WorkspacePathSnapshot {
  return {
    kind,
    sha256: sha256(canonicalJson({ kind, unavailable: true })),
    fileCount: 0,
    bytes: 0,
    truncated: true,
    entries: [],
  };
}

function createFileSnapshot(
  workspaceRoot: string,
  target: string,
  sizeBytes: number,
  maxBytes: number,
): Promise<WorkspacePathSnapshot> {
  const relative = path.relative(workspaceRoot, target) || ".";
  if (sizeBytes > maxBytes) {
    const entries = [
      { path: relative, sizeBytes, truncated: true },
    ] satisfies WorkspaceSnapshotEntry[];
    return Promise.resolve({
      kind: "file",
      sha256: sha256(
        canonicalJson({
          kind: "file",
          path: relative,
          sizeBytes,
          truncated: true,
        }),
      ),
      fileCount: 1,
      bytes: 0,
      truncated: true,
      entries,
    });
  }
  return readFile(target).then((buffer) => {
    const digest = sha256(buffer);
    return {
      kind: "file",
      sha256: digest,
      fileCount: 1,
      bytes: buffer.byteLength,
      truncated: false,
      entries: [
        {
          path: relative,
          sha256: digest,
          sizeBytes: buffer.byteLength,
        },
      ],
    };
  });
}

async function createDirectorySnapshot(
  workspaceRoot: string,
  directory: string,
  limits: { maxFiles: number; maxBytes: number },
): Promise<WorkspacePathSnapshot> {
  const entries: WorkspaceSnapshotEntry[] = [];
  let bytes = 0;
  let truncated = false;

  const visit = async (current: string): Promise<void> => {
    if (truncated) return;
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const child of children) {
      if (truncated) return;
      if (
        child.isSymbolicLink() ||
        SNAPSHOT_EXCLUDED_SEGMENTS.has(child.name)
      ) {
        continue;
      }
      const absolute = path.join(current, child.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!info.isFile()) continue;
      const relative = path.relative(workspaceRoot, absolute) || ".";
      if (
        entries.length >= limits.maxFiles ||
        bytes + info.size > limits.maxBytes
      ) {
        truncated = true;
        entries.push({
          path: relative,
          sizeBytes: info.size,
          truncated: true,
        });
        return;
      }
      const buffer = await readFile(absolute);
      bytes += buffer.byteLength;
      entries.push({
        path: relative,
        sha256: sha256(buffer),
        sizeBytes: buffer.byteLength,
      });
    }
  };

  await visit(directory);
  return {
    kind: "directory",
    sha256: sha256(canonicalJson(entries)),
    fileCount: entries.length,
    bytes,
    truncated,
    entries,
  };
}

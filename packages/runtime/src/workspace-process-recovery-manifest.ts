import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { normalizeMutationPath } from "./workspace-file-scope.js";
import type {
  WorkspaceProcessRecoveryScope,
  WorkspaceProcessRecoveryScopeTotals,
} from "./workspace-process-recovery-files.js";

export const MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES = 10_000;
export const MAX_WORKSPACE_PROCESS_RECOVERY_BYTES = 64 * 1024 * 1024;

const PROCESS_ID = /^process_[a-z0-9]{8,80}$/u;
const BACKUP_NAME = /^scope-[0-9]{2}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MANIFEST_KEYS = [
  "kind",
  "schemaVersion",
  "processId",
  "threadId",
  "runId",
  "writePreviewSha256",
  "writeScopeSetSha256",
  "workspaceBeforeSha256",
  "scopes",
  "totals",
  "createdAt",
  "contentSha256",
] as const;
const SCOPE_KEYS = [
  "relativePath",
  "relativePathSha256",
  "backupName",
  "entryKind",
  "snapshotSha256",
  "modeSetSha256",
  "fileCount",
  "directoryCount",
  "bytes",
] as const;
const TOTAL_KEYS = [
  "scopeCount",
  "fileCount",
  "directoryCount",
  "bytes",
] as const;

export interface WorkspaceProcessRecoveryManifest {
  kind: "napier.workspace-process-recovery";
  schemaVersion: 1;
  processId: string;
  threadId: string;
  runId: string;
  writePreviewSha256: string;
  writeScopeSetSha256: string;
  workspaceBeforeSha256: string;
  scopes: WorkspaceProcessRecoveryScope[];
  totals: WorkspaceProcessRecoveryScopeTotals;
  createdAt: string;
  contentSha256: string;
}

export interface WorkspaceProcessRecoveryBinding {
  recoverySnapshotSha256: string;
  recoveryScopeCount: number;
  recoveryFileCount: number;
  recoveryDirectoryCount: number;
  recoveryBytes: number;
}

export function createWorkspaceProcessRecoveryManifest(input: {
  processId: string;
  threadId: string;
  runId: string;
  writePreviewSha256: string;
  writeScopeSetSha256: string;
  workspaceBeforeSha256: string;
  scopes: WorkspaceProcessRecoveryScope[];
  totals: WorkspaceProcessRecoveryScopeTotals;
  createdAt: string;
}): WorkspaceProcessRecoveryManifest {
  const content = {
    kind: "napier.workspace-process-recovery" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function workspaceProcessRecoveryBinding(
  manifest: WorkspaceProcessRecoveryManifest,
): WorkspaceProcessRecoveryBinding {
  return {
    recoverySnapshotSha256: manifest.contentSha256,
    recoveryScopeCount: manifest.totals.scopeCount,
    recoveryFileCount: manifest.totals.fileCount,
    recoveryDirectoryCount: manifest.totals.directoryCount,
    recoveryBytes: manifest.totals.bytes,
  };
}

export function validWorkspaceProcessRecoveryProcessId(value: string): boolean {
  return PROCESS_ID.test(value);
}

export function parseWorkspaceProcessRecoveryManifest(
  value: unknown,
): WorkspaceProcessRecoveryManifest | undefined {
  if (!record(value) || !exactKeys(value, MANIFEST_KEYS)) return undefined;
  const scopes = value["scopes"];
  const totals = value["totals"];
  if (
    value["kind"] !== "napier.workspace-process-recovery" ||
    value["schemaVersion"] !== 1 ||
    typeof value["processId"] !== "string" ||
    !PROCESS_ID.test(value["processId"]) ||
    typeof value["threadId"] !== "string" ||
    typeof value["runId"] !== "string" ||
    !hash(value["writePreviewSha256"]) ||
    !hash(value["writeScopeSetSha256"]) ||
    !hash(value["workspaceBeforeSha256"]) ||
    !Array.isArray(scopes) ||
    scopes.length < 1 ||
    scopes.length > 8 ||
    !record(totals) ||
    !exactKeys(totals, TOTAL_KEYS) ||
    !integer(totals["scopeCount"], 1, 8) ||
    !integer(totals["fileCount"], 0, MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES) ||
    !integer(
      totals["directoryCount"],
      0,
      MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES,
    ) ||
    !integer(totals["bytes"], 0, MAX_WORKSPACE_PROCESS_RECOVERY_BYTES) ||
    !isoDate(value["createdAt"]) ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  const parsedScopes: WorkspaceProcessRecoveryScope[] = [];
  for (const [index, scope] of scopes.entries()) {
    if (
      !record(scope) ||
      !exactKeys(scope, SCOPE_KEYS) ||
      typeof scope["relativePath"] !== "string" ||
      normalizePath(scope["relativePath"]) !== scope["relativePath"] ||
      !hash(scope["relativePathSha256"]) ||
      sha256(scope["relativePath"]) !== scope["relativePathSha256"] ||
      scope["backupName"] !== `scope-${String(index).padStart(2, "0")}` ||
      !BACKUP_NAME.test(String(scope["backupName"])) ||
      (scope["entryKind"] !== "file" && scope["entryKind"] !== "directory") ||
      !hash(scope["snapshotSha256"]) ||
      !hash(scope["modeSetSha256"]) ||
      !integer(scope["fileCount"], 0, MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES) ||
      !integer(
        scope["directoryCount"],
        0,
        MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES,
      ) ||
      !integer(scope["bytes"], 0, MAX_WORKSPACE_PROCESS_RECOVERY_BYTES)
    ) {
      return undefined;
    }
    parsedScopes.push(
      structuredClone(scope) as unknown as WorkspaceProcessRecoveryScope,
    );
  }
  if (
    totals["scopeCount"] !== parsedScopes.length ||
    totals["fileCount"] !==
      parsedScopes.reduce((sum, scope) => sum + scope.fileCount, 0) ||
    totals["directoryCount"] !==
      parsedScopes.reduce((sum, scope) => sum + scope.directoryCount, 0) ||
    totals["bytes"] !==
      parsedScopes.reduce((sum, scope) => sum + scope.bytes, 0) ||
    Number(totals["fileCount"]) + Number(totals["directoryCount"]) >
      MAX_WORKSPACE_PROCESS_RECOVERY_ENTRIES
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content as JsonValue)) !== contentSha256) {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceProcessRecoveryManifest;
}

function normalizePath(value: string): string | undefined {
  try {
    return normalizeMutationPath(value);
  } catch {
    return undefined;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

import { canonicalJson, sha256 } from "./ed25519.js";
import type { CandidateState } from "./subagent-candidate-state.js";
import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";
import { normalizeSubagentWorktreePath } from "./subagent-worktree-path.js";

const HASH = /^[a-f0-9]{64}$/u;
export const LEGACY_PREVIEW_FIELDS = [
  "sourceSnapshotSha256", "changedFileCount", "changedFileSetSha256",
  "candidateVerificationAttemptCount", "candidateVerificationFreshCount", "candidateVerificationPassedCount",
  "candidateVerificationFailedCount", "candidateVerificationStaleCount", "candidateVerificationSetSha256",
  "candidateCommandAttemptCount", "candidateCommandFreshCount", "candidateCommandSucceededCount",
  "candidateCommandFailedCount", "candidateCommandStaleCount", "candidateCommandSetSha256",
  "candidateToolchainSha256",
] as const;
export const LEGACY_CHANGE_COUNTS = ["addedFileCount", "modifiedFileCount", "deletedFileCount", "renamedFileCount"] as const;

export function assertLegacyCandidateContent(source: WorktreePreviewSource): void {
  const metadata = source as unknown as Record<string, unknown>;
  const { sourcePreviewResultSha256, sourceRoot: _root, changes, files, ...receipt } = source;
  if (files.length || source.completion || source.candidateVerification || source.candidateCommands ||
      source.candidateId || source.mergePrepared || source.legacySourceSnapshotRequired !== undefined || !changes.length ||
      sha256(canonicalJson(receipt)) !== sourcePreviewResultSha256)
    invalid("content receipt is invalid");
  const paths = changes.map((change) => change.path);
  if (new Set(paths).size !== paths.length || canonicalJson([...paths].sort()) !== canonicalJson(paths))
    invalid("change paths are ambiguous");
  changes.forEach(assertChangeContent);
  const changedFileSetSha256 = sha256(canonicalJson(changes.map((change) => ({
    operation: change.operation, pathSha256: change.pathSha256, beforeSha256: change.beforeSha256,
    afterSha256: change.afterSha256, beforeMode: change.beforeMode ?? null, mode: change.mode ?? null,
  }))));
  if (metadata["changedFileCount"] !== changes.length || source.changedFileSetSha256 !== changedFileSetSha256 ||
      source.addedFileCount !== changes.filter((change) => change.operation === "add").length ||
      source.modifiedFileCount !== changes.filter((change) => change.operation === "modify").length ||
      source.deletedFileCount !== changes.filter((change) => change.operation === "delete").length)
    invalid("change set binding is invalid");
}

function assertChangeContent(change: SubagentWorktreeChange): void {
  if (normalizeSubagentWorktreePath(change.path) !== change.path || sha256(change.path) !== change.pathSha256 ||
      !["add", "modify", "delete"].includes(change.operation)) invalid("change path is invalid");
  for (const side of ["before", "after"] as const) {
    const absent = side === "before" ? change.operation === "add" : change.operation === "delete";
    const hash = change[`${side}Sha256`], text = change[`${side}Text`];
    if (absent ? hash !== null || text !== undefined :
      typeof hash !== "string" || !HASH.test(hash) || typeof text !== "string" || sha256(text) !== hash)
      invalid("change content binding is invalid");
  }
}

export function assertLegacyCandidateState(source: WorktreePreviewSource, state: CandidateState | undefined): void {
  if (!state) return;
  if (state.status !== "settled" || !state.result) invalid(`${state.status} state requires reconciliation`);
  const { resultSha256, ...details } = state.result.details;
  const origin = ["taskId", "outcomeSha256", "sourceSnapshotSha256", "sourceFileCount", "sourceBytes",
    "writeScopeCount", "writeScopeSetSha256", "changedFileSetSha256"] as const;
  if (details.kind !== "napier.subagent-worktree-apply" || details.schemaVersion !== 1 ||
      sha256(canonicalJson(details)) !== resultSha256 || origin.some((key) => details[key] !== source[key]) ||
      !HASH.test(details.sourcePreviewResultSha256) || !details.durable ||
      details.postcondition !== "verified" ||
      !(details.status === "applied" || (details.status === "rolled_back" && details.rollbackVerified)))
    invalid("settled state is unknown or conflicts with candidate");
}

function invalid(reason: string): never { throw new Error(`Legacy candidate ${reason}; retained for inspection`); }

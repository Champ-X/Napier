import {
  writeLinkedTestEventEvidence,
  type WriteLinkedTestEventTraceView,
} from "./write-linked-test-event-view";
import { lspRenameApplyEventEvidence } from "./lsp-rename-apply-event-view";

export interface SubagentWorktreeToolEventTraceView {
  subagentWorktreeApplyStatus?: "applied" | "rolled_back" | "indeterminate";
  subagentWorktreePostcondition?: "verified" | "drifted" | "indeterminate";
  subagentWorktreeTaskId?: string;
  subagentWorktreeSourceFileCount?: number;
  subagentWorktreeSourceBytes?: number;
  subagentWorktreeWriteScopeCount?: number;
  subagentWorktreeChangedFileCount?: number;
  subagentWorktreeCommittedFileCount?: number;
  subagentWorktreeRestoredFileCount?: number;
  subagentWorktreeRollbackAttempted?: boolean;
  subagentWorktreeRollbackVerified?: boolean;
  subagentWorktreeDurable?: boolean;
  subagentWorktreeDiagnosticsStatus?: string;
  subagentWorktreeCandidateVerificationAttemptCount?: number;
  subagentWorktreeCandidateVerificationFreshCount?: number;
  subagentWorktreeCandidateVerificationPassedCount?: number;
  subagentWorktreeCandidateVerificationFailedCount?: number;
  subagentWorktreeCandidateVerificationStaleCount?: number;
  subagentWorktreeCandidateVerificationSetSha256?: string;
  subagentWorktreeCandidateToolchainSha256?: string;
  subagentWorktreeOutcomeSha256?: string;
  subagentWorktreeSourceSnapshotSha256?: string;
  subagentWorktreeWriteScopeSetSha256?: string;
  subagentWorktreeChangedFileSetSha256?: string;
  subagentWorktreeBeforeFileSetSha256?: string;
  subagentWorktreeExpectedFileSetSha256?: string;
  subagentWorktreeObservedFileSetSha256?: string;
  subagentWorktreeResultSha256?: string;
}

export function subagentWorktreeEventEvidence(
  value: unknown,
):
  | (SubagentWorktreeToolEventTraceView & WriteLinkedTestEventTraceView)
  | undefined {
  const input = record(value);
  if (!input) return undefined;
  const transaction = lspRenameApplyEventEvidence({
    ...input,
    kind: "napier.lsp-rename-apply",
  });
  if (!transaction) return undefined;
  const status = applyStatus(input["status"]);
  const postcondition = postconditionStatus(input["postcondition"]);
  const taskId =
    typeof input["taskId"] === "string" &&
    /^task_[a-z0-9]{8,80}$/u.test(input["taskId"])
      ? input["taskId"]
      : undefined;
  const sourceFileCount = integer(input["sourceFileCount"], 1, 2_000);
  const sourceBytes = integer(input["sourceBytes"], 0, 32 * 1024 * 1024);
  const writeScopeCount = integer(input["writeScopeCount"], 1, 8);
  const fileCount = integer(input["fileCount"], 1, 8);
  const editCount = integer(input["editCount"], 1, 8);
  const committedFileCount = integer(input["committedFileCount"], 0, 8);
  const restoredFileCount = integer(input["restoredFileCount"], 0, 8);
  const diagnostics = record(input["diagnostics"]);
  const diagnosticsPresent = input["diagnostics"] !== undefined;
  const diagnosticsStatus =
    diagnostics &&
    typeof diagnostics["status"] === "string" &&
    /^[a-z_]{2,32}$/u.test(diagnostics["status"])
      ? diagnostics["status"]
      : undefined;
  const diagnosticsResultSha256 = hash(diagnostics?.["resultSha256"]);
  const tests = writeLinkedTestEventEvidence(input["tests"]);
  const candidateVerification = candidateVerificationEvidence(input);
  const requiredHashes = {
    sourceSnapshot: hash(input["sourceSnapshotSha256"]),
    outcome: hash(input["outcomeSha256"]),
    writeScopes: hash(input["writeScopeSetSha256"]),
    changedFiles: hash(input["changedFileSetSha256"]),
    sourcePreview: hash(input["sourcePreviewResultSha256"]),
    plan: hash(input["planSha256"]),
    beforeFiles: hash(input["beforeFileSetSha256"]),
    expectedFiles: hash(input["expectedFileSetSha256"]),
    limits: hash(input["resourceLimitsSha256"]),
    result: hash(input["resultSha256"]),
  };
  if (
    input["kind"] !== "napier.subagent-worktree-apply" ||
    input["schemaVersion"] !== 1 ||
    !status ||
    !postcondition ||
    !taskId ||
    sourceFileCount === undefined ||
    sourceBytes === undefined ||
    writeScopeCount === undefined ||
    fileCount === undefined ||
    editCount !== fileCount ||
    fileCount > writeScopeCount ||
    committedFileCount === undefined ||
    restoredFileCount === undefined ||
    committedFileCount > fileCount ||
    restoredFileCount > committedFileCount ||
    typeof input["rollbackAttempted"] !== "boolean" ||
    typeof input["rollbackVerified"] !== "boolean" ||
    typeof input["durable"] !== "boolean" ||
    typeof input["cancellationObserved"] !== "boolean" ||
    ((status === "applied" || diagnosticsPresent) &&
      (!diagnosticsStatus || !diagnosticsResultSha256)) ||
    Object.values(requiredHashes).some((candidate) => !candidate) ||
    (input["tests"] !== undefined && !tests) ||
    !candidateVerification
  ) {
    return undefined;
  }
  const observedFileSetSha256 = hash(input["observedFileSetSha256"]);
  if (input["observedFileSetSha256"] !== undefined && !observedFileSetSha256) {
    return undefined;
  }
  return {
    subagentWorktreeApplyStatus: status,
    subagentWorktreePostcondition: postcondition,
    subagentWorktreeTaskId: taskId,
    subagentWorktreeSourceFileCount: sourceFileCount,
    subagentWorktreeSourceBytes: sourceBytes,
    subagentWorktreeWriteScopeCount: writeScopeCount,
    subagentWorktreeChangedFileCount: fileCount,
    subagentWorktreeCommittedFileCount: committedFileCount,
    subagentWorktreeRestoredFileCount: restoredFileCount,
    subagentWorktreeRollbackAttempted: input["rollbackAttempted"],
    subagentWorktreeRollbackVerified: input["rollbackVerified"],
    subagentWorktreeDurable: input["durable"],
    ...(diagnosticsStatus
      ? { subagentWorktreeDiagnosticsStatus: diagnosticsStatus }
      : {}),
    subagentWorktreeOutcomeSha256: requiredHashes.outcome!,
    subagentWorktreeSourceSnapshotSha256: requiredHashes.sourceSnapshot!,
    subagentWorktreeWriteScopeSetSha256: requiredHashes.writeScopes!,
    subagentWorktreeChangedFileSetSha256: requiredHashes.changedFiles!,
    subagentWorktreeBeforeFileSetSha256: requiredHashes.beforeFiles!,
    subagentWorktreeExpectedFileSetSha256: requiredHashes.expectedFiles!,
    ...(observedFileSetSha256
      ? { subagentWorktreeObservedFileSetSha256: observedFileSetSha256 }
      : {}),
    subagentWorktreeResultSha256: requiredHashes.result!,
    ...candidateVerification,
    ...(tests ?? {}),
  };
}

export function subagentWorktreeSummaryParts(
  view: SubagentWorktreeToolEventTraceView,
): string[] {
  return [
    ...(view.subagentWorktreeApplyStatus
      ? [`worktree ${view.subagentWorktreeApplyStatus}`]
      : []),
    ...(view.subagentWorktreePostcondition
      ? [`postcondition ${view.subagentWorktreePostcondition}`]
      : []),
    ...(view.subagentWorktreeChangedFileCount !== undefined
      ? [`candidate-files ${view.subagentWorktreeChangedFileCount}`]
      : []),
    ...(view.subagentWorktreeWriteScopeCount !== undefined
      ? [`write-scopes ${view.subagentWorktreeWriteScopeCount}`]
      : []),
    ...(view.subagentWorktreeDiagnosticsStatus
      ? [`diagnostics ${view.subagentWorktreeDiagnosticsStatus}`]
      : []),
    ...(view.subagentWorktreeCandidateVerificationFreshCount !== undefined
      ? [
          `candidate-verification ${view.subagentWorktreeCandidateVerificationFreshCount} fresh / ${view.subagentWorktreeCandidateVerificationPassedCount ?? 0} passed / ${view.subagentWorktreeCandidateVerificationFailedCount ?? 0} failed / ${view.subagentWorktreeCandidateVerificationStaleCount ?? 0} stale`,
        ]
      : []),
    ...(view.subagentWorktreeCandidateVerificationSetSha256
      ? [
          `candidate-verification-set ${view.subagentWorktreeCandidateVerificationSetSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.subagentWorktreeRollbackAttempted ? ["rollback-attempted"] : []),
    ...(view.subagentWorktreeRollbackVerified ? ["rollback-verified"] : []),
    ...(view.subagentWorktreeResultSha256
      ? [`worktree-result ${view.subagentWorktreeResultSha256.slice(0, 12)}`]
      : []),
    ...(view.subagentWorktreeOutcomeSha256
      ? [`outcome ${view.subagentWorktreeOutcomeSha256.slice(0, 12)}`]
      : []),
  ];
}

function candidateVerificationEvidence(
  input: Record<string, unknown>,
): Pick<
  SubagentWorktreeToolEventTraceView,
  | "subagentWorktreeCandidateVerificationAttemptCount"
  | "subagentWorktreeCandidateVerificationFreshCount"
  | "subagentWorktreeCandidateVerificationPassedCount"
  | "subagentWorktreeCandidateVerificationFailedCount"
  | "subagentWorktreeCandidateVerificationStaleCount"
  | "subagentWorktreeCandidateVerificationSetSha256"
  | "subagentWorktreeCandidateToolchainSha256"
> | null {
  const fields = [
    input["candidateVerificationAttemptCount"],
    input["candidateVerificationFreshCount"],
    input["candidateVerificationPassedCount"],
    input["candidateVerificationFailedCount"],
    input["candidateVerificationStaleCount"],
    input["candidateVerificationSetSha256"],
  ];
  if (fields.every((value) => value === undefined)) {
    return input["candidateToolchainSha256"] === undefined ? {} : null;
  }
  const attemptCount = integer(fields[0], 0, 16);
  const freshCount = integer(fields[1], 0, 16);
  const passedCount = integer(fields[2], 0, 16);
  const failedCount = integer(fields[3], 0, 16);
  const staleCount = integer(fields[4], 0, 16);
  const setSha256 = hash(fields[5]);
  const toolchainSha256 = hash(input["candidateToolchainSha256"]);
  if (
    attemptCount === undefined ||
    freshCount === undefined ||
    passedCount === undefined ||
    failedCount === undefined ||
    staleCount === undefined ||
    !setSha256 ||
    passedCount + failedCount !== freshCount ||
    freshCount + staleCount !== attemptCount ||
    (input["candidateToolchainSha256"] !== undefined && !toolchainSha256)
  ) {
    return null;
  }
  return {
    subagentWorktreeCandidateVerificationAttemptCount: attemptCount,
    subagentWorktreeCandidateVerificationFreshCount: freshCount,
    subagentWorktreeCandidateVerificationPassedCount: passedCount,
    subagentWorktreeCandidateVerificationFailedCount: failedCount,
    subagentWorktreeCandidateVerificationStaleCount: staleCount,
    subagentWorktreeCandidateVerificationSetSha256: setSha256,
    ...(toolchainSha256
      ? { subagentWorktreeCandidateToolchainSha256: toolchainSha256 }
      : {}),
  };
}

function applyStatus(
  value: unknown,
): "applied" | "rolled_back" | "indeterminate" | undefined {
  return value === "applied" ||
    value === "rolled_back" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function postconditionStatus(
  value: unknown,
): "verified" | "drifted" | "indeterminate" | undefined {
  return value === "verified" ||
    value === "drifted" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

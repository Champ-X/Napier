import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessRollbackAttempt,
  WorkspaceProcessRollbackResult,
  WorkspaceProcessSession,
} from "@napier/contracts";
import {
  canonicalJson,
  sha256,
} from "@napier/runtime/core";
import {
  projectWorkspaceProcessRollbackAttempts,
  projectWorkspaceProcessRollbackResults,
  projectWorkspaceProcessSessions,
  workspaceProcessSessionWithRuntimeState,
} from "@napier/runtime/code";

import {
  processRecoveryLedgerFileName,
  processRecoveryResultFileName,
} from "./process-recovery-benchmark-evidence.js";
import {
  validProcessRecoveryBundleIdentity,
  validProcessRecoveryResultIdentity,
} from "./process-recovery-benchmark-shape.js";
import type {
  ProcessRecoveryBenchmarkEvaluation,
  ProcessRecoveryBenchmarkLedger,
  ProcessRecoveryBenchmarkResult,
  ProcessRecoveryEventReceipt,
} from "./process-recovery-benchmark-types.js";

const EMPTY_SHA256 = sha256("");
const EXPECTED_EVENT_TYPES = [
  "workspace.process.started",
  "workspace.process.settled",
  "workspace.process.rollback_started",
  "workspace.process.rolled_back",
];

export function verifyProcessRecoveryBenchmarkArtifacts(
  resultInput: unknown,
  bundleInput: unknown,
): {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
  bundleSha256?: string;
} {
  const diagnostics: string[] = [];
  if (!record(resultInput) || !record(bundleInput)) {
    return {
      valid: false,
      diagnostics: ["artifact_shape_invalid"],
      resultSha256: sha256(String(resultInput)),
    };
  }
  const result = resultInput as unknown as ProcessRecoveryBenchmarkResult;
  const bundle = bundleInput as unknown as ProcessRecoveryBenchmarkLedger;
  if (!validProcessRecoveryResultIdentity(result))
    diagnostics.push("result_shape_invalid");
  if (!validProcessRecoveryBundleIdentity(bundle))
    diagnostics.push("ledger_shape_invalid");
  if (
    validProcessRecoveryResultIdentity(result) &&
    sha256(canonicalJson(withoutHash(result) as unknown as JsonValue)) !==
      result.contentSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  if (
    validProcessRecoveryBundleIdentity(bundle) &&
    sha256(canonicalJson(withoutHash(bundle) as unknown as JsonValue)) !==
      bundle.contentSha256
  ) {
    diagnostics.push("ledger_hash_mismatch");
  }
  if (
    validProcessRecoveryBundleIdentity(bundle) &&
    (!validReceiptChain(bundle.eventReceipts) ||
      bundle.receiptSetSha256 !== sha256(canonicalJson(bundle.eventReceipts)))
  ) {
    diagnostics.push("ledger_receipt_chain_invalid");
  }
  if (
    validProcessRecoveryResultIdentity(result) &&
    validProcessRecoveryBundleIdentity(bundle) &&
    !bundleMatchesResult(result, bundle)
  ) {
    diagnostics.push("ledger_binding_mismatch");
  }
  const evidenceDiagnostics =
    validProcessRecoveryResultIdentity(result) &&
    validProcessRecoveryBundleIdentity(bundle)
      ? evaluationEvidenceDiagnostics(result.evaluation, bundle)
      : [];
  if (evidenceDiagnostics.length > 0) {
    diagnostics.push("evaluation_evidence_mismatch");
    diagnostics.push(...evidenceDiagnostics);
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: digest(result.contentSha256)
      ? result.contentSha256
      : sha256(String(resultInput)),
    ...(diagnostics.includes("ledger_shape_invalid")
      ? {}
      : { bundleSha256: bundle.contentSha256 }),
  };
}

export function processRecoveryArtifactReferences(input: unknown): {
  resultFileName: string;
  ledgerFileName: string;
} {
  if (!record(input)) throw new Error("Process recovery Result is invalid");
  const result = input as unknown as ProcessRecoveryBenchmarkResult;
  if (!validProcessRecoveryResultIdentity(result)) {
    throw new Error("Process recovery Result is invalid");
  }
  return {
    resultFileName: processRecoveryResultFileName(
      result.caseId,
      result.contentSha256,
    ),
    ledgerFileName: result.ledger.bundleFileName,
  };
}

function bundleMatchesResult(
  result: ProcessRecoveryBenchmarkResult,
  bundle: ProcessRecoveryBenchmarkLedger,
): boolean {
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  return (
    bundle.caseId === result.caseId &&
    bundle.caseSha256 === result.caseSha256 &&
    bundle.threadId === result.run.threadId &&
    bundle.runId === result.run.runId &&
    bundle.processId === result.run.processId &&
    bundle.contentSha256 === result.ledger.bundleSha256 &&
    result.ledger.bundleFileName ===
      processRecoveryLedgerFileName(result.caseId, bundle.contentSha256) &&
    Buffer.byteLength(serialized, "utf8") === result.ledger.bundleBytes &&
    result.status === result.evaluation.status &&
    result.executor.sandboxId === bundle.preview.sandbox &&
    result.executor.sandboxId === bundle.process.sandbox &&
    result.executor.sandboxId === result.evaluation.sandboxId &&
    canonicalJson(bundle.evaluationEvent.payload) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    receiptFor(bundle, bundle.evaluationEvent) !== undefined
  );
}

function evaluationEvidenceDiagnostics(
  evaluation: ProcessRecoveryBenchmarkEvaluation,
  bundle: ProcessRecoveryBenchmarkLedger,
): string[] {
  const diagnostics: string[] = [];
  const eventTypes = bundle.processEvents.map((event) => event.type);
  const projected = projectProcess(bundle);
  const attempts = projectWorkspaceProcessRollbackAttempts(
    bundle.processEvents,
  );
  const results = projectWorkspaceProcessRollbackResults(bundle.processEvents);
  const reopened = projected
    ? workspaceProcessSessionWithRuntimeState(projected, {
        nextCursor: projected.nextCursor,
        outputAvailable: false,
        workspaceDeltaAvailable: false,
        workspaceRollbackAvailable: false,
        workspaceCompensationStatus: "restored",
      })
    : undefined;
  if (!processProjectionMatches(projected, bundle)) {
    diagnostics.push("process_projection_mismatch");
  }
  if (!reopenProjectionMatches(reopened, bundle)) {
    diagnostics.push("reopen_projection_mismatch");
  }
  if (!rollbackEvidenceMatches(attempts, results, bundle)) {
    diagnostics.push("rollback_evidence_mismatch");
  }
  if (!previewBindingMatches(bundle)) {
    diagnostics.push("preview_binding_mismatch");
  }
  if (!targetBindingMatches(bundle)) {
    diagnostics.push("target_binding_mismatch");
  }
  if (canonicalJson(eventTypes) !== canonicalJson(EXPECTED_EVENT_TYPES)) {
    diagnostics.push("process_event_order_mismatch");
  }
  if (
    !bundle.processEvents.every(
      (event) => receiptFor(bundle, event) !== undefined,
    )
  ) {
    diagnostics.push("process_event_receipt_mismatch");
  }
  const expected = expectedEvaluationDiagnostics({
    schemaVersion: bundle.process.schemaVersion,
    processStatus: bundle.process.status,
    exitCode: bundle.process.exitCode,
    deltaStatus: bundle.process.workspaceDeltaStatus,
    scopeStatus: bundle.process.workspaceWriteScopeStatus,
    compensationStatus: bundle.process.workspaceCompensationStatus,
    rollbackAvailable: bundle.process.workspaceRollbackAvailable,
    targetRestored: bundle.target.restored,
    recoverySnapshotPresent: Boolean(bundle.process.recoverySnapshotSha256),
    eventTypes,
    recoveredAfterReopen: evaluation.recoveredAfterReopen,
    replayValid: evaluation.replayValid,
  });
  if (!evaluationProjectionMatches(evaluation, bundle, eventTypes, expected)) {
    diagnostics.push("evaluation_projection_mismatch");
  }
  if (evaluation.status !== (expected.length === 0 ? "passed" : "failed")) {
    diagnostics.push("evaluation_status_mismatch");
  }
  if (!validEvaluationHash(evaluation)) {
    diagnostics.push("evaluation_hash_mismatch");
  }
  return diagnostics;
}

function processProjectionMatches(
  projected: WorkspaceProcessSession | undefined,
  bundle: ProcessRecoveryBenchmarkLedger,
): boolean {
  return (
    projected?.id === bundle.processId &&
    projected.schemaVersion === bundle.process.schemaVersion &&
    projected.sandbox === bundle.process.sandbox &&
    projected.status === bundle.process.status &&
    (projected.exitCode ?? null) === bundle.process.exitCode &&
    projected.workspaceDeltaStatus === bundle.process.workspaceDeltaStatus &&
    projected.workspaceWriteScopeStatus ===
      bundle.process.workspaceWriteScopeStatus &&
    projected.workspaceRollbackAvailable ===
      bundle.process.workspaceRollbackAvailable
  );
}

function reopenProjectionMatches(
  reopened: WorkspaceProcessSession | undefined,
  bundle: ProcessRecoveryBenchmarkLedger,
): boolean {
  return (
    reopened?.workspaceCompensationStatus ===
      bundle.process.workspaceCompensationStatus &&
    reopened?.contentSha256 === bundle.process.contentSha256
  );
}

function rollbackEvidenceMatches(
  attempts: WorkspaceProcessRollbackAttempt[],
  results: WorkspaceProcessRollbackResult[],
  bundle: ProcessRecoveryBenchmarkLedger,
): boolean {
  const attempt = attempts[0];
  const result = results[0];
  return (
    attempts.length === 1 &&
    results.length === 1 &&
    attempt?.processId === bundle.processId &&
    attempt.initiatedBy === "automatic_compensation" &&
    attempt.previewSha256 === bundle.preview.contentSha256 &&
    attempt.recoverySnapshotSha256 === bundle.process.recoverySnapshotSha256 &&
    result?.processId === bundle.processId &&
    result.initiatedBy === "automatic_compensation" &&
    result.attemptSha256 === attempt.contentSha256 &&
    result.status === "restored" &&
    result.rollbackVerified &&
    result.durable
  );
}

function previewBindingMatches(
  bundle: ProcessRecoveryBenchmarkLedger,
): boolean {
  return (
    bundle.process.writePreviewSha256 === bundle.preview.contentSha256 &&
    bundle.process.writeScopeCount === bundle.preview.writeScopeCount &&
    bundle.process.writeScopeSetSha256 === bundle.preview.writeScopeSetSha256
  );
}

function targetBindingMatches(bundle: ProcessRecoveryBenchmarkLedger): boolean {
  return (
    bundle.target.initialSha256 === bundle.target.finalSha256 &&
    bundle.target.initialSha256 !== bundle.target.mutatedSha256 &&
    bundle.target.restored
  );
}

function evaluationProjectionMatches(
  evaluation: ProcessRecoveryBenchmarkEvaluation,
  bundle: ProcessRecoveryBenchmarkLedger,
  eventTypes: string[],
  expected: string[],
): boolean {
  return (
    evaluation.processSchemaVersion === bundle.process.schemaVersion &&
    evaluation.processStatus === bundle.process.status &&
    evaluation.processExitCode === bundle.process.exitCode &&
    evaluation.workspaceDeltaStatus === bundle.process.workspaceDeltaStatus &&
    evaluation.workspaceWriteScopeStatus ===
      bundle.process.workspaceWriteScopeStatus &&
    evaluation.workspaceCompensationStatus ===
      bundle.process.workspaceCompensationStatus &&
    evaluation.workspaceRollbackAvailable ===
      (bundle.process.workspaceRollbackAvailable === true) &&
    evaluation.targetRestored === bundle.target.restored &&
    evaluation.recoverySnapshotPresent ===
      Boolean(bundle.process.recoverySnapshotSha256) &&
    evaluation.processEventCount === bundle.processEvents.length &&
    evaluation.processEventOrderValid ===
      (canonicalJson(eventTypes) === canonicalJson(EXPECTED_EVENT_TYPES)) &&
    evaluation.diagnostics.join(",") === expected.join(",")
  );
}

function expectedEvaluationDiagnostics(input: {
  schemaVersion: number;
  processStatus: string;
  exitCode: number | null;
  deltaStatus: string | undefined;
  scopeStatus: string | undefined;
  compensationStatus: string | undefined;
  rollbackAvailable: boolean | undefined;
  targetRestored: boolean;
  recoverySnapshotPresent: boolean;
  eventTypes: string[];
  recoveredAfterReopen: boolean;
  replayValid: boolean;
}): string[] {
  const diagnostics: string[] = [];
  if (input.schemaVersion !== 7) diagnostics.push("process_schema_mismatch");
  if (input.processStatus !== "failed")
    diagnostics.push("process_status_mismatch");
  if (input.exitCode !== 17) diagnostics.push("process_exit_code_mismatch");
  if (input.deltaStatus !== "changed")
    diagnostics.push("workspace_delta_mismatch");
  if (input.scopeStatus !== "within_scope")
    diagnostics.push("write_scope_mismatch");
  if (input.compensationStatus !== "restored")
    diagnostics.push("compensation_status_mismatch");
  if (input.rollbackAvailable !== false)
    diagnostics.push("rollback_availability_mismatch");
  if (!input.targetRestored) diagnostics.push("target_not_restored");
  if (!input.recoverySnapshotPresent)
    diagnostics.push("recovery_snapshot_missing");
  if (canonicalJson(input.eventTypes) !== canonicalJson(EXPECTED_EVENT_TYPES))
    diagnostics.push("process_event_order_mismatch");
  if (!input.recoveredAfterReopen) diagnostics.push("reopen_recovery_mismatch");
  if (!input.replayValid) diagnostics.push("replay_invalid");
  return diagnostics;
}

function projectProcess(bundle: ProcessRecoveryBenchmarkLedger) {
  try {
    return projectWorkspaceProcessSessions(bundle.processEvents).find(
      (process) => process.id === bundle.processId,
    );
  } catch {
    return undefined;
  }
}

function receiptFor(
  bundle: ProcessRecoveryBenchmarkLedger,
  event: RunEvent,
): ProcessRecoveryEventReceipt | undefined {
  return bundle.eventReceipts.find(
    (receipt) =>
      receipt.id === event.id &&
      receipt.seq === event.seq &&
      receipt.runId === event.runId &&
      receipt.type === event.type &&
      receipt.category === event.category &&
      receipt.visibility === event.visibility &&
      receipt.createdAt === event.createdAt &&
      receipt.payloadSha256 === sha256(canonicalJson(event.payload)),
  );
}

function validReceiptChain(receipts: ProcessRecoveryEventReceipt[]): boolean {
  let previous = EMPTY_SHA256;
  for (const receipt of receipts) {
    const { receiptSha256, ...content } = receipt;
    if (
      receipt.previousReceiptSha256 !== previous ||
      sha256(canonicalJson(content)) !== receiptSha256
    )
      return false;
    previous = receiptSha256;
  }
  return true;
}

function validEvaluationHash(
  evaluation: ProcessRecoveryBenchmarkEvaluation,
): boolean {
  return (
    digest(evaluation.contentSha256) &&
    sha256(canonicalJson(withoutHash(evaluation) as unknown as JsonValue)) ===
      evaluation.contentSha256
  );
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

import type {
  JsonValue,
  RunEvent,
  WorkspaceProcessSession,
  WorkspaceProcessWritePreview,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  ProcessRecoveryBenchmarkLedger,
  ProcessRecoveryBenchmarkResult,
  ProcessRecoveryEventReceipt,
} from "./process-recovery-benchmark-types.js";

const EMPTY_SHA256 = sha256("");

export function createProcessRecoveryLedger(input: {
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  processId: string;
  preview: WorkspaceProcessWritePreview;
  process: WorkspaceProcessSession;
  initialSha256: string;
  mutatedSha256: string;
  finalSha256: string;
  restored: boolean;
  events: RunEvent[];
  replaySha256: string;
  evaluationEvent: RunEvent;
}): ProcessRecoveryBenchmarkLedger {
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const receipts = createEventReceipts(events);
  const content = {
    kind: "napier.process-recovery-benchmark-ledger" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    threadId: input.threadId,
    runId: input.runId,
    processId: input.processId,
    preview: {
      schemaVersion: input.preview.schemaVersion,
      sandbox: input.preview.sandbox,
      commandSha256: input.preview.commandSha256,
      executableSha256: input.preview.executableSha256,
      environmentSha256: input.preview.environmentSha256,
      resourceLimitsSha256: input.preview.resourceLimitsSha256,
      writeScopeCount: input.preview.writeScopeCount,
      writeScopeSetSha256: input.preview.writeScopeSetSha256,
      workspaceBeforeSha256: input.preview.workspaceBeforeSha256,
      workspaceBeforeFileCount: input.preview.workspaceBeforeFileCount,
      workspaceBeforeBytes: input.preview.workspaceBeforeBytes,
      failureRecovery: input.preview.failureRecovery ?? "missing",
      contentSha256: input.preview.contentSha256,
    },
    process: projectProcess(input.process),
    target: {
      initialSha256: input.initialSha256,
      mutatedSha256: input.mutatedSha256,
      finalSha256: input.finalSha256,
      restored: input.restored,
    },
    processEvents: events.filter((event) =>
      event.type.startsWith("workspace.process."),
    ),
    evaluationEvent: structuredClone(input.evaluationEvent),
    eventCount: events.length,
    sourceReplaySha256: input.replaySha256,
    eventReceipts: receipts,
    receiptSetSha256: sha256(canonicalJson(receipts)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function createProcessRecoveryResult(
  content: Omit<ProcessRecoveryBenchmarkResult, "contentSha256">,
): ProcessRecoveryBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function processRecoveryLedgerFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-process-recovery-benchmark-ledger-${caseId}-${digest.slice(0, 16)}.json`;
}

export function processRecoveryResultFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-process-recovery-benchmark-result-${caseId}-${digest.slice(0, 16)}.json`;
}

function projectProcess(
  process: WorkspaceProcessSession,
): ProcessRecoveryBenchmarkLedger["process"] {
  return {
    schemaVersion: process.schemaVersion,
    sandbox: process.sandbox,
    status: process.status,
    exitCode: process.exitCode ?? null,
    ...(process.workspaceDeltaStatus
      ? { workspaceDeltaStatus: process.workspaceDeltaStatus }
      : {}),
    ...(process.workspaceWriteScopeStatus
      ? { workspaceWriteScopeStatus: process.workspaceWriteScopeStatus }
      : {}),
    ...(process.workspaceCompensationStatus
      ? { workspaceCompensationStatus: process.workspaceCompensationStatus }
      : {}),
    ...(process.workspaceRollbackAvailable !== undefined
      ? { workspaceRollbackAvailable: process.workspaceRollbackAvailable }
      : {}),
    ...(process.writePreviewSha256
      ? { writePreviewSha256: process.writePreviewSha256 }
      : {}),
    ...(process.writeScopeCount !== undefined
      ? { writeScopeCount: process.writeScopeCount }
      : {}),
    ...(process.writeScopeSetSha256
      ? { writeScopeSetSha256: process.writeScopeSetSha256 }
      : {}),
    ...(process.recoverySnapshotSha256
      ? { recoverySnapshotSha256: process.recoverySnapshotSha256 }
      : {}),
    ...(process.recoveryScopeCount !== undefined
      ? { recoveryScopeCount: process.recoveryScopeCount }
      : {}),
    ...(process.recoveryFileCount !== undefined
      ? { recoveryFileCount: process.recoveryFileCount }
      : {}),
    ...(process.recoveryDirectoryCount !== undefined
      ? { recoveryDirectoryCount: process.recoveryDirectoryCount }
      : {}),
    ...(process.recoveryBytes !== undefined
      ? { recoveryBytes: process.recoveryBytes }
      : {}),
    contentSha256: process.contentSha256,
  };
}

function createEventReceipts(
  events: RunEvent[],
): ProcessRecoveryEventReceipt[] {
  let previousReceiptSha256 = EMPTY_SHA256;
  return events.map((event) => {
    const content = {
      id: event.id,
      seq: event.seq,
      runId: event.runId,
      type: event.type,
      category: event.category,
      visibility: event.visibility,
      createdAt: event.createdAt,
      payloadSha256: sha256(canonicalJson(event.payload)),
      previousReceiptSha256,
    };
    const receipt = {
      ...content,
      receiptSha256: sha256(canonicalJson(content)),
    };
    previousReceiptSha256 = receipt.receiptSha256;
    return receipt;
  });
}

import type {
  AgentToolName,
  ModelRef,
  RunEvent,
  RunStatus,
  Usage,
} from "@napier/contracts";

export interface CodingBenchmarkCase {
  kind: "napier.coding-benchmark-case";
  schemaVersion: 2;
  id: string;
  title: string;
  promptPath: string;
  fixturePath: string;
  targetPath: string;
  expectedTargetPath: string;
  allowedChangedPaths: string[];
  requiredTools: AgentToolName[];
  timeoutMs: number;
  promptSha256: string;
  fixtureSha256: string;
  targetBeforeSha256: string;
  expectedTargetSha256: string;
  expectedTargetAstSha256: string;
  outcomeTestPath: string;
  outcomeTestSha256: string;
  contentSha256: string;
}

export type CodingBenchmarkDiagnostic =
  | "run_not_completed"
  | "workspace_snapshot_truncated"
  | "target_mismatch"
  | "outcome_test_failed"
  | "outcome_test_unavailable"
  | "expected_change_missing"
  | "unexpected_workspace_changes";

export interface CodingBenchmarkOutcomeTestEvidence {
  testSha256: string;
  status:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unavailable"
    | "cancelled";
  sandboxId: string;
  resultSha256: string;
  durationMs: number;
  exitCode: number | null;
  stdoutSha256: string;
  stderrSha256: string;
  passed: boolean;
}

export interface CodingBenchmarkEvaluation {
  kind: "napier.coding-benchmark-evaluation";
  schemaVersion: 1 | 2;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  runStatus: RunStatus;
  criteriaSha256: string;
  workspaceBeforeSha256: string;
  workspaceAfterSha256: string;
  targetBeforeSha256: string;
  targetAfterSha256: string;
  expectedTargetSha256: string;
  targetAfterAstSha256: string;
  expectedTargetAstSha256: string;
  changedFileCount: number;
  changedPathSetSha256: string;
  targetSemanticMatch: boolean;
  allowedChangeSetMatch: boolean;
  outcomeTest?: CodingBenchmarkOutcomeTestEvidence;
  diagnostics: CodingBenchmarkDiagnostic[];
  contentSha256: string;
}

export interface CodingBenchmarkToolMetrics {
  started: number;
  completed: number;
  failed: number;
  blocked: number;
  repeatedCallCount: number;
  applyPatchCompleted: boolean;
}

export interface CodingBenchmarkLedgerEventReceipt {
  id: string;
  seq: number;
  runId: string;
  type: string;
  category: RunEvent["category"];
  visibility: RunEvent["visibility"];
  createdAt: string;
  payloadSha256: string;
  previousReceiptSha256: string;
  receiptSha256: string;
}

export interface CodingBenchmarkLedgerBundle {
  kind: "napier.coding-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  run: {
    id: string;
    agentId: string;
    agentRevision: number;
    status: RunStatus;
    model: ModelRef;
    configurationSha256: string;
    durationMs: number;
    usage: Usage;
  };
  tooling: CodingBenchmarkToolMetrics;
  evaluationEvent: RunEvent;
  eventCount: number;
  retainedEventCount: number;
  omittedEventCount: number;
  eventTypeCounts: Array<{ type: string; count: number }>;
  eventTypeSetSha256: string;
  sourceEventStreamSha256: string;
  sourceSnapshotSha256: string;
  eventReceipts: CodingBenchmarkLedgerEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface CodingBenchmarkResult {
  kind: "napier.coding-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  model: ModelRef;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cliVersion: string;
  };
  run: {
    threadId: string;
    runId: string;
    status: RunStatus;
    agentId: string;
    agentRevision: number;
    configurationSha256: string;
    durationMs: number;
    usage: Usage;
  };
  tooling: CodingBenchmarkToolMetrics;
  evaluation: CodingBenchmarkEvaluation;
  ledger: {
    eventId: string;
    eventSeq: number;
    eventSha256: string;
    eventStreamSha256: string;
    bundleFileName: string;
    bundleSha256: string;
    bundleBytes: number;
  };
  contentSha256: string;
}

export interface CodingBenchmarkArtifactVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
  bundleSha256?: string;
}

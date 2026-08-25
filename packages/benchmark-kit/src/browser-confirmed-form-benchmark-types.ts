import type {
  BrowserInteractionAction,
  BrowserInteractionConfirmation,
  BrowserInteractionEffect,
} from "@napier/contracts/browser-interaction-confirmation";
import type { ModelRef, RunEvent, RunStatus, Usage } from "@napier/contracts";

export interface BrowserConfirmedFormBenchmarkCase {
  kind: "napier.browser-confirmed-form-benchmark-case";
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  expectedAssistantText: string;
  targetUrlSha256: string;
  formValueSha256: string;
  expectedConfirmationActions: BrowserInteractionAction[];
  expectedConfirmationEffects: BrowserInteractionEffect[];
  expectedOutcomeUrlSha256: string;
  expectedOutcomeTitleSha256: string;
  timeoutMs: number;
  maxDurationMs: number;
  contentSha256: string;
}

export type BrowserConfirmedFormDiagnostic =
  | "cli_exit_nonzero"
  | "run_not_completed"
  | "assistant_output_mismatch"
  | "confirmation_prompt_count_mismatch"
  | "approval_count_mismatch"
  | "unexpected_confirmation_action"
  | "confirmation_event_order_mismatch"
  | "confirmation_action_mismatch"
  | "confirmation_effect_mismatch"
  | "browser_write_action_mismatch"
  | "browser_operation_order_invalid"
  | "browser_outcome_url_mismatch"
  | "browser_outcome_title_mismatch"
  | "browser_session_mismatch"
  | "duration_budget_exceeded"
  | "credential_reference_count_mismatch"
  | "credential_provider_mismatch"
  | "credential_locator_mismatch"
  | "credential_unavailable"
  | "credential_leaked"
  | "credential_persisted"
  | "private_value_leaked"
  | "replay_invalid";

export interface CreateBrowserConfirmedFormEvaluationInput {
  caseId: string;
  caseSha256: string;
  runStatus: RunStatus;
  cliExitCode: number;
  assistantOutputMatch: boolean;
  confirmationPromptCount: number;
  approvalInputCount: number;
  unexpectedConfirmationAction: boolean;
  expectedConfirmationActions: BrowserInteractionAction[];
  expectedConfirmationEffects: BrowserInteractionEffect[];
  expectedOutcomeUrlSha256: string;
  expectedOutcomeTitleSha256: string;
  confirmations: BrowserInteractionConfirmation[];
  browserOperations: BrowserConfirmedFormOperationEvidence[];
  firstConfirmationMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  privateValueLeakDetected: boolean;
}

export interface BrowserConfirmedFormBenchmarkExecution {
  entry: "cli_one_shot_pty";
  cliExitCode: number;
  confirmationPromptCount: number;
  approvalInputCount: number;
  unexpectedConfirmationAction: boolean;
  firstConfirmationMs: number;
  totalDurationMs: number;
  terminalOutputSha256: string;
  terminalOutputBytes: number;
}

export interface BrowserConfirmedFormOperationEvidence {
  eventId: string;
  eventSeq: number;
  eventType: "tool.blocked" | "tool.completed" | "tool.failed";
  payloadSha256: string;
  action: string;
  status: "blocked" | "completed" | "failed";
  sessionOperation?: number;
  sessionIdSha256?: string;
  currentUrlSha256?: string;
  titleSha256?: string;
}

export interface BrowserConfirmedFormBenchmarkEvaluation {
  kind: "napier.browser-confirmed-form-benchmark-evaluation";
  schemaVersion: 1;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  runStatus: RunStatus;
  cliExitCode: number;
  assistantOutputMatch: boolean;
  confirmationPromptCount: number;
  approvalInputCount: number;
  confirmationEventCount: number;
  confirmationOrderValid: boolean;
  confirmationActions: BrowserInteractionAction[];
  confirmationEffects: BrowserInteractionEffect[];
  browserActions: string[];
  browserWriteActions: string[];
  browserOperationOrderValid: boolean;
  browserOutcomeUrlMatch: boolean;
  browserOutcomeTitleMatch: boolean;
  browserSingleSession: boolean;
  firstConfirmationMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  privateValueLeakDetected: boolean;
  diagnostics: BrowserConfirmedFormDiagnostic[];
  contentSha256: string;
}

export interface BrowserConfirmedFormEventReceipt {
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

export interface BrowserConfirmedFormBenchmarkLedger {
  kind: "napier.browser-confirmed-form-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  model: ModelRef;
  expectedAssistantSha256: string;
  actualAssistantSha256?: string;
  expectedOutcomeUrlSha256: string;
  expectedOutcomeTitleSha256: string;
  expectedConfirmationActions: BrowserInteractionAction[];
  expectedConfirmationEffects: BrowserInteractionEffect[];
  maxDurationMs: number;
  credentialVariableSha256: string;
  run: BrowserConfirmedFormBenchmarkResult["run"];
  execution: BrowserConfirmedFormBenchmarkExecution;
  evidenceEvents: RunEvent[];
  confirmations: BrowserInteractionConfirmation[];
  browserOperations: BrowserConfirmedFormOperationEvidence[];
  replayValid: boolean;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  privateValueLeakDetected: boolean;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  eventCount: number;
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  eventReceipts: BrowserConfirmedFormEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface BrowserConfirmedFormBenchmarkResult {
  kind: "napier.browser-confirmed-form-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: BrowserConfirmedFormBenchmarkEvaluation["status"];
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
    durationMs: number;
    usage: Usage;
  };
  execution: BrowserConfirmedFormBenchmarkExecution;
  evaluation: BrowserConfirmedFormBenchmarkEvaluation;
  ledger: {
    bundleFileName: string;
    bundleSha256: string;
    bundleBytes: number;
  };
  contentSha256: string;
}

export interface BrowserConfirmedFormBenchmarkArtifacts {
  result: BrowserConfirmedFormBenchmarkResult;
  bundle: BrowserConfirmedFormBenchmarkLedger;
  resultPath: string;
  ledgerPath: string;
}

export interface BrowserConfirmedFormMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface BrowserConfirmedFormBenchmarkSeries {
  kind: "napier.browser-confirmed-form-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: BrowserConfirmedFormBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  completionRate: number;
  passRate: number | null;
  metrics: {
    firstConfirmationMs: BrowserConfirmedFormMetricSummary;
    totalDurationMs: BrowserConfirmedFormMetricSummary;
    costUsd: BrowserConfirmedFormMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    runId: string;
    status: BrowserConfirmedFormBenchmarkEvaluation["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface BrowserConfirmedFormBenchmarkSeriesArtifacts {
  series: BrowserConfirmedFormBenchmarkSeries;
  seriesPath: string;
  trials: BrowserConfirmedFormBenchmarkArtifacts[];
}

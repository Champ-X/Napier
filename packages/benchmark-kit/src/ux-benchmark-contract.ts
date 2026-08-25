import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import { validUxBenchmarkResultShape } from "./ux-benchmark-artifact-shape.js";
import { verifyUxBenchmarkLedgerBundle } from "./ux-benchmark-ledger.js";
import type {
  UxBenchmarkArtifactVerification,
  UxBenchmarkDiagnostic,
  UxBenchmarkEvaluation,
  UxBenchmarkLedgerBundle,
  UxBenchmarkResult,
} from "./ux-benchmark-types.js";

const CRITERIA = [
  "cli_exit_zero",
  "run_completed",
  "exact_output",
  "one_manual_command",
  "first_event_budget",
  "total_duration_budget",
  "one_available_provider_locator",
  "clean_state_thread_count",
  "portable_replay",
  "credential_absent_from_output",
  "credential_absent_from_state",
] as const;

export interface CreateUxBenchmarkEvaluationInput {
  caseId: string;
  caseSha256: string;
  runStatus: UxBenchmarkResult["run"]["status"];
  cliExitCode: number;
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  manualCommandCount: number;
  firstEventMs: number;
  maxFirstEventMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  threadCountAfter: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
}

export function createUxBenchmarkEvaluation(
  input: CreateUxBenchmarkEvaluationInput,
): UxBenchmarkEvaluation {
  const outputMatch =
    input.actualOutputSha256 !== undefined &&
    input.actualOutputSha256 === input.expectedOutputSha256;
  const diagnostics = uxBenchmarkDiagnostics(input, outputMatch);
  const status =
    input.runStatus === "cancelled" || input.runStatus === "interrupted"
      ? ("inconclusive" as const)
      : diagnostics.length === 0
        ? ("passed" as const)
        : ("failed" as const);
  const content = {
    kind: "napier.ux-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    status,
    runStatus: input.runStatus,
    criteriaSha256: sha256(canonicalJson(CRITERIA)),
    cliExitCode: input.cliExitCode,
    expectedOutputSha256: input.expectedOutputSha256,
    ...(input.actualOutputSha256
      ? { actualOutputSha256: input.actualOutputSha256 }
      : {}),
    outputMatch,
    manualCommandCount: input.manualCommandCount,
    firstEventMs: input.firstEventMs,
    maxFirstEventMs: input.maxFirstEventMs,
    totalDurationMs: input.totalDurationMs,
    maxDurationMs: input.maxDurationMs,
    credentialReferenceCount: input.credentialReferenceCount,
    credentialProviderMatch: input.credentialProviderMatch,
    credentialLocatorMatch: input.credentialLocatorMatch,
    credentialAvailable: input.credentialAvailable,
    threadCountAfter: input.threadCountAfter,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    credentialPersistenceLeakDetected: input.credentialPersistenceLeakDetected,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

function uxBenchmarkDiagnostics(
  input: CreateUxBenchmarkEvaluationInput,
  outputMatch: boolean,
): UxBenchmarkDiagnostic[] {
  const diagnostics: UxBenchmarkDiagnostic[] = [];
  if (input.cliExitCode !== 0) diagnostics.push("cli_exit_nonzero");
  if (input.runStatus !== "completed") diagnostics.push("run_not_completed");
  if (!outputMatch) diagnostics.push("output_mismatch");
  if (input.manualCommandCount !== 1) {
    diagnostics.push("manual_command_count_mismatch");
  }
  if (input.firstEventMs > input.maxFirstEventMs) {
    diagnostics.push("first_event_budget_exceeded");
  }
  if (input.totalDurationMs > input.maxDurationMs) {
    diagnostics.push("duration_budget_exceeded");
  }
  if (input.credentialReferenceCount !== 1) {
    diagnostics.push("credential_reference_count_mismatch");
  }
  if (!input.credentialProviderMatch) {
    diagnostics.push("credential_provider_mismatch");
  }
  if (!input.credentialLocatorMatch) {
    diagnostics.push("credential_locator_mismatch");
  }
  if (!input.credentialAvailable) diagnostics.push("credential_unavailable");
  if (input.threadCountAfter !== 2) diagnostics.push("thread_count_mismatch");
  if (!input.replayValid) diagnostics.push("replay_invalid");
  if (input.credentialLeakDetected) diagnostics.push("credential_leaked");
  if (input.credentialPersistenceLeakDetected) {
    diagnostics.push("credential_persisted");
  }
  return diagnostics;
}

export function createUxBenchmarkResult(
  content: Omit<UxBenchmarkResult, "contentSha256">,
): UxBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyUxBenchmarkArtifacts(
  resultInput: unknown,
  bundleInput: unknown,
): UxBenchmarkArtifactVerification {
  if (!validUxBenchmarkResultShape(resultInput)) {
    return {
      valid: false,
      diagnostics: ["result_shape_invalid"],
      resultSha256: sha256(String(resultInput)),
    };
  }
  const result = resultInput;
  const diagnostics: string[] = [];
  const { contentSha256, ...content } = result;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  const ledger = verifyUxBenchmarkLedgerBundle(bundleInput);
  if (!ledger.valid) {
    diagnostics.push(
      "ledger_invalid",
      ...ledger.diagnostics.map((diagnostic) => `ledger:${diagnostic}`),
    );
  }
  const bundle = bundleInput as UxBenchmarkLedgerBundle;
  if (ledger.valid && !bundleMatchesResult(result, bundle)) {
    diagnostics.push("ledger_binding_mismatch");
  }
  if (ledger.valid) {
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
    if (
      result.ledger.bundleBytes !== Buffer.byteLength(serialized, "utf8") ||
      result.ledger.bundleFileName !==
        uxBenchmarkLedgerFileName(result.caseId, bundle.contentSha256)
    ) {
      diagnostics.push("ledger_file_binding_mismatch");
    }
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: result.contentSha256,
    ...(ledger.valid ? { bundleSha256: bundle.contentSha256 } : {}),
  };
}

function bundleMatchesResult(
  result: UxBenchmarkResult,
  bundle: UxBenchmarkLedgerBundle,
): boolean {
  const expectedEvaluation = createUxBenchmarkEvaluation({
    caseId: bundle.caseId,
    caseSha256: bundle.caseSha256,
    runStatus: bundle.run.status,
    cliExitCode: bundle.cliExitCode,
    expectedOutputSha256: bundle.expectedOutputSha256,
    ...(bundle.actualOutputSha256
      ? { actualOutputSha256: bundle.actualOutputSha256 }
      : {}),
    manualCommandCount: bundle.manualCommandCount,
    firstEventMs: bundle.firstEventMs,
    maxFirstEventMs: bundle.maxFirstEventMs,
    totalDurationMs: bundle.totalDurationMs,
    maxDurationMs: bundle.maxDurationMs,
    credentialReferenceCount: bundle.credentialReferenceCount,
    credentialProviderMatch: bundle.credentialProviderMatch,
    credentialLocatorMatch: bundle.credentialLocatorMatch,
    credentialAvailable: bundle.credentialAvailable,
    threadCountAfter: bundle.threadCountAfter,
    replayValid: bundle.replayValid,
    credentialLeakDetected: bundle.credentialLeakDetected,
    credentialPersistenceLeakDetected: bundle.credentialPersistenceLeakDetected,
  });
  return (
    bundle.generatedAt === result.generatedAt &&
    bundle.caseId === result.caseId &&
    bundle.caseSha256 === result.caseSha256 &&
    bundle.threadId === result.run.threadId &&
    result.status === result.evaluation.status &&
    canonicalJson(bundle.model as unknown as JsonValue) ===
      canonicalJson(result.model as unknown as JsonValue) &&
    canonicalJson(bundle.environment as unknown as JsonValue) ===
      canonicalJson(result.environment as unknown as JsonValue) &&
    canonicalJson(bundle.run as unknown as JsonValue) ===
      canonicalJson(result.run as unknown as JsonValue) &&
    canonicalJson(bundle.evaluationEvent.payload) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    canonicalJson(expectedEvaluation as unknown as JsonValue) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    bundle.evaluationEvent.threadId === result.run.threadId &&
    bundle.evaluationEvent.runId === result.run.runId &&
    bundle.terminalEvent.threadId === result.run.threadId &&
    bundle.terminalEvent.runId === result.run.runId &&
    result.ledger.eventId === bundle.evaluationEvent.id &&
    result.ledger.eventSeq === bundle.evaluationEvent.seq &&
    result.ledger.eventSha256 ===
      sha256(JSON.stringify(bundle.evaluationEvent)) &&
    result.ledger.eventStreamSha256 === bundle.sourceEventStreamSha256 &&
    result.ledger.bundleSha256 === bundle.contentSha256
  );
}

export function uxBenchmarkResultFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-ux-benchmark-result-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

export function uxBenchmarkLedgerFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-ux-benchmark-ledger-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

export function uxBenchmarkSeriesFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-ux-benchmark-series-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

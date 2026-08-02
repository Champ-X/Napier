import type {
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunEvent,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import {
  validWorkflowBenchmarkEvaluationShape,
  validWorkflowBenchmarkResultShape,
} from "./workflow-benchmark-artifact-shape.js";
import { verifyWorkflowBenchmarkLedgerBundle } from "./workflow-benchmark-ledger.js";
import type {
  WorkflowBenchmarkArtifactVerification,
  WorkflowBenchmarkCase,
  WorkflowBenchmarkDiagnostic,
  WorkflowBenchmarkEvaluation,
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";

const CRITERIA = [
  "workflow_completed",
  "exact_output",
  "ordered_map_output",
  "typed_node_completion",
  "isolated_map_runs",
  "map_and_reduce_events",
  "model_free_reduce",
  "portable_replay",
  "credential_absent",
] as const;

export function createWorkflowBenchmarkEvaluation(input: {
  benchmarkCase: Pick<WorkflowBenchmarkCase, "id" | "contentSha256">;
  workflowStatus: ExecutionPlanWorkflowResult["status"];
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  expectedMapOutputSha256: string;
  actualMapOutputSha256?: string;
  expectedNodeResultCount: number;
  completedNodeResultCount: number;
  expectedMapItemCount: number;
  completedMapRunCount: number;
  mapCompletedEventCount: number;
  reduceCompletedEventCount: number;
  reduceModelOrToolEventCount: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
}): WorkflowBenchmarkEvaluation {
  const diagnostics: WorkflowBenchmarkDiagnostic[] = [];
  if (input.workflowStatus !== "completed") {
    diagnostics.push("workflow_not_completed");
  }
  const outputMatch = input.actualOutputSha256 === input.expectedOutputSha256;
  if (!outputMatch) diagnostics.push("output_mismatch");
  const mapOutputMatch =
    input.actualMapOutputSha256 === input.expectedMapOutputSha256;
  if (!mapOutputMatch) diagnostics.push("map_output_mismatch");
  if (input.completedNodeResultCount !== input.expectedNodeResultCount) {
    diagnostics.push("node_result_mismatch");
  }
  if (input.completedMapRunCount !== input.expectedMapItemCount) {
    diagnostics.push("map_run_mismatch");
  }
  if (input.mapCompletedEventCount !== input.expectedMapItemCount) {
    diagnostics.push("map_event_mismatch");
  }
  if (input.reduceCompletedEventCount !== 1) {
    diagnostics.push("reduce_event_mismatch");
  }
  if (input.reduceModelOrToolEventCount !== 0) {
    diagnostics.push("reduce_executed_model_or_tool");
  }
  if (!input.replayValid) diagnostics.push("replay_invalid");
  if (input.credentialLeakDetected) diagnostics.push("credential_leaked");
  const status =
    input.workflowStatus === "cancelled"
      ? ("inconclusive" as const)
      : diagnostics.length === 0
        ? ("passed" as const)
        : ("failed" as const);
  const content = {
    kind: "napier.workflow-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    status,
    workflowStatus: input.workflowStatus,
    criteriaSha256: sha256(canonicalJson(CRITERIA)),
    expectedOutputSha256: input.expectedOutputSha256,
    ...(input.actualOutputSha256
      ? { actualOutputSha256: input.actualOutputSha256 }
      : {}),
    expectedMapOutputSha256: input.expectedMapOutputSha256,
    ...(input.actualMapOutputSha256
      ? { actualMapOutputSha256: input.actualMapOutputSha256 }
      : {}),
    outputMatch,
    mapOutputMatch,
    expectedNodeResultCount: input.expectedNodeResultCount,
    completedNodeResultCount: input.completedNodeResultCount,
    expectedMapItemCount: input.expectedMapItemCount,
    completedMapRunCount: input.completedMapRunCount,
    mapCompletedEventCount: input.mapCompletedEventCount,
    reduceCompletedEventCount: input.reduceCompletedEventCount,
    reduceModelOrToolEventCount: input.reduceModelOrToolEventCount,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createWorkflowBenchmarkResult(
  content: Omit<WorkflowBenchmarkResult, "contentSha256">,
): WorkflowBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyWorkflowBenchmarkArtifacts(
  resultInput: unknown,
  bundleInput: unknown,
): WorkflowBenchmarkArtifactVerification {
  const diagnostics: string[] = [];
  if (!validWorkflowBenchmarkResultShape(resultInput)) {
    return {
      valid: false,
      diagnostics: ["result_shape_invalid"],
      resultSha256: sha256(String(resultInput)),
    };
  }
  const result = resultInput;
  const { contentSha256, ...content } = result;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  if (!validWorkflowBenchmarkEvaluationShape(result.evaluation)) {
    diagnostics.push("evaluation_invalid");
  }
  const bundleVerification = verifyWorkflowBenchmarkLedgerBundle(bundleInput);
  if (!bundleVerification.valid) {
    diagnostics.push("ledger_invalid");
  }
  const bundle = bundleInput as WorkflowBenchmarkLedgerBundle;
  if (bundleVerification.valid && !benchmarkBundleMatches(result, bundle)) {
    diagnostics.push("ledger_binding_mismatch");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: result.contentSha256,
    ...(bundleVerification.valid ? { bundleSha256: bundle.contentSha256 } : {}),
  };
}

function benchmarkBundleMatches(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  return (
    benchmarkIdentityMatches(result, bundle) &&
    benchmarkEventsMatch(result, bundle) &&
    benchmarkOutcomeMatches(result, bundle)
  );
}

function benchmarkIdentityMatches(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  return (
    bundle.threadId === result.run.threadId &&
    bundle.caseId === result.caseId &&
    bundle.caseSha256 === result.caseSha256 &&
    bundle.contentSha256 === result.ledger.bundleSha256 &&
    result.ledger.bundleFileName ===
      workflowBenchmarkLedgerFileName(result.caseId, bundle.contentSha256) &&
    Buffer.byteLength(serialized, "utf8") === result.ledger.bundleBytes &&
    bundle.sourceEventStreamSha256 === result.ledger.eventStreamSha256 &&
    bundle.workflow.planId === result.run.planId &&
    bundle.workflow.status === result.run.status
  );
}

function benchmarkEventsMatch(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const evaluationEvent = bundle.evaluationEvent;
  const terminalEvent = bundle.terminalEvent;
  const evaluationReceipt = bundle.eventReceipts.find(
    (receipt) => receipt.id === evaluationEvent.id,
  );
  const terminalReceipt = bundle.eventReceipts.find(
    (receipt) => receipt.id === terminalEvent.id,
  );
  return (
    evaluationEvent.id === result.ledger.eventId &&
    evaluationEvent.seq === result.ledger.eventSeq &&
    sha256(JSON.stringify(evaluationEvent)) === result.ledger.eventSha256 &&
    canonicalJson(evaluationEvent.payload) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    evaluationReceipt?.payloadSha256 ===
      sha256(canonicalJson(evaluationEvent.payload)) &&
    terminalReceipt?.payloadSha256 ===
      sha256(canonicalJson(terminalEvent.payload)) &&
    field(terminalEvent, "status") === result.run.status &&
    field(terminalEvent, "manifestSha256") === result.workflow.manifestSha256 &&
    field(terminalEvent, "blueprintSha256") ===
      result.workflow.blueprintSha256 &&
    field(terminalEvent, "resultSha256") === result.workflow.resultSha256 &&
    field(terminalEvent, "outputSha256") === result.workflow.outputSha256
  );
}

function benchmarkOutcomeMatches(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const mapRuns = bundle.runs.filter(
    (run) =>
      run.executionMode === "workflow_map_read_only" &&
      run.status === "completed",
  );
  const mapRunIds = mapRuns.map((run) => run.id).sort();
  const reduceModelOrToolEventCount = bundle.eventReceipts.filter(
    (receipt) =>
      receipt.runId === bundle.workflow.reduceRunId &&
      (receipt.type === "model.response" || receipt.type.startsWith("tool.")),
  ).length;
  const expectedEvaluation = createWorkflowBenchmarkEvaluation({
    benchmarkCase: {
      id: result.caseId,
      contentSha256: result.caseSha256,
    },
    workflowStatus: bundle.workflow.status,
    expectedOutputSha256: result.evaluation.expectedOutputSha256,
    ...(bundle.workflow.outputSha256
      ? { actualOutputSha256: bundle.workflow.outputSha256 }
      : {}),
    expectedMapOutputSha256: result.evaluation.expectedMapOutputSha256,
    ...(bundle.workflow.mapOutputSha256
      ? { actualMapOutputSha256: bundle.workflow.mapOutputSha256 }
      : {}),
    expectedNodeResultCount: result.evaluation.expectedNodeResultCount,
    completedNodeResultCount: bundle.workflow.completedNodeResultCount,
    expectedMapItemCount: result.evaluation.expectedMapItemCount,
    completedMapRunCount: mapRuns.length,
    mapCompletedEventCount: eventTypeCount(
      bundle,
      "workflow.map.item.completed",
    ),
    reduceCompletedEventCount: eventTypeCount(
      bundle,
      "workflow.reduce.completed",
    ),
    reduceModelOrToolEventCount,
    replayValid: result.evaluation.replayValid,
    credentialLeakDetected: result.evaluation.credentialLeakDetected,
  });
  return (
    canonicalJson(expectedEvaluation as unknown as JsonValue) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    canonicalJson(mapRunIds as unknown as JsonValue) ===
      canonicalJson(bundle.workflow.mapRunIds as unknown as JsonValue) &&
    bundle.runs.length === result.run.runCount &&
    bundle.runs.filter((run) => run.status === "completed").length ===
      result.run.completedRunCount &&
    usageMatches(aggregateUsage(bundle), result.run.usage) &&
    workflowEvidenceMatches(result, bundle)
  );
}

function workflowEvidenceMatches(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  return (
    bundle.workflow.manifestSha256 === result.workflow.manifestSha256 &&
    bundle.workflow.blueprintSha256 === result.workflow.blueprintSha256 &&
    bundle.workflow.resultSha256 === result.workflow.resultSha256 &&
    bundle.workflow.outputSha256 === result.workflow.outputSha256 &&
    bundle.workflow.nodeResultCount === result.workflow.nodeResultCount &&
    bundle.workflow.completedNodeResultCount ===
      result.workflow.completedNodeResultCount
  );
}

function aggregateUsage(bundle: WorkflowBenchmarkLedgerBundle) {
  return bundle.runs.reduce(
    (total, run) => ({
      inputTokens: total.inputTokens + run.usage.inputTokens,
      outputTokens: total.outputTokens + run.usage.outputTokens,
      cacheReadTokens: total.cacheReadTokens + run.usage.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + run.usage.cacheWriteTokens,
      costUsd: total.costUsd + run.usage.costUsd,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  );
}

function usageMatches(
  observed: ReturnType<typeof aggregateUsage>,
  expected: WorkflowBenchmarkResult["run"]["usage"],
): boolean {
  return (
    observed.inputTokens === expected.inputTokens &&
    observed.outputTokens === expected.outputTokens &&
    observed.cacheReadTokens === expected.cacheReadTokens &&
    observed.cacheWriteTokens === expected.cacheWriteTokens &&
    Math.abs(observed.costUsd - expected.costUsd) <= 1e-12
  );
}

function eventTypeCount(
  bundle: WorkflowBenchmarkLedgerBundle,
  type: string,
): number {
  return (
    bundle.eventTypeCounts.find((entry) => entry.type === type)?.count ?? 0
  );
}

export function workflowBenchmarkResultFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-workflow-benchmark-result-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

export function workflowBenchmarkLedgerFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-workflow-benchmark-ledger-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function field(event: RunEvent, key: string): unknown {
  return event.payload &&
    !Array.isArray(event.payload) &&
    typeof event.payload === "object"
    ? event.payload[key]
    : undefined;
}

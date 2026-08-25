import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import {
  goalNoProgressLedgerFileName,
  goalNoProgressResultFileName,
  recordValue,
} from "./goal-no-progress-benchmark-evidence.js";
import type {
  GoalNoProgressBenchmarkEvaluation,
  GoalNoProgressBenchmarkLedger,
  GoalNoProgressBenchmarkResult,
  GoalNoProgressEventReceipt,
} from "./goal-no-progress-benchmark-types.js";

const EMPTY_SHA256 = sha256("");

export function verifyGoalNoProgressBenchmarkArtifacts(
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
  const result = resultInput as unknown as GoalNoProgressBenchmarkResult;
  const bundle = bundleInput as unknown as GoalNoProgressBenchmarkLedger;
  if (!validResultIdentity(result)) diagnostics.push("result_shape_invalid");
  if (!validBundleIdentity(bundle)) diagnostics.push("ledger_shape_invalid");
  if (
    validResultIdentity(result) &&
    sha256(canonicalJson(withoutHash(result) as unknown as JsonValue)) !==
      result.contentSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  if (
    validBundleIdentity(bundle) &&
    sha256(canonicalJson(withoutHash(bundle) as unknown as JsonValue)) !==
      bundle.contentSha256
  ) {
    diagnostics.push("ledger_hash_mismatch");
  }
  if (
    validBundleIdentity(bundle) &&
    (!validReceiptChain(bundle.eventReceipts) ||
      bundle.receiptSetSha256 !== sha256(canonicalJson(bundle.eventReceipts)))
  ) {
    diagnostics.push("ledger_receipt_chain_invalid");
  }
  if (
    validResultIdentity(result) &&
    validBundleIdentity(bundle) &&
    !bundleMatchesResult(result, bundle)
  ) {
    diagnostics.push("ledger_binding_mismatch");
  }
  if (
    validResultIdentity(result) &&
    validBundleIdentity(bundle) &&
    !evaluationMatchesEvidence(result.evaluation, bundle)
  ) {
    diagnostics.push("evaluation_evidence_mismatch");
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

export function goalNoProgressArtifactReferences(input: unknown): {
  resultFileName: string;
  ledgerFileName: string;
} {
  if (!record(input)) throw new Error("Goal benchmark Result is invalid");
  const result = input as unknown as GoalNoProgressBenchmarkResult;
  if (!validResultIdentity(result)) {
    throw new Error("Goal benchmark Result is invalid");
  }
  return {
    resultFileName: goalNoProgressResultFileName(
      result.caseId,
      result.contentSha256,
    ),
    ledgerFileName: result.ledger.bundleFileName,
  };
}

function bundleMatchesResult(
  result: GoalNoProgressBenchmarkResult,
  bundle: GoalNoProgressBenchmarkLedger,
): boolean {
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  const evaluationReceipt = receiptFor(bundle, bundle.evaluationEvent);
  return (
    bundle.caseId === result.caseId &&
    bundle.caseSha256 === result.caseSha256 &&
    bundle.threadId === result.run.threadId &&
    bundle.runId === result.run.runId &&
    bundle.contentSha256 === result.ledger.bundleSha256 &&
    result.ledger.bundleFileName ===
      goalNoProgressLedgerFileName(result.caseId, bundle.contentSha256) &&
    Buffer.byteLength(serialized, "utf8") === result.ledger.bundleBytes &&
    canonicalJson(bundle.evaluationEvent.payload) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    evaluationReceipt !== undefined &&
    bundle.terminalEvent.runId === result.run.runId &&
    terminalStatus(bundle.terminalEvent.type) === result.run.status &&
    result.status === result.evaluation.status
  );
}

function evaluationMatchesEvidence(
  evaluation: GoalNoProgressBenchmarkEvaluation,
  bundle: GoalNoProgressBenchmarkLedger,
): boolean {
  const goalEvaluations = bundle.goalEvents.filter(
    (event) => event.type === "goal.evaluated",
  );
  const continuations = bundle.goalEvents.filter(
    (event) => event.type === "goal.continuation.started",
  );
  const assistantTexts = bundle.assistantEvents.map((event) =>
    String(recordValue(event.payload)["text"] ?? ""),
  );
  const repeatedResponseCount = assistantTexts.filter(
    (text) => text === assistantTexts[0] && text.length > 0,
  ).length;
  const finalEvaluationSeq = goalEvaluations.at(-1)?.seq ?? 0;
  const observation = recordValue(bundle.modelResponseObservationEvent.payload);
  const evidenceMatches =
    bundle.goal.status === evaluation.goalStatus &&
    bundle.goal.blocker === evaluation.goalBlocker &&
    bundle.goal.continuationCount === evaluation.continuationCount &&
    bundle.goal.noProgressCount === evaluation.noProgressCount &&
    bundle.goal.maxNoProgressContinuations ===
      evaluation.maxNoProgressContinuations &&
    goalEvaluations.length === evaluation.goalEvaluationCount &&
    continuations.length === evaluation.continuationStartedCount &&
    bundle.assistantEvents.length === evaluation.primaryResponseCount &&
    repeatedResponseCount === evaluation.repeatedResponseCount &&
    Number(observation["modelResponseCount"]) ===
      evaluation.modelResponseCount &&
    Number(observation["modelResponseErrorCount"]) ===
      evaluation.modelResponseErrorCount &&
    Number(observation["modelResponseUsageSampleCount"]) ===
      evaluation.modelResponseUsageSampleCount &&
    continuations.filter((event) => event.seq > finalEvaluationSeq).length ===
      evaluation.postBlockContinuationCount &&
    evaluation.goalRecovered ===
      (bundle.goal.lastEvaluatedRunId === bundle.runId &&
        bundle.goal.lastEvidenceHash === sha256(assistantTexts[0] ?? ""));
  return (
    evidenceMatches &&
    validSelectedEventBindings(bundle) &&
    validObservationBinding(bundle) &&
    validEvaluationHash(evaluation) &&
    expectedDiagnostics(evaluation).join(",") ===
      evaluation.diagnostics.join(",")
  );
}

function expectedDiagnostics(
  evaluation: GoalNoProgressBenchmarkEvaluation,
): string[] {
  const diagnostics: string[] = [];
  if (evaluation.runStatus !== "completed")
    diagnostics.push("run_not_completed");
  if (evaluation.goalStatus !== "blocked") diagnostics.push("goal_not_blocked");
  if (evaluation.goalBlocker !== "goal_not_met_yet")
    diagnostics.push("goal_blocker_mismatch");
  if (evaluation.continuationCount !== 2)
    diagnostics.push("continuation_count_mismatch");
  if (evaluation.noProgressCount !== 2)
    diagnostics.push("no_progress_count_mismatch");
  if (evaluation.goalEvaluationCount !== 3)
    diagnostics.push("evaluation_count_mismatch");
  if (evaluation.continuationStartedCount !== 2)
    diagnostics.push("continuation_event_mismatch");
  if (
    evaluation.primaryResponseCount !== 3 ||
    evaluation.repeatedResponseCount !== 3
  )
    diagnostics.push("repeated_response_mismatch");
  if (evaluation.postBlockContinuationCount !== 0)
    diagnostics.push("post_block_continuation");
  if (!evaluation.replayValid) diagnostics.push("replay_invalid");
  if (evaluation.credentialLeakDetected) diagnostics.push("credential_leaked");
  return diagnostics;
}

function validSelectedEventBindings(
  bundle: GoalNoProgressBenchmarkLedger,
): boolean {
  return [
    ...bundle.goalEvents,
    ...bundle.assistantEvents,
    bundle.modelResponseObservationEvent,
    bundle.evaluationEvent,
    bundle.terminalEvent,
  ].every((event) => receiptFor(bundle, event) !== undefined);
}

function validObservationBinding(
  bundle: GoalNoProgressBenchmarkLedger,
): boolean {
  const event = bundle.modelResponseObservationEvent;
  const payload = recordValue(event.payload);
  return (
    event.type === "benchmark.goal.model-responses.observed" &&
    Number(payload["sourceEventCount"]) + 1 === event.seq &&
    event.seq < bundle.evaluationEvent.seq &&
    bundle.eventReceipts.filter(
      (receipt) => receipt.type === "model.response" && receipt.seq < event.seq,
    ).length === Number(payload["modelResponseCount"])
  );
}

function receiptFor(
  bundle: GoalNoProgressBenchmarkLedger,
  event: RunEvent,
): GoalNoProgressEventReceipt | undefined {
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

function validReceiptChain(receipts: GoalNoProgressEventReceipt[]): boolean {
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

function validResultIdentity(result: GoalNoProgressBenchmarkResult): boolean {
  return (
    result.kind === "napier.goal-no-progress-benchmark-result" &&
    result.schemaVersion === 1 &&
    digest(result.caseSha256) &&
    digest(result.contentSha256) &&
    digest(result.ledger.bundleSha256)
  );
}

function validBundleIdentity(bundle: GoalNoProgressBenchmarkLedger): boolean {
  return (
    bundle.kind === "napier.goal-no-progress-benchmark-ledger" &&
    bundle.schemaVersion === 1 &&
    digest(bundle.caseSha256) &&
    digest(bundle.contentSha256) &&
    digest(bundle.receiptSetSha256) &&
    Array.isArray(bundle.eventReceipts)
  );
}

function validEvaluationHash(
  evaluation: GoalNoProgressBenchmarkEvaluation,
): boolean {
  return (
    digest(evaluation.contentSha256) &&
    sha256(canonicalJson(withoutHash(evaluation) as unknown as JsonValue)) ===
      evaluation.contentSha256
  );
}

function terminalStatus(type: string): string | undefined {
  if (type === "run.completed") return "completed";
  if (type === "run.failed") return "failed";
  if (type === "run.cancelled") return "cancelled";
  return undefined;
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

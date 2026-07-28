import {
  traceSummaryBoundaryDelta,
  type RunContextCoverageDelta,
  type RunContextCoverageSummary,
  type RunEvent,
  type RunEvaluationRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createRunEvaluationGovernanceBinding } from "./evaluation.js";
import { MODEL_CONTEXT_ENVELOPE_EVENT } from "./model-context-envelope.js";

export function assertRunEvaluationGovernanceSourceBinding({
  evaluation,
  events,
  subagents,
  label,
  skipSnapshotSourceBinding = false,
}: {
  evaluation: RunEvaluationRecord;
  events: readonly RunEvent[];
  subagents: readonly unknown[];
  label: string;
  skipSnapshotSourceBinding?: boolean;
}): void {
  const governance = evaluation.comparisonGovernance;
  if (!governance) return;
  assertRunEvaluationSnapshotSourceBinding({
    evaluation,
    events,
    label,
    skip: skipSnapshotSourceBinding,
  });
  assertRunEvaluationGovernanceReceiptSourceBinding({
    evaluation,
    events,
    subagents,
    label,
  });
}

export function assertRunEvaluationGovernanceReceiptSourceBinding({
  evaluation,
  events,
  subagents,
  label,
}: {
  evaluation: RunEvaluationRecord;
  events: readonly RunEvent[];
  subagents: readonly unknown[];
  label: string;
}): void {
  const governance = evaluation.comparisonGovernance;
  if (!governance) return;
  const leftEvents = events.filter(
    (event) => event.runId === evaluation.leftRunId,
  );
  const rightEvents = events.filter(
    (event) => event.runId === evaluation.rightRunId,
  );
  const leftSubagents = subagents.filter((task) =>
    unknownSubagentBelongsToRun(task, evaluation.leftRunId),
  );
  const rightSubagents = subagents.filter((task) =>
    unknownSubagentBelongsToRun(task, evaluation.rightRunId),
  );
  const contextCoverageDelta = compareRunEvaluationContextCoverage(
    runContextCoverageSummary(leftEvents, leftSubagents),
    runContextCoverageSummary(rightEvents, rightSubagents),
  );
  const includesTraceSummaryBoundary =
    governance.traceSummaryBoundaryStatus !== undefined ||
    governance.traceSummaryBoundaryGenericDelta !== undefined ||
    governance.traceSummaryBoundaryDiagnosticsSha256 !== undefined ||
    governance.traceSummaryBoundaryDeltaSha256 !== undefined;
  const expected = createRunEvaluationGovernanceBinding(
    contextCoverageDelta,
    includesTraceSummaryBoundary
      ? traceSummaryBoundaryDelta(leftEvents, rightEvents)
      : undefined,
  );
  if (canonicalJson(governance) !== canonicalJson(expected)) {
    throw new Error(`${label} comparisonGovernance source binding mismatch`);
  }
}

export function assertRunEvaluationSnapshotSourceBinding({
  evaluation,
  events,
  label,
  skip = false,
}: {
  evaluation: RunEvaluationRecord;
  events: readonly RunEvent[];
  label: string;
  skip?: boolean;
}): void {
  if (!evaluation.comparisonGovernance || skip) return;
  const leftEvents = events.filter(
    (event) => event.runId === evaluation.leftRunId,
  );
  const rightEvents = events.filter(
    (event) => event.runId === evaluation.rightRunId,
  );
  if (
    evaluation.leftSnapshotSha256 !==
      hashRunEvaluationEventStream(leftEvents) ||
    evaluation.rightSnapshotSha256 !== hashRunEvaluationEventStream(rightEvents)
  ) {
    throw new Error(`${label} snapshot source binding mismatch`);
  }
}

function hashRunEvaluationEventStream(events: readonly RunEvent[]): string {
  return sha256(events.map((event) => JSON.stringify(event)).join("\n"));
}

export function assertRunEvaluationCompletedEventBindings({
  evaluations,
  events,
  label,
}: {
  evaluations: readonly RunEvaluationRecord[];
  events: readonly RunEvent[];
  label: string;
}): void {
  const evaluationsById = new Map(
    evaluations.map((evaluation) => [evaluation.id, evaluation] as const),
  );
  const completedEvaluationIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "evaluation.completed") continue;
    const payload = objectPayload(event.payload);
    const evaluationId = payloadString(payload, "evaluationId");
    const evaluation = evaluationId
      ? evaluationsById.get(evaluationId)
      : undefined;
    if (
      !payload ||
      !evaluation ||
      event.category !== "evaluation" ||
      event.visibility !== "user" ||
      completedEvaluationIds.has(evaluation.id)
    ) {
      throw new Error(`${label} evaluation.completed event binding mismatch`);
    }
    completedEvaluationIds.add(evaluation.id);
    if (
      canonicalJson(payload) !==
      canonicalJson(runEvaluationCompletedEventPayload(evaluation))
    ) {
      throw new Error(`${label} evaluation.completed event binding mismatch`);
    }
  }
}

function runEvaluationCompletedEventPayload(
  evaluation: RunEvaluationRecord,
): Record<string, unknown> {
  const governance = evaluation.comparisonGovernance;
  return {
    evaluationId: evaluation.id,
    leftRunId: evaluation.leftRunId,
    rightRunId: evaluation.rightRunId,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    evidence: evaluation.evidence,
    rubric: evaluation.rubric.name,
    leftSnapshotSha256: evaluation.leftSnapshotSha256,
    rightSnapshotSha256: evaluation.rightSnapshotSha256,
    ...(governance
      ? {
          comparisonGovernanceSha256: governance.contentSha256,
          contextCoverageStatus: governance.contextCoverageStatus,
          contextCoverageDiagnosticsSha256:
            governance.contextCoverageDiagnosticsSha256,
        }
      : {}),
    ...(governance?.traceSummaryBoundaryStatus &&
    governance.traceSummaryBoundaryDiagnosticsSha256
      ? {
          traceSummaryBoundaryStatus: governance.traceSummaryBoundaryStatus,
          traceSummaryBoundaryDiagnosticsSha256:
            governance.traceSummaryBoundaryDiagnosticsSha256,
        }
      : {}),
  };
}

function runContextCoverageSummary(
  events: readonly RunEvent[],
  subagents: readonly unknown[],
): RunContextCoverageSummary {
  const modelResponses = events.filter(
    (event) => event.type === "model.response",
  );
  const envelopeCount = events.filter(
    (event) => event.type === MODEL_CONTEXT_ENVELOPE_EVENT,
  ).length;
  const embeddedEnvelopeCount = countEmbeddedModelContextEnvelopes({
    events,
    subagents,
  });
  const boundResponseCount = modelResponses.filter(
    (event) =>
      Boolean(payloadString(event.payload, "modelContextEnvelopeSha256")) &&
      typeof payloadNumber(event.payload, "modelContextEnvelopeTurnIndex") ===
        "number" &&
      Boolean(payloadString(event.payload, "modelContextMessageSetSha256")) &&
      Boolean(
        payloadString(event.payload, "modelContextToolDefinitionSetSha256"),
      ),
  ).length;
  return {
    modelResponseCount: modelResponses.length,
    envelopeCount,
    embeddedEnvelopeCount,
    boundResponseCount,
    unboundResponseCount: modelResponses.length - boundResponseCount,
    coverageRate:
      modelResponses.length === 0
        ? 1
        : boundResponseCount / modelResponses.length,
  };
}

function compareRunEvaluationContextCoverage(
  left: RunContextCoverageSummary,
  right: RunContextCoverageSummary,
): RunContextCoverageDelta {
  const coverageRateDelta = right.coverageRate - left.coverageRate;
  const diagnostics: string[] = [];
  const missing =
    right.modelResponseCount > 0 &&
    right.envelopeCount === 0 &&
    right.boundResponseCount === 0;
  const regressed =
    coverageRateDelta < 0 ||
    right.unboundResponseCount > left.unboundResponseCount;
  const partial =
    right.unboundResponseCount > 0 ||
    right.coverageRate < 1 ||
    right.envelopeCount > right.boundResponseCount;
  if (missing) diagnostics.push("candidate_context_envelopes_missing");
  if (right.unboundResponseCount > 0) {
    diagnostics.push("candidate_context_responses_unbound");
  }
  if (right.envelopeCount > right.boundResponseCount) {
    diagnostics.push("candidate_context_envelopes_unmatched");
  }
  if (regressed) diagnostics.push("candidate_context_coverage_regressed");
  return {
    status: missing
      ? "missing"
      : regressed
        ? "regressed"
        : partial
          ? "partial"
          : "clean",
    left,
    right,
    coverageRateDelta,
    embeddedEnvelopeDelta:
      right.embeddedEnvelopeCount - left.embeddedEnvelopeCount,
    diagnostics,
  };
}

function countEmbeddedModelContextEnvelopes(value: unknown): number {
  let count = 0;
  walkEmbeddedModelContextEnvelopes(value, () => {
    count += 1;
  });
  return count;
}

function walkEmbeddedModelContextEnvelopes(
  value: unknown,
  visit: (envelope: unknown) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkEmbeddedModelContextEnvelopes(item, visit));
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "modelContextEnvelope")) {
    visit(record["modelContextEnvelope"]);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "modelContextEnvelope") continue;
    walkEmbeddedModelContextEnvelopes(child, visit);
  }
}

function unknownSubagentBelongsToRun(value: unknown, runId: string): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { runId?: unknown }).runId === runId,
  );
}

function payloadString(payload: unknown, key: string): string | undefined {
  const record = objectPayload(payload);
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(payload: unknown, key: string): number | undefined {
  const record = objectPayload(payload);
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function objectPayload(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

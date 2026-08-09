import type { JsonValue } from "@napier/contracts";

import {
  PROMPT_EVIDENCE_OTEL_KEYS,
  promptEvidenceOtelAttributes,
} from "./prompt-evidence-otel.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const EXCLUDED_PAYLOAD_KEYS = [
  "args",
  "content",
  "description",
  "details",
  "error",
  "evidence",
  "input",
  "message",
  "note",
  "objective",
  "output",
  "prompt",
  "reason",
  "reasoning",
  "result",
  "summary",
  "systemPrompt",
  "text",
  "toolCalls",
] as const;

const SAFE_STRING_PAYLOAD_KEYS = new Set([
  "action",
  "actualVerdict",
  "algorithm",
  "availability",
  "consensusVerdict",
  "contextCoverageStatus",
  "effect",
  "evidenceState",
  "expectedVerdict",
  "kind",
  "model",
  "modelVerdict",
  "operation",
  "phase",
  "providerId",
  "risk",
  "reviewStatus",
  "role",
  "source",
  "sourceApiVersion",
  "sourceType",
  "status",
  "stopReason",
  "toolName",
  "traceSummaryBoundaryStatus",
  "verdict",
  "importedAt",
]);

const SAFE_MODEL_PAYLOAD_KEYS = new Set(["candidateModel", "reviewerModel"]);

const SAFE_ID_PAYLOAD_KEYS = new Set([
  "adjudicationId",
  "agentId",
  "artifactId",
  "ballotId",
  "baselineId",
  "callId",
  "caseId",
  "casebookId",
  "channelId",
  "checkpointId",
  "credentialId",
  "decisionId",
  "deliveryId",
  "evaluationId",
  "executionId",
  "extensionId",
  "milestoneId",
  "parentCheckpointId",
  "parentRunId",
  "predecessorMilestoneId",
  "continuationRunId",
  "planId",
  "referenceId",
  "resolutionId",
  "runId",
  "scheduleId",
  "sourceEvaluationId",
  "sourceRunId",
  "sourceThreadId",
  "stepId",
  "suiteId",
  "taskId",
  "threadId",
  "triggerId",
  "trustAnchorId",
]);

const SAFE_NUMBER_PAYLOAD_KEYS = new Set([
  "actualCostUsd",
  "activePhaseIndex",
  "agreementCount",
  "agreementRate",
  "attempt",
  "attemptCount",
  "assistantMessageCount",
  "averageCandidateScore",
  "branchFromSeq",
  "cacheReadTokens",
  "cacheWriteTokens",
  "caseCount",
  "candidateTextBytes",
  "conclusiveCount",
  "continuation",
  "costUsd",
  "currentRevision",
  "definitionCount",
  "durationMs",
  "editCount",
  "eventCount",
  "exemptToolCount",
  "exitCode",
  "failedCount",
  "fromSeq",
  "inconclusiveCount",
  "inputTokens",
  "maxAttempts",
  "maxContinuations",
  "messageIndex",
  "messageCount",
  "milestoneCount",
  "milestoneOmittedCount",
  "milestoneSelectedCount",
  "modelContextEnvelopeTurnIndex",
  "minimumAgreementRate",
  "minimumPassRate",
  "observed",
  "outputTokens",
  "otherMessageCount",
  "passedCount",
  "passRate",
  "phaseWaveCount",
  "retainedFromSeq",
  "retryBaseMs",
  "reviewerCount",
  "revision",
  "sampleCount",
  "score",
  "sizeBytes",
  "localImportedThroughSeq",
  "sourceEmbeddedModelContextEnvelopeCount",
  "sourceEventCount",
  "sourceModelContextEnvelopeCount",
  "spanCount",
  "stepCount",
  "systemPromptBytes",
  "threshold",
  "toSeq",
  "toolCount",
  "toolLoopGuardThreshold",
  "toolResultMessageCount",
  "turnCount",
  "turnIndex",
  "unverifiedCount",
  "userMessageCount",
  "predecessorEventSeq",
  "referenceCount",
  "referencedVariableCount",
  "unresolvedReferenceCount",
]);

const SAFE_BOOLEAN_PAYLOAD_KEYS = new Set([
  "agreement",
  "allowInconclusive",
  "compacted",
  "configured",
  "created",
  "duplicate",
  "enabled",
  "networkAllowed",
  "outputCapped",
  "skillCatalogInjected",
  "milestoneTextRedacted",
  "truncated",
  "toolLoopGuardActive",
  "toolLoopGuardEnabled",
  "verified",
]);

export const SAFE_EVENT_PAYLOAD_ATTRIBUTE_KEYS = new Set([
  ...[...SAFE_STRING_PAYLOAD_KEYS].map(
    (key) => `napier.event.payload.${camelToSnake(key)}`,
  ),
  ...[...SAFE_ID_PAYLOAD_KEYS].map(
    (key) => `napier.event.payload.${camelToSnake(key)}`,
  ),
  ...[...SAFE_NUMBER_PAYLOAD_KEYS].map(
    (key) => `napier.event.payload.${camelToSnake(key)}`,
  ),
  ...[...SAFE_BOOLEAN_PAYLOAD_KEYS].map(
    (key) => `napier.event.payload.${camelToSnake(key)}`,
  ),
  ...[...SAFE_MODEL_PAYLOAD_KEYS].map(
    (key) => `napier.event.payload.${camelToSnake(key)}`,
  ),
  ...PROMPT_EVIDENCE_OTEL_KEYS,
]);

export const SAFE_EVENT_EVIDENCE_SUMMARY_ATTRIBUTE_KEYS = new Set(
  [
    "eventCount",
    "toolCompletedNameCount",
    "toolFailedNameCount",
    "verificationToolCompleted",
    "verificationToolPassed",
    "workspaceWriteCompleted",
    "verificationToolPassedAfterWorkspaceWrite",
    "planCompleted",
    "planArtifactVerified",
    "goalSatisfied",
    "recoveryCompleted",
    "evaluationCompleted",
    "evaluationPassed",
    "planCompletedAfterWorkspaceWrite",
    "planArtifactVerifiedAfterWorkspaceWrite",
    "goalSatisfiedAfterWorkspaceWrite",
    "recoveryCompletedAfterInterruption",
    "evaluationCompletedAfterWorkspaceWrite",
    "evaluationPassedAfterWorkspaceWrite",
    "latestWorkspaceWriteSeq",
    "latestPassedVerificationSeq",
    "latestPlanCompletedSeq",
    "latestPlanInvalidatedSeq",
    "latestPlanArtifactVerifiedSeq",
    "latestPlanArtifactInvalidatedSeq",
    "latestGoalSatisfiedSeq",
    "latestGoalInvalidatedSeq",
    "latestRecoveryCompletedSeq",
    "latestRunInterruptedSeq",
    "latestRecoveryInvalidatedSeq",
    "latestEvaluationCompletedSeq",
    "latestEvaluationPassedSeq",
    "latestEvaluationPassInvalidatedSeq",
    "milestoneCount",
    "operatorDecisionRequested",
  ].map((key) => `napier.event.payload.evidence_summary_${camelToSnake(key)}`),
);

export function safePayloadAttributes(payload: JsonValue): {
  values: Record<string, string | number | boolean>;
  dropped: number;
} {
  if (!isRecord(payload)) return { values: {}, dropped: 0 };
  const promptEvidence = promptEvidenceOtelAttributes(payload);
  if (promptEvidence) return { values: promptEvidence, dropped: 0 };
  const values: Record<string, string | number | boolean> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(payload)) {
    const projected = payloadEntryAttributes(key, value);
    if (projected === undefined) dropped += 1;
    else Object.assign(values, projected);
  }
  return { values, dropped };
}

function payloadEntryAttributes(
  key: string,
  value: JsonValue,
): Record<string, string | number | boolean> | undefined {
  if (key === "evidence" || key === "evidenceSummary") {
    if (!isRecord(value)) return undefined;
    const projected = evidenceSummaryPayloadAttributes(value);
    return Object.keys(projected).length > 0 ? projected : undefined;
  }
  if (
    EXCLUDED_PAYLOAD_KEYS.includes(
      key as (typeof EXCLUDED_PAYLOAD_KEYS)[number],
    )
  ) {
    return undefined;
  }
  if (key === "usage" && isRecord(value)) {
    return usagePayloadAttributes(value);
  }
  const modelContext = modelContextEnvelopePayloadAttributes(key, value);
  if (modelContext) return modelContext;
  const model = modelPayloadAttributes(key, value);
  if (model) return model;
  return scalarPayloadAttributes(key, value);
}

function usagePayloadAttributes(
  usage: Record<string, JsonValue>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ]) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      values[`napier.event.usage.${camelToSnake(key)}`] = value;
    }
  }
  return values;
}

function modelContextEnvelopePayloadAttributes(
  key: string,
  value: JsonValue,
): Record<string, string> | undefined {
  if (key !== "modelContextEnvelope" || !isRecord(value)) return undefined;
  const contentSha256 = value["contentSha256"];
  if (
    typeof contentSha256 !== "string" ||
    !SHA256_PATTERN.test(contentSha256)
  ) {
    return undefined;
  }
  return {
    "napier.event.payload.model_context_envelope_sha256": contentSha256,
  };
}

function modelPayloadAttributes(
  key: string,
  value: JsonValue,
): Record<string, string> | undefined {
  if (!SAFE_MODEL_PAYLOAD_KEYS.has(key) || !isRecord(value)) return undefined;
  const provider = value["provider"];
  const id = value["id"];
  if (
    typeof provider !== "string" ||
    typeof id !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    id.length < 1 ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/u.test(id)
  ) {
    return undefined;
  }
  return { [`napier.event.payload.${camelToSnake(key)}`]: `${provider}/${id}` };
}

function scalarPayloadAttributes(
  key: string,
  value: JsonValue,
): Record<string, string | number | boolean> | undefined {
  const attributeKey = `napier.event.payload.${camelToSnake(key)}`;
  if (typeof value === "number") {
    return Number.isFinite(value) && SAFE_NUMBER_PAYLOAD_KEYS.has(key)
      ? { [attributeKey]: value }
      : undefined;
  }
  if (typeof value === "boolean") {
    return SAFE_BOOLEAN_PAYLOAD_KEYS.has(key)
      ? { [attributeKey]: value }
      : undefined;
  }
  if (typeof value !== "string" || !safeStringPayloadValue(key, value)) {
    return undefined;
  }
  return { [attributeKey]: value.slice(0, 512) };
}

function safeStringPayloadValue(key: string, value: string): boolean {
  if (SAFE_STRING_PAYLOAD_KEYS.has(key) || SAFE_ID_PAYLOAD_KEYS.has(key)) {
    return true;
  }
  if (key.endsWith("Sha256")) return SHA256_PATTERN.test(value);
  return key.endsWith("Fingerprint") && /^[A-Za-z0-9_-]{4,128}$/u.test(value);
}

function evidenceSummaryPayloadAttributes(
  evidence: Record<string, JsonValue>,
): Record<string, number | boolean> {
  const values: Record<string, number | boolean> = {};
  for (const key of [
    "eventCount",
    "toolCompletedNameCount",
    "toolFailedNameCount",
    "latestWorkspaceWriteSeq",
    "latestPassedVerificationSeq",
    "latestPlanCompletedSeq",
    "latestPlanInvalidatedSeq",
    "latestPlanArtifactVerifiedSeq",
    "latestPlanArtifactInvalidatedSeq",
    "latestGoalSatisfiedSeq",
    "latestGoalInvalidatedSeq",
    "latestRecoveryCompletedSeq",
    "latestRunInterruptedSeq",
    "latestRecoveryInvalidatedSeq",
    "latestEvaluationCompletedSeq",
    "latestEvaluationPassedSeq",
    "latestEvaluationPassInvalidatedSeq",
    "milestoneCount",
  ]) {
    const value = evidence[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      values[`napier.event.payload.evidence_summary_${camelToSnake(key)}`] =
        value;
    }
  }
  for (const key of [
    "verificationToolCompleted",
    "verificationToolPassed",
    "workspaceWriteCompleted",
    "verificationToolPassedAfterWorkspaceWrite",
    "planCompleted",
    "planArtifactVerified",
    "goalSatisfied",
    "recoveryCompleted",
    "evaluationCompleted",
    "evaluationPassed",
    "planCompletedAfterWorkspaceWrite",
    "planArtifactVerifiedAfterWorkspaceWrite",
    "goalSatisfiedAfterWorkspaceWrite",
    "recoveryCompletedAfterInterruption",
    "evaluationCompletedAfterWorkspaceWrite",
    "evaluationPassedAfterWorkspaceWrite",
    "operatorDecisionRequested",
  ]) {
    const value = evidence[key];
    if (typeof value === "boolean") {
      values[`napier.event.payload.evidence_summary_${camelToSnake(key)}`] =
        value;
    }
  }
  return values;
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9_.-]/gu, "_")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

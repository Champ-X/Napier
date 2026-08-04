import {
  NAPIER_API_VERSION,
  type ExecutionPlan,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordReplay,
  type ExecutionPlanBlueprintRecordReplayHistory,
  type ExecutionPlanBlueprintRecordReplayOutcome,
  type ExecutionPlanBlueprintRecordReplayOutcomes,
  type ExecutionPlanStatus,
  type RunEvent,
} from "@napier/contracts";

import { nowIso } from "./ids.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function withExecutionPlanBlueprintRecordPreviewHash(
  preview: Omit<ExecutionPlanBlueprintRecordPreview, "previewSha256">,
): ExecutionPlanBlueprintRecordPreview {
  return {
    ...preview,
    previewSha256: sha256(
      canonicalJson(executionPlanBlueprintRecordPreviewHashContent(preview)),
    ),
  };
}

export function executionPlanBlueprintRecordReplayFromEvent(
  event: RunEvent,
  recordId: string,
): ExecutionPlanBlueprintRecordReplay | undefined {
  if (event.type !== "plan.created" || !isRecord(event.payload)) {
    return undefined;
  }
  if (event.payload["blueprintRecordId"] !== recordId) return undefined;
  const planId = event.payload["planId"];
  const objective = event.payload["objective"];
  const status = event.payload["status"];
  const stepCount = event.payload["stepCount"];
  const artifactCount = event.payload["artifactCount"];
  const blueprintSha256 = event.payload["blueprintSha256"];
  const sourcePlanId = event.payload["blueprintSourcePlanId"];
  const sourcePlanRevision = event.payload["blueprintSourcePlanRevision"];
  const sourcePlanArchiveSha256 = event.payload["blueprintSourceArchiveSha256"];
  const qualificationStatus = event.payload["blueprintQualificationStatus"];
  const qualificationSha256 = event.payload["blueprintQualificationSha256"];
  const qualificationDiagnosticsSha256 =
    event.payload["blueprintQualificationDiagnosticsSha256"];
  const previewSha256 = event.payload["blueprintPreviewSha256"];
  if (
    typeof planId !== "string" ||
    typeof objective !== "string" ||
    !isExecutionPlanStatus(status) ||
    !isNonNegativeInteger(stepCount) ||
    !isNonNegativeInteger(artifactCount) ||
    !isSha256(blueprintSha256) ||
    typeof sourcePlanId !== "string" ||
    !isNonNegativeInteger(sourcePlanRevision) ||
    !isSha256(sourcePlanArchiveSha256) ||
    !isQualificationStatus(qualificationStatus) ||
    !isSha256(qualificationSha256) ||
    !isSha256(qualificationDiagnosticsSha256) ||
    !isSha256(previewSha256)
  ) {
    return undefined;
  }
  return {
    eventId: event.id,
    threadId: event.threadId,
    runId: event.runId,
    seq: event.seq,
    createdAt: event.createdAt,
    recordId,
    planId,
    objectiveSha256: sha256(objective),
    status,
    stepCount,
    artifactCount,
    blueprintSha256,
    sourcePlanId,
    sourcePlanRevision,
    sourcePlanArchiveSha256,
    qualificationStatus,
    qualificationSha256,
    qualificationDiagnosticsSha256,
    previewSha256,
  };
}

export function createExecutionPlanBlueprintRecordReplayHistory(
  recordId: string,
  replays: ExecutionPlanBlueprintRecordReplay[],
): ExecutionPlanBlueprintRecordReplayHistory {
  const sortedReplays = [...replays].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    const threadOrder = left.threadId.localeCompare(right.threadId);
    if (threadOrder !== 0) return threadOrder;
    return left.seq - right.seq;
  });
  const threadCount = new Set(sortedReplays.map((replay) => replay.threadId))
    .size;
  const content = {
    kind: "napier.execution-plan-blueprint-replay-history" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordId,
    replayCount: sortedReplays.length,
    threadCount,
    planCount: new Set(sortedReplays.map((replay) => replay.planId)).size,
    eventSetSha256: sha256(
      canonicalJson(
        sortedReplays.map((replay) => ({
          eventId: replay.eventId,
          threadId: replay.threadId,
          seq: replay.seq,
          previewSha256: replay.previewSha256,
        })),
      ),
    ),
    ...(threadCount === 1 && sortedReplays[0]
      ? { firstSeq: sortedReplays[0].seq }
      : {}),
    ...(threadCount === 1 && sortedReplays.at(-1)
      ? { lastSeq: sortedReplays.at(-1)!.seq }
      : {}),
    replays: sortedReplays,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecordReplayOutcome(
  replay: ExecutionPlanBlueprintRecordReplay,
  plan: ExecutionPlan | undefined,
): ExecutionPlanBlueprintRecordReplayOutcome {
  const identityMatches =
    plan?.id === replay.planId && plan.threadId === replay.threadId;
  const status: ExecutionPlanBlueprintRecordReplayOutcome["status"] = !plan
    ? "plan_missing"
    : identityMatches
      ? plan.status
      : "identity_mismatch";
  const content = {
    replayEventId: replay.eventId,
    replayEventSeq: replay.seq,
    threadId: replay.threadId,
    planId: replay.planId,
    createdAt: replay.createdAt,
    status,
    ...(identityMatches ? { planRevision: plan.revision } : {}),
    stepCount: identityMatches ? plan.steps.length : replay.stepCount,
    completedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "completed").length
      : 0,
    skippedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "skipped").length
      : 0,
    blockedStepCount: identityMatches
      ? plan.steps.filter((step) => step.status === "blocked").length
      : 0,
    artifactCount: identityMatches
      ? plan.artifacts.length
      : replay.artifactCount,
    verifiedArtifactCount: identityMatches
      ? plan.artifacts.filter((artifact) => artifact.status === "verified")
          .length
      : 0,
    missingArtifactCount: identityMatches
      ? plan.artifacts.filter((artifact) => artifact.status === "missing")
          .length
      : 0,
    replanCount: identityMatches ? plan.replans.length : 0,
    ...(identityMatches
      ? { planProjectionSha256: executionPlanOutcomeProjectionSha256(plan) }
      : {}),
  };
  return {
    ...content,
    outcomeSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecordReplayOutcomes(
  recordId: string,
  replayHistorySha256: string,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcome[],
): ExecutionPlanBlueprintRecordReplayOutcomes {
  const sortedOutcomes = [...outcomes].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    const threadOrder = left.threadId.localeCompare(right.threadId);
    if (threadOrder !== 0) return threadOrder;
    return left.replayEventSeq - right.replayEventSeq;
  });
  const activeCount = countStatus(sortedOutcomes, "active");
  const completedCount = countStatus(sortedOutcomes, "completed");
  const blockedCount = countStatus(sortedOutcomes, "blocked");
  const cancelledCount = countStatus(sortedOutcomes, "cancelled");
  const invalidCount = sortedOutcomes.filter(
    (outcome) =>
      outcome.status === "plan_missing" ||
      outcome.status === "identity_mismatch",
  ).length;
  const replayCount = sortedOutcomes.length;
  const content = {
    kind: "napier.execution-plan-blueprint-replay-outcomes" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordId,
    replayHistorySha256,
    replayCount,
    activeCount,
    completedCount,
    blockedCount,
    cancelledCount,
    invalidCount,
    completionRateBps:
      replayCount === 0
        ? 0
        : Math.floor((completedCount * 10_000) / replayCount),
    outcomeSetSha256: sha256(
      canonicalJson(sortedOutcomes.map((outcome) => outcome.outcomeSha256)),
    ),
    outcomes: sortedOutcomes,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function executionPlanBlueprintRecordPreviewHashContent(
  preview: Omit<ExecutionPlanBlueprintRecordPreview, "previewSha256">,
): unknown {
  const { qualifiedAt: _qualifiedAt, ...qualification } = preview.qualification;
  return {
    status: preview.status,
    diagnostics: preview.diagnostics,
    threadId: preview.threadId,
    recordId: preview.recordId,
    qualification,
    hasOpenPlan: preview.hasOpenPlan,
    ...(preview.plan
      ? {
          plan: {
            threadId: preview.plan.threadId,
            objective: preview.plan.objective,
            status: preview.plan.status,
            revision: preview.plan.revision,
            steps: preview.plan.steps.map((step) => ({
              id: step.id,
              title: step.title,
              description: step.description,
              verification: step.verification,
              dependsOn: step.dependsOn,
              status: step.status,
              evidence: step.evidence,
              ...(step.blocker ? { blocker: step.blocker } : {}),
              ...(step.runId ? { runId: step.runId } : {}),
            })),
            artifacts: preview.plan.artifacts.map((artifact) => ({
              id: artifact.id,
              path: artifact.path,
              kind: artifact.kind,
              description: artifact.description,
              status: artifact.status,
              evidence: artifact.evidence,
              ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
              ...(artifact.sizeBytes !== undefined
                ? { sizeBytes: artifact.sizeBytes }
                : {}),
              ...(artifact.sourceRunId
                ? { sourceRunId: artifact.sourceRunId }
                : {}),
            })),
            criticalPathStepIds: preview.plan.criticalPathStepIds,
            readyStepIds: preview.plan.readyStepIds,
            blockedStepIds: preview.plan.blockedStepIds,
            activePhaseIndex: preview.plan.activePhaseIndex,
            parallelReadyStepIds: preview.plan.parallelReadyStepIds,
            phaseWaveCount: preview.plan.phaseWaves.length,
            phaseProjectionSha256: preview.plan.phaseProjectionSha256,
          },
        }
      : {}),
  };
}

function executionPlanOutcomeProjectionSha256(plan: ExecutionPlan): string {
  return sha256(
    canonicalJson({
      id: plan.id,
      threadId: plan.threadId,
      status: plan.status,
      revision: plan.revision,
      steps: plan.steps.map((step) => ({
        id: step.id,
        status: step.status,
        dependsOn: step.dependsOn,
        evidenceSha256: sha256(step.evidence),
        ...(step.blocker ? { blockerSha256: sha256(step.blocker) } : {}),
        ...(step.runId ? { runId: step.runId } : {}),
      })),
      artifacts: plan.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        pathSha256: sha256(artifact.path),
        status: artifact.status,
        evidenceSha256: sha256(artifact.evidence),
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        ...(artifact.sizeBytes !== undefined
          ? { sizeBytes: artifact.sizeBytes }
          : {}),
        ...(artifact.sourceRunId ? { sourceRunId: artifact.sourceRunId } : {}),
      })),
      replanSha256s: plan.replans.map((replan) => replan.replanSha256),
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      activePhaseIndex: plan.activePhaseIndex,
      parallelReadyStepIds: plan.parallelReadyStepIds,
      phaseWaveCount: plan.phaseWaves.length,
      phaseProjectionSha256: plan.phaseProjectionSha256,
    }),
  );
}

function countStatus(
  outcomes: ExecutionPlanBlueprintRecordReplayOutcome[],
  status: ExecutionPlanBlueprintRecordReplayOutcome["status"],
): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isExecutionPlanStatus(value: unknown): value is ExecutionPlanStatus {
  return (
    value === "active" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification["status"] {
  return (
    value === "qualified" ||
    value === "archived" ||
    value === "source_missing" ||
    value === "source_drift" ||
    value === "invalid"
  );
}

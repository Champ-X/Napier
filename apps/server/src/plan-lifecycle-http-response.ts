import type {
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintVerification,
  ExecutionPlanReplanDraftModelReview,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  safeFilenameSegment,
  setBodyContentSha256Header,
  setEventBoundaryHeaders,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setExecutionPlanListHeaders(
  context: Context,
  threadId: string,
  plans: readonly ExecutionPlan[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, plans);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Plan-Count", String(plans.length));
  for (const status of [
    "active",
    "completed",
    "blocked",
    "cancelled",
  ] satisfies ExecutionPlan["status"][]) {
    context.header(
      `X-Napier-Plan-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(plans.filter((plan) => plan.status === status).length),
    );
  }
  context.header(
    "X-Napier-Plan-Step-Count",
    String(plans.reduce((total, plan) => total + plan.steps.length, 0)),
  );
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(plans.reduce((total, plan) => total + plan.artifacts.length, 0)),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(plans.reduce((total, plan) => total + plan.replans.length, 0)),
  );
}

export function setExecutionPlanHeaders(
  context: Context,
  plan: ExecutionPlan,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, plan);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Status", plan.status);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Step-Count", String(plan.steps.length));
  context.header("X-Napier-Plan-Artifact-Count", String(plan.artifacts.length));
  context.header("X-Napier-Plan-Replan-Count", String(plan.replans.length));
  context.header(
    "X-Napier-Plan-Critical-Path-Count",
    String(plan.criticalPathStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Ready-Step-Count",
    String(plan.readyStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Blocked-Step-Count",
    String(plan.blockedStepIds.length),
  );
  context.header("X-Napier-Plan-Phase-Count", String(plan.phaseWaves.length));
  context.header(
    "X-Napier-Plan-Active-Phase-Index",
    plan.activePhaseIndex === null ? "" : String(plan.activePhaseIndex),
  );
  context.header(
    "X-Napier-Plan-Parallel-Ready-Step-Count",
    String(plan.parallelReadyStepIds.length),
  );
  context.header(
    "X-Napier-Plan-Phase-Projection-SHA256",
    plan.phaseProjectionSha256,
  );
  if (plan.replanRecommendation) {
    context.header("X-Napier-Replan-Recommendation", "true");
    context.header(
      "X-Napier-Replan-Recommendation-SHA256",
      plan.replanRecommendation.recommendationSha256,
    );
    context.header(
      "X-Napier-Replan-Recommendation-Strategy",
      plan.replanRecommendation.strategy,
    );
  } else {
    context.header("X-Napier-Replan-Recommendation", "false");
  }
}

export function setExecutionPlanReplanDraftReviewHeaders(
  context: Context,
  review: ExecutionPlanReplanDraftModelReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Thread-Id", review.threadId);
  context.header("X-Napier-Plan-Id", review.planId);
  context.header(
    "X-Napier-Plan-Expected-Revision",
    String(review.expectedRevision),
  );
  context.header(
    "X-Napier-Replan-Recommendation-SHA256",
    review.recommendationSha256,
  );
  context.header("X-Napier-Replan-Draft-SHA256", review.draftSha256);
  context.header(
    "X-Napier-Replan-Draft-Evaluation-SHA256",
    review.deterministicEvaluationSha256,
  );
  context.header("X-Napier-Replan-Review-Verdict", review.verdict);
  context.header("X-Napier-Replan-Review-Risk", review.risk);
  context.header("X-Napier-Replan-Review-Score", String(review.score));
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Replan-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
}

export function setExecutionPlanArchiveHeaders(
  context: Context,
  archive: ExecutionPlanArchive,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${executionPlanArchiveFilename(archive)}"`,
  );
  setStableContentSha256Header(context, archive.contentSha256);
  context.header("X-Napier-Thread-Id", archive.threadId);
  context.header("X-Napier-Plan-Id", archive.plan.id);
  context.header("X-Napier-Plan-Status", archive.plan.status);
  context.header("X-Napier-Plan-Revision", String(archive.plan.revision));
  context.header("X-Napier-Plan-Archive-SHA256", archive.contentSha256);
  context.header("X-Napier-Event-Stream-SHA256", archive.eventStreamSha256);
  context.header("X-Napier-Event-Count", String(archive.events.length));
  context.header("X-Napier-Plan-Step-Count", String(archive.plan.steps.length));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(archive.plan.artifacts.length),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(archive.plan.replans.length),
  );
  setEventBoundaryHeaders(context, archive.events);
}

export function setExecutionPlanBlueprintHeaders(
  context: Context,
  blueprint: ExecutionPlanBlueprint,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${executionPlanBlueprintFilename(blueprint)}"`,
  );
  setStableContentSha256Header(context, blueprint.contentSha256);
  setExecutionPlanBlueprintSourceHeaders(context, blueprint);
  context.header("X-Napier-Plan-Step-Count", String(blueprint.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(blueprint.artifactCount),
  );
}

export function bindExecutionPlanArchiveVerification(
  verification: ExecutionPlanArchiveVerification,
  threadId: string,
  planId: string,
): ExecutionPlanArchiveVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId && verification.planId === planId) {
    return verification;
  }
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

export function setExecutionPlanArchiveVerificationHeaders(
  context: Context,
  verification: ExecutionPlanArchiveVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Plan-Step-Count", String(verification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(verification.artifactCount),
  );
  context.header(
    "X-Napier-Plan-Replan-Count",
    String(verification.replanCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.planId) {
    context.header("X-Napier-Plan-Id", verification.planId);
  }
  if (verification.revision !== undefined) {
    context.header("X-Napier-Plan-Revision", String(verification.revision));
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Plan-Archive-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
}

export function setExecutionPlanBlueprintVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Plan-Step-Count", String(verification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(verification.artifactCount),
  );
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.contentSha256) {
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      verification.contentSha256,
    );
  }
  if (verification.sourceThreadId) {
    context.header(
      "X-Napier-Blueprint-Source-Thread-Id",
      verification.sourceThreadId,
    );
  }
  if (verification.sourcePlanId) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Id",
      verification.sourcePlanId,
    );
  }
  if (verification.sourcePlanRevision !== undefined) {
    context.header(
      "X-Napier-Blueprint-Source-Plan-Revision",
      String(verification.sourcePlanRevision),
    );
  }
  if (verification.sourcePlanArchiveSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Archive-SHA256",
      verification.sourcePlanArchiveSha256,
    );
  }
  if (verification.sourceEventStreamSha256) {
    context.header(
      "X-Napier-Blueprint-Source-Event-Stream-SHA256",
      verification.sourceEventStreamSha256,
    );
  }
}

export function setExecutionPlanBlueprintSourceHeaders(
  context: Context,
  blueprint: ExecutionPlanBlueprint,
): void {
  context.header("X-Napier-Plan-Blueprint-SHA256", blueprint.contentSha256);
  context.header(
    "X-Napier-Blueprint-Source-Thread-Id",
    blueprint.source.threadId,
  );
  context.header("X-Napier-Blueprint-Source-Plan-Id", blueprint.source.planId);
  context.header(
    "X-Napier-Blueprint-Source-Plan-Revision",
    String(blueprint.source.planRevision),
  );
  context.header(
    "X-Napier-Blueprint-Source-Archive-SHA256",
    blueprint.source.planArchiveSha256,
  );
  context.header(
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    blueprint.source.eventStreamSha256,
  );
}

function executionPlanArchiveFilename(archive: ExecutionPlanArchive): string {
  const safePlanId = safeFilenameSegment(archive.plan.id, "plan");
  return `napier-plan-${safePlanId}-r${archive.plan.revision}-${archive.contentSha256.slice(0, 12)}.json`;
}

function executionPlanBlueprintFilename(
  blueprint: ExecutionPlanBlueprint,
): string {
  const safePlanId = safeFilenameSegment(blueprint.source.planId, "plan");
  return `napier-plan-blueprint-${safePlanId}-r${blueprint.source.planRevision}-${blueprint.contentSha256.slice(0, 12)}.json`;
}

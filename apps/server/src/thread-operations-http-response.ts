import type {
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

export function setWorkspaceFileProjectionHeaders(
  context: Context,
  projection: unknown,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, projection);
}

export function setSubagentOutcomeEvidenceVerificationHeaders(
  context: Context,
  verification: SubagentOutcomeEvidenceVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Evidence-Verification-Status", verification.status);
  context.header("X-Napier-Subagent-Task-Id", verification.taskId);
  context.header(
    "X-Napier-Subagent-Outcome-SHA256",
    verification.outcomeSha256,
  );
  context.header("X-Napier-Evidence-Count", String(verification.evidenceCount));
  context.header(
    "X-Napier-Evidence-Aligned-Count",
    String(verification.alignedCount),
  );
  context.header(
    "X-Napier-Evidence-Divergent-Count",
    String(verification.divergentCount),
  );
  context.header(
    "X-Napier-Evidence-Missing-Count",
    String(verification.missingCount),
  );
}

export function setSubagentOutcomeReviewHeaders(
  context: Context,
  review: SubagentOutcomeReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Subagent-Task-Id", review.taskId);
  context.header("X-Napier-Subagent-Outcome-SHA256", review.outcomeSha256);
  context.header("X-Napier-Subagent-Review-Verdict", review.verdict);
  context.header("X-Napier-Subagent-Review-Score", String(review.score));
  context.header("X-Napier-Subagent-Review-Risk", review.risk);
  context.header(
    "X-Napier-Subagent-Review-Concern-Count",
    String(review.concerns.length),
  );
  context.header(
    "X-Napier-Subagent-Review-Input-Tokens",
    String(review.usage.inputTokens),
  );
  context.header(
    "X-Napier-Subagent-Review-Output-Tokens",
    String(review.usage.outputTokens),
  );
  context.header(
    "X-Napier-Subagent-Review-Cost-USD",
    String(review.usage.costUsd),
  );
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Subagent-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
}

export function setAutomaticRecoveryProjectionHeaders(
  context: Context,
  recovery: {
    assessments: readonly unknown[];
    attempts: readonly unknown[];
  },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, recovery);
  context.header(
    "X-Napier-Recovery-Assessment-Count",
    String(recovery.assessments.length),
  );
  context.header(
    "X-Napier-Recovery-Attempt-Count",
    String(recovery.attempts.length),
  );
}

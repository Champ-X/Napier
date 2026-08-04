import type {
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setExecutionPlanBlueprintRecordReplayHistoryHeaders(
  context: Context,
  history: ExecutionPlanBlueprintRecordReplayHistory,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", history.recordId);
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(history.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Thread-Count",
    String(history.threadCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Plan-Count",
    String(history.planCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Event-Set-SHA256",
    history.eventSetSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-First-Event-Seq",
    history.firstSeq,
  );
  setOptionalNumberHeader(context, "X-Napier-Last-Event-Seq", history.lastSeq);
  setTruthyHeader(
    context,
    "X-Napier-Plan-Blueprint-SHA256",
    history.replays[0]?.blueprintSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Latest-Preview-SHA256",
    history.replays.at(-1)?.previewSha256,
  );
}

export function setExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayHistoryVerification,
): void {
  setVerificationHeaders(context, verification);
  setTruthyHeader(
    context,
    "X-Napier-Plan-Blueprint-Record-Id",
    verification.recordId,
  );
  setTruthyHeader(
    context,
    "X-Napier-Expected-Plan-Blueprint-Record-Id",
    verification.expectedRecordId,
  );
  setTruthyHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Observed-Content-SHA256",
    verification.observedContentSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Declared-Event-Set-SHA256",
    verification.declaredEventSetSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Observed-Event-Set-SHA256",
    verification.observedEventSetSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Replay-Count",
    verification.replayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Replay-Count",
    verification.observedReplayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Thread-Count",
    verification.threadCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Thread-Count",
    verification.observedThreadCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Plan-Count",
    verification.planCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Plan-Count",
    verification.observedPlanCount,
  );
}

export function setExecutionPlanBlueprintRecordReplayOutcomesHeaders(
  context: Context,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, outcomes.contentSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", outcomes.recordId);
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    outcomes.replayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    outcomes.outcomeSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Count",
    String(outcomes.replayCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Active-Count",
    String(outcomes.activeCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(outcomes.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(outcomes.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Cancelled-Count",
    String(outcomes.cancelledCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(outcomes.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(outcomes.completionRateBps),
  );
}

export function setExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayOutcomesVerification,
): void {
  setVerificationHeaders(context, verification);
  setTruthyHeader(
    context,
    "X-Napier-Plan-Blueprint-Record-Id",
    verification.recordId,
  );
  setTruthyHeader(
    context,
    "X-Napier-Expected-Plan-Blueprint-Record-Id",
    verification.expectedRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Content-SHA256",
    verification.declaredContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Recomputed-Content-SHA256",
    verification.recomputedContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Content-SHA256",
    verification.observedContentSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Replay-History-SHA256",
    verification.declaredReplayHistorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Replay-History-SHA256",
    verification.observedReplayHistorySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Declared-Outcome-Set-SHA256",
    verification.declaredOutcomeSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Observed-Outcome-Set-SHA256",
    verification.observedOutcomeSetSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Replay-Count",
    verification.replayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Replay-Count",
    verification.observedReplayCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Completed-Count",
    verification.completedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Completed-Count",
    verification.observedCompletedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blocked-Count",
    verification.blockedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Blocked-Count",
    verification.observedBlockedCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Invalid-Count",
    verification.invalidCount,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Observed-Invalid-Count",
    verification.observedInvalidCount,
  );
}

export function setExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
  context: Context,
  verification: ExecutionPlanBlueprintRecordReplayEventVerification,
): void {
  setVerificationHeaders(context, verification);
  context.header(
    "X-Napier-Expected-Plan-Blueprint-Record-Id",
    verification.expectedRecordId,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Blueprint-Replay-Event-Id", verification.eventId);
  context.header(
    "X-Napier-Blueprint-Replay-Event-Seq",
    String(verification.seq),
  );
  context.header(
    "X-Napier-Declared-Event-SHA256",
    verification.declaredEventSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Observed-Event-SHA256",
    verification.observedEventSha256,
  );
  if (verification.observedReplay) {
    context.header(
      "X-Napier-Plan-Blueprint-Record-Id",
      verification.observedReplay.recordId,
    );
    context.header("X-Napier-Plan-Id", verification.observedReplay.planId);
    context.header(
      "X-Napier-Plan-Blueprint-SHA256",
      verification.observedReplay.blueprintSha256,
    );
    context.header(
      "X-Napier-Blueprint-Preview-SHA256",
      verification.observedReplay.previewSha256,
    );
  }
}

function setVerificationHeaders(
  context: Context,
  verification: {
    contentSha256: string;
    status: string;
    diagnostics: string[];
  },
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
}

function setOptionalHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) context.header(name, value);
}

function setTruthyHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value) context.header(name, value);
}

function setOptionalNumberHeader(
  context: Context,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) context.header(name, String(value));
}

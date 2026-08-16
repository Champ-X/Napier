import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
  ThreadDetail,
} from "@napier/contracts";
import { runEventTraceView } from "./run-event-view";

export type ConversationRecovery = NonNullable<
  ThreadDetail["recoveries"]
>[number];
export type ConversationRecoveryStatus = ConversationRecovery["status"];
export type ConversationRecoveryBudgetReason =
  | "turns"
  | "tokens"
  | "cost"
  | "timeout";

const AUTOMATIC_RECOVERY_EVENT =
  /^run\.recovery\.auto\.(skipped|claimed|started|completed|failed|interrupted|abandoned)$/u;
const RECOVERY_RUN_EVENT = /^run\.recovery\.(started|completed|failed)$/u;
const RECOVERY_RUN_LIFECYCLE_EVENT =
  /^run\.(completed|failed|cancelled|interrupted|budget\.exhausted)$/u;

export function conversationRecoveries(
  events: RunEvent[],
  assessments: AutomaticRecoveryAssessment[],
  attempts: AutomaticRecoveryAttempt[],
  limit = 8,
): ConversationRecovery[] {
  const attemptByAssessment = new Map(
    attempts.map((attempt) => [attempt.assessmentSha256, attempt]),
  );
  const recoveries = assessments.flatMap(
    (assessment): ConversationRecovery[] => {
      const attempt = attemptByAssessment.get(assessment.contentSha256);
      const matchedEvents = events.filter((event) =>
        isBoundRecoveryEvent(event, assessment, attempt),
      );
      const latestEvent = matchedEvents.reduce<RunEvent | undefined>(
        (latest, event) => (!latest || event.seq > latest.seq ? event : latest),
        undefined,
      );
      if (!latestEvent) return [];
      const settlement = recoverySettlement(events, attempt?.recoveryRunId);
      return [
        {
          id: assessment.runId,
          seq: latestEvent.seq,
          createdAt: latestEvent.createdAt,
          status: attempt?.status ?? "skipped",
          assessment: {
            contentSha256: assessment.contentSha256,
            interruptedRunId: assessment.runId,
            rootRunId: assessment.rootRunId,
            eligible: assessment.eligible,
            blockReasons: [...assessment.blockReasons],
            policy: { ...assessment.policy },
            toolCalls: { ...assessment.toolCalls },
            eventRange: { ...assessment.eventRange },
            priorAttempts: assessment.priorAttempts,
            assessedAt: assessment.assessedAt,
          },
          ...(attempt
            ? {
                attempt: {
                  id: attempt.id,
                  status: attempt.status,
                  attempt: attempt.attempt,
                  maxAttempts: attempt.maxAttempts,
                  ...(attempt.recoveryRunId
                    ? { recoveryRunId: attempt.recoveryRunId }
                    : {}),
                  revision: attempt.revision,
                },
              }
            : {}),
          ...(settlement ? { settlement } : {}),
          eventIds: matchedEvents.map((event) => event.id),
        },
      ];
    },
  );
  return recoveries.sort((left, right) => left.seq - right.seq).slice(-limit);
}

function isBoundRecoveryEvent(
  event: RunEvent,
  assessment: AutomaticRecoveryAssessment,
  attempt: AutomaticRecoveryAttempt | undefined,
): boolean {
  if (
    event.visibility !== "user" ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return false;
  }
  if (event.type === "run.interrupted" && event.runId === assessment.runId) {
    return true;
  }
  if (
    attempt?.recoveryRunId === event.runId &&
    RECOVERY_RUN_LIFECYCLE_EVENT.test(event.type)
  ) {
    return true;
  }
  if (AUTOMATIC_RECOVERY_EVENT.test(event.type)) {
    if (event.type === "run.recovery.auto.skipped") {
      return event.payload["assessmentSha256"] === assessment.contentSha256;
    }
    return attempt !== undefined && event.payload["attemptId"] === attempt.id;
  }
  return (
    attempt !== undefined &&
    RECOVERY_RUN_EVENT.test(event.type) &&
    event.payload["attemptId"] === attempt.id
  );
}

function recoverySettlement(
  events: RunEvent[],
  recoveryRunId: string | undefined,
): ConversationRecovery["settlement"] {
  if (!recoveryRunId) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      event.runId !== recoveryRunId ||
      event.type !== "run.budget.exhausted"
    ) {
      continue;
    }
    const view = runEventTraceView(event);
    if (!isBudgetReason(view?.budgetReason)) return undefined;
    return {
      budgetReason: view.budgetReason,
      ...(view.limit !== undefined ? { limit: view.limit } : {}),
      ...(view.observedTurns !== undefined
        ? { observedTurns: view.observedTurns }
        : {}),
      ...(view.observedTotalTokens !== undefined
        ? { observedTotalTokens: view.observedTotalTokens }
        : {}),
      ...(view.observedCostUsd !== undefined
        ? { observedCostUsd: view.observedCostUsd }
        : {}),
      ...(view.observedElapsedMs !== undefined
        ? { observedElapsedMs: view.observedElapsedMs }
        : {}),
    };
  }
  return undefined;
}

function isBudgetReason(
  value: string | undefined,
): value is ConversationRecoveryBudgetReason {
  return (
    value === "turns" ||
    value === "tokens" ||
    value === "cost" ||
    value === "timeout"
  );
}

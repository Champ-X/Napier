import type {
  ExecutionPlan,
  JsonObject,
  JsonValue,
  RunInvocationSource,
  RunRecord,
  Usage,
} from "@napier/contracts";

import { projectAgentMilestones } from "./agent-milestones.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import {
  type RunFailureClassification,
  withSettlementOutcome,
} from "./run-failure-classification.js";
import { registerPlanArtifactCandidates } from "./plan-artifact-candidates.js";
import { partialRunPlanSteps } from "./plan-step-partial.js";
import { hashEventStream } from "./run-replay.js";
import { recordActiveSkillLifecycles } from "./skill-lifecycle-projection.js";
import type { AppendEventInput, LocalStore } from "./store.js";
import { recordRunFinalizationReserve } from "./run-finalization-reserve.js";

const MAX_SETTLEMENT_ITEMS = 12;

export async function settleRunFailure(input: {
  store: LocalStore;
  run: RunRecord;
  failure: RunFailureClassification;
  invocationSource: RunInvocationSource;
  parentRunId?: string;
  recovery?: { mode: "manual" | "automatic"; attemptId?: string };
  usage: Usage;
  limits: NonNullable<RunRecord["limits"]>;
  leaseToken: string;
  onEvent?: EventSink;
}): Promise<RunRecord> {
  await recordBudgetBoundary(input);
  await recordActiveSkillLifecycles(
    input.store,
    input.run.threadId,
    input.run.id,
    input.onEvent,
  ).catch(() => undefined);
  if (input.failure.outcome === "paused_budget") {
    await partialRunPlanSteps({
      store: input.store,
      run: input.run,
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
    await registerPlanArtifactCandidates({
      store: input.store,
      run: input.run,
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
  }
  const failure = await recordBudgetSettlement(input);
  await record(
    input.store,
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: failure.eventType,
      category: "lifecycle",
      visibility: "user",
      payload: failure.payload,
    },
    input.onEvent,
  );
  if (input.invocationSource === "recovery" && input.parentRunId) {
    await record(
      input.store,
      {
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "run.recovery.failed",
        category: "lifecycle",
        visibility: "user",
        payload: JSON.parse(
          JSON.stringify({
            parentRunId: input.parentRunId,
            status: failure.status,
            message: failure.message,
            mode: input.recovery?.mode ?? "manual",
            ...(input.recovery?.attemptId
              ? { attemptId: input.recovery.attemptId }
              : {}),
          }),
        ) as JsonObject,
      },
      input.onEvent,
    );
  }
  return input.store.finishRun(input.run.id, failure.status, {
    error: failure.message,
    ...(failure.outcome ? { outcome: failure.outcome } : {}),
    usage: input.usage,
    leaseToken: input.leaseToken,
  });
}

async function recordBudgetBoundary(
  input: Parameters<typeof settleRunFailure>[0],
): Promise<void> {
  if (input.failure.finalizationReserve) {
    await recordRunFinalizationReserve({
      store: input.store,
      run: input.run,
      limits: input.limits,
      reserve: input.failure.finalizationReserve,
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
    return;
  }
  const boundary: AppendEventInput | undefined = input.failure.budgetExhaustion
    ? {
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "run.budget.exhausted",
        category: "lifecycle",
        visibility: "user",
        payload: JSON.parse(
          JSON.stringify({
            status: "exhausted",
            reason: input.failure.budgetExhaustion.reason,
            limit: input.failure.budgetExhaustion.limit,
            observed: input.failure.budgetExhaustion.observed,
            limits: input.limits,
            message: input.failure.message,
          }),
        ) as JsonObject,
      }
    : input.failure.modelWatchdog
      ? {
          threadId: input.run.threadId,
          runId: input.run.id,
          type: "model.stream.watchdog_triggered",
          category: "lifecycle",
          visibility: "user",
          payload: {
            kind: "napier.model-stream-watchdog",
            schemaVersion: 1,
            ...input.failure.modelWatchdog,
            message: input.failure.message,
          },
        }
      : input.failure.noProgress
        ? {
            threadId: input.run.threadId,
            runId: input.run.id,
            type: "run.no_progress",
            category: "lifecycle",
            visibility: "user",
            payload: {
              kind: "napier.run-no-progress",
              schemaVersion: 1,
              ...input.failure.noProgress,
              message: input.failure.message,
            },
          }
        : input.failure.thinkingLoop
          ? {
              threadId: input.run.threadId,
              runId: input.run.id,
              type: "model.thinking_loop.finalized",
              category: "lifecycle",
              visibility: "user",
              payload: {
                kind: "napier.model-thinking-loop-finalization",
                schemaVersion: 1,
                ...input.failure.thinkingLoop,
                message: input.failure.message,
              },
            }
          : undefined;
  if (!boundary) return;
  await record(input.store, boundary, input.onEvent);
}

async function recordBudgetSettlement(
  input: Parameters<typeof settleRunFailure>[0],
): Promise<RunFailureClassification> {
  if (input.failure.outcome !== "paused_budget") return input.failure;
  const events = (await input.store.listEvents(input.run.threadId)).filter(
    (event) => event.runId === input.run.id,
  );
  const milestones = projectAgentMilestones(events, input.run.id);
  const latestMilestone = milestones.at(-1);
  const plans = boundPlans(
    input.store.listPlans(input.run.threadId),
    input.run.id,
    events,
  );
  const completedItems = uniqueItems([
    ...(latestMilestone?.completedItems ?? []),
    ...plans.flatMap((plan) =>
      plan.steps
        .filter(
          (step) => step.runId === input.run.id && step.status === "completed",
        )
        .map((step) => step.title),
    ),
  ]);
  const openLoops = uniqueItems([
    ...(latestMilestone?.openLoops ?? []),
    ...plans.flatMap((plan) =>
      plan.steps
        .filter((step) => !["completed", "skipped"].includes(step.status))
        .map((step) => step.title),
    ),
  ]);
  const artifacts = plans
    .flatMap((plan) =>
      plan.artifacts
        .filter(
          (artifact) =>
            artifact.sourceRunId === input.run.id &&
            (artifact.status === "candidate" ||
              artifact.status === "produced" ||
              artifact.status === "verified"),
        )
        .map((artifact) => ({
          planId: plan.id,
          artifactId: artifact.id,
          path: artifact.path,
          kind: artifact.kind,
          status: artifact.status,
          ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
          ...(artifact.sizeBytes !== undefined
            ? { sizeBytes: artifact.sizeBytes }
            : {}),
        })),
    )
    .slice(0, MAX_SETTLEMENT_ITEMS);
  const failure = withSettlementOutcome(
    input.failure,
    completedItems.length > 0 || artifacts.length > 0
      ? "partial"
      : "paused_budget",
  );
  const content = {
    kind: "napier.run-settlement" as const,
    schemaVersion: 1 as const,
    outcome: failure.outcome!,
    summary:
      completedItems.length > 0 || artifacts.length > 0
        ? "The Run paused at its control boundary with durable progress preserved."
        : "The Run paused at its control boundary before durable deliverables were recorded.",
    completedItems,
    openLoops,
    artifacts,
    planIds: plans.map((plan) => plan.id).slice(0, MAX_SETTLEMENT_ITEMS),
    continuation:
      "Continue from this settlement and verify current state before repeating side effects.",
    sourceEventCount: events.length,
    sourceEventStreamSha256: hashEventStream(events),
  };
  const contentSha256 = sha256(canonicalJson(content));
  await record(
    input.store,
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "run.settlement.recorded",
      category: "lifecycle",
      visibility: "user",
      payload: {
        ...content,
        contentSha256,
      },
    },
    input.onEvent,
  );
  await record(
    input.store,
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "run.settlement.checkpoint",
      category: "lifecycle",
      visibility: "user",
      payload: {
        kind: "napier.run-settlement-checkpoint",
        schemaVersion: 1,
        outcome: failure.outcome!,
        settlementSha256: contentSha256,
        sourceEventStreamSha256: content.sourceEventStreamSha256,
        continuation: content.continuation,
        openLoops: content.openLoops,
        artifactCount: content.artifacts.length,
        planIds: content.planIds,
        contentSha256: sha256(
          canonicalJson({
            settlementSha256: contentSha256,
            sourceEventStreamSha256: content.sourceEventStreamSha256,
            continuation: content.continuation,
            openLoops: content.openLoops,
            artifactCount: content.artifacts.length,
            planIds: content.planIds,
          }),
        ),
      },
    },
    input.onEvent,
  );
  return failure;
}

function boundPlans(
  plans: ExecutionPlan[],
  runId: string,
  events: Awaited<ReturnType<LocalStore["listEvents"]>>,
): ExecutionPlan[] {
  const eventPlanIds = new Set(
    events.flatMap((event): string[] => {
      const payload = recordValue(event.payload);
      return typeof payload?.["planId"] === "string" ? [payload["planId"]] : [];
    }),
  );
  return plans.filter(
    (plan) =>
      eventPlanIds.has(plan.id) ||
      plan.steps.some((step) => step.runId === runId) ||
      plan.artifacts.some((artifact) => artifact.sourceRunId === runId),
  );
}

function uniqueItems(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    MAX_SETTLEMENT_ITEMS,
  );
}

function recordValue(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

async function record(
  store: LocalStore,
  input: AppendEventInput,
  onEvent: EventSink | undefined,
): Promise<void> {
  const event = await store.appendEvent(input);
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch {
    // Durable settlement must survive a disconnected stream.
  }
}

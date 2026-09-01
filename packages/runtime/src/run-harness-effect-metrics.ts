import type { RunEvent, RunRecord } from "@napier/contracts";
import type {
  RunHarnessEffectMetrics,
  RunHarnessFirstAction,
  RunHarnessInterventionReason,
  RunHarnessResolutionMetrics,
  RunHarnessTaskOutcome,
} from "@napier/contracts/run-harness-effects";

import { canonicalJson, sha256 } from "./ed25519.js";
import { parseModelHarnessResolutionReceipt } from "./model-harness-receipt.js";
import { parseReleaseProductTrial } from "./release-product-gate.js";
import { projectRunHarnessContextMetrics } from "./run-harness-context-metrics.js";

export const RUN_HARNESS_EFFECT_ALGORITHM_VERSION =
  "napier.run-harness-effect.v1";

const TASK_EVENT_TYPES = new Set([
  "message.user",
  "workflow.node.prompt",
  "goal.continuation.prompt",
  "run.recovery.prompt",
]);
const HARNESS_ACTIONS = ["read", "write", "verify"] as const;
const RELEASE_TRIAL_EVENT = "evaluation.release-product.trial.recorded";
const MODEL_HARNESS_EVENT = "model.harness.resolved";

export function projectRunHarnessEffectMetrics(
  run: RunRecord,
  events: readonly RunEvent[],
  eventStreamSha256: string,
): RunHarnessEffectMetrics {
  assertSourceBinding(run, events, eventStreamSha256);
  const started = events.filter((event) => event.type === "tool.started");
  const classifiedStarts = started.filter(validClassifiedStart);
  const callHashes = started.flatMap((event) => {
    const toolName = stringField(event.payload, "toolName");
    const callInputSha256 = hashField(event.payload, "callInputSha256");
    return toolName && callInputSha256
      ? [{ event, toolName, callInputSha256 }]
      : [];
  });
  const repeatedCallCount = repeatedCalls(callHashes);
  const results = completedResults(started, events);
  const noNewInformationCount = repeatedResults(results);
  const actions = Object.fromEntries(
    HARNESS_ACTIONS.map((action) => [
      action,
      firstAction(run.startedAt, classifiedStarts, action),
    ]),
  ) as RunHarnessEffectMetrics["firstAction"];
  const interventionReasons = events.flatMap(interventionReason);
  const reasonCounts = countReasons(interventionReasons);
  const { contextTokens, overflow } = projectRunHarnessContextMetrics(events);
  const taskSha256 = taskInputSha256(events);
  const harnessResolution = projectHarnessResolution(events);
  const content = {
    kind: "napier.run-harness-effect-metrics" as const,
    schemaVersion: 1 as const,
    algorithmVersion: RUN_HARNESS_EFFECT_ALGORITHM_VERSION,
    runId: run.id,
    eventStreamSha256,
    ...(taskSha256 ? { taskInputSha256: taskSha256 } : {}),
    firstAction: actions,
    toolEfficiency: {
      startedCount: started.length,
      classifiedActionCount: classifiedStarts.length,
      hashedCallCount: callHashes.length,
      repeatedCallCount,
      repeatedCallRate: rate(repeatedCallCount, callHashes.length),
      noNewInformationEligibleCount: results.length,
      noNewInformationCount,
      noNewInformationRate: rate(noNewInformationCount, results.length),
    },
    contextTokens,
    overflow,
    interventions: {
      count: interventionReasons.length,
      reasonCounts,
      reasonSetSha256: sha256(canonicalJson(reasonCounts)),
    },
    harnessResolution,
    taskOutcome: taskOutcome(events),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function projectHarnessResolution(
  events: readonly RunEvent[],
): RunHarnessResolutionMetrics {
  const observations = events.filter(
    (event) => event.type === MODEL_HARNESS_EVENT,
  );
  const receiptSha256s = observations.flatMap((event) => {
    const receipt = parseModelHarnessResolutionReceipt(event.payload);
    return receipt ? [receipt.contentSha256] : [];
  });
  const distinctReceiptSha256s = [...new Set(receiptSha256s)];
  const counts = {
    observationCount: observations.length,
    validReceiptCount: receiptSha256s.length,
    distinctReceiptCount: distinctReceiptSha256s.length,
  };
  if (
    observations.length === 0 ||
    receiptSha256s.length !== observations.length
  ) {
    return { status: "unavailable", ...counts };
  }
  return {
    status: "available",
    ...counts,
    firstReceiptSha256: receiptSha256s[0]!,
    lastReceiptSha256: receiptSha256s.at(-1)!,
    resolutionSequenceSha256: sha256(canonicalJson(distinctReceiptSha256s)),
  };
}

function assertSourceBinding(
  run: RunRecord,
  events: readonly RunEvent[],
  eventStreamSha256: string,
): void {
  if (
    !/^[a-f0-9]{64}$/u.test(eventStreamSha256) ||
    eventStreamSha256 !==
      sha256(events.map((event) => JSON.stringify(event)).join("\n")) ||
    events.some(
      (event) => event.runId !== run.id || event.threadId !== run.threadId,
    )
  ) {
    throw new Error("Run Harness metrics source binding is invalid");
  }
}

function firstAction(
  startedAt: string,
  events: readonly RunEvent[],
  action: (typeof HARNESS_ACTIONS)[number],
): RunHarnessFirstAction {
  const event = events.find(
    (candidate) => stringField(candidate.payload, "harnessAction") === action,
  );
  if (!event) return { status: "unavailable" };
  const elapsedMs = Date.parse(event.createdAt) - Date.parse(startedAt);
  return Number.isFinite(elapsedMs) && elapsedMs >= 0
    ? { status: "available", elapsedMs, eventSeq: event.seq }
    : { status: "unavailable" };
}

function repeatedCalls(
  calls: readonly { toolName: string; callInputSha256: string }[],
): number {
  const seen = new Set<string>();
  let repeated = 0;
  for (const call of calls) {
    const key = `${call.toolName}:${call.callInputSha256}`;
    if (seen.has(key)) repeated += 1;
    seen.add(key);
  }
  return repeated;
}

function completedResults(
  starts: readonly RunEvent[],
  events: readonly RunEvent[],
): Array<{ toolName: string; outputTextSha256: string }> {
  const startsByCall = new Map<string, RunEvent[]>();
  for (const event of starts) {
    const callId = stringField(event.payload, "callId");
    if (!callId) continue;
    const bucket = startsByCall.get(callId) ?? [];
    bucket.push(event);
    startsByCall.set(callId, bucket);
  }
  return events.flatMap((event) => {
    if (event.type !== "tool.completed") return [];
    const callId = stringField(event.payload, "callId");
    const toolName = stringField(event.payload, "toolName");
    const outputTextSha256 = hashField(event.payload, "outputTextSha256");
    const outputTextBytes = field(event.payload, "outputTextBytes");
    const matchingStarts = callId ? (startsByCall.get(callId) ?? []) : [];
    if (
      !toolName ||
      !outputTextSha256 ||
      !Number.isSafeInteger(outputTextBytes) ||
      Number(outputTextBytes) <= 0 ||
      field(event.payload, "outputRedacted") === true ||
      matchingStarts.length !== 1 ||
      stringField(matchingStarts[0]!.payload, "toolName") !== toolName ||
      matchingStarts[0]!.seq >= event.seq
    ) {
      return [];
    }
    return [{ toolName, outputTextSha256 }];
  });
}

function validClassifiedStart(event: RunEvent): boolean {
  return Boolean(
    stringField(event.payload, "callId") &&
    stringField(event.payload, "toolName") &&
    hashField(event.payload, "callInputSha256") &&
    HARNESS_ACTIONS.includes(
      stringField(
        event.payload,
        "harnessAction",
      ) as (typeof HARNESS_ACTIONS)[number],
    ),
  );
}

function repeatedResults(
  results: readonly { toolName: string; outputTextSha256: string }[],
): number {
  const seenByTool = new Map<string, Set<string>>();
  let repeated = 0;
  for (const result of results) {
    const seen = seenByTool.get(result.toolName) ?? new Set<string>();
    if (seen.has(result.outputTextSha256)) repeated += 1;
    seen.add(result.outputTextSha256);
    seenByTool.set(result.toolName, seen);
  }
  return repeated;
}

function interventionReason(event: RunEvent): RunHarnessInterventionReason[] {
  if (event.type === "operator.decision.requested") {
    return ["operator_decision"];
  }
  if (event.type === "browser.interaction_confirmation.pending") {
    return ["browser_confirmation"];
  }
  if (event.type === "workflow.approval.requested") {
    return ["workflow_approval"];
  }
  if (
    event.type === "run.recovery.started" &&
    stringField(event.payload, "mode") === "manual"
  ) {
    return ["manual_recovery"];
  }
  if (
    (event.type === "run.failed" &&
      stringField(event.payload, "outcome") === "paused_budget") ||
    stringField(event.payload, "harnessInterventionReason") === "budget_pause"
  ) {
    return ["budget_pause"];
  }
  const reason = stringField(event.payload, "harnessInterventionReason");
  if (
    event.type === "model.response" &&
    stringField(event.payload, "responseDisposition") ===
      "capability_recovery_required"
  ) {
    return ["capability_recovery"];
  }
  return reason === "approval_block" ||
    reason === "capability_block" ||
    reason === "capability_use_required" ||
    reason === "capability_discovery_required" ||
    reason === "safety_block"
    ? [reason]
    : [];
}

function countReasons(
  reasons: readonly RunHarnessInterventionReason[],
): Partial<Record<RunHarnessInterventionReason, number>> {
  return Object.fromEntries(
    [...new Set(reasons)]
      .sort()
      .map((reason) => [
        reason,
        reasons.filter((item) => item === reason).length,
      ]),
  );
}

function taskOutcome(events: readonly RunEvent[]): RunHarnessTaskOutcome {
  const goal = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "goal.evaluated" &&
        typeof field(event.payload, "satisfied") === "boolean",
    );
  if (goal) {
    return {
      status: field(goal.payload, "satisfied") === true ? "passed" : "failed",
      evidenceType: "goal.evaluated",
      eventSeq: goal.seq,
    };
  }
  const controlledTrial = [...events]
    .reverse()
    .find((event) => event.type === RELEASE_TRIAL_EVENT);
  if (controlledTrial) {
    const trial = parseReleaseProductTrial(controlledTrial.payload);
    if (trial?.status === "passed" || trial?.status === "failed") {
      return {
        status: trial.status,
        evidenceType: RELEASE_TRIAL_EVENT,
        eventSeq: controlledTrial.seq,
      };
    }
  }
  return { status: "unavailable" };
}

function taskInputSha256(events: readonly RunEvent[]): string | undefined {
  const event = events.find((candidate) =>
    TASK_EVENT_TYPES.has(candidate.type),
  );
  const text = stringField(event?.payload, "text");
  return text?.trim() ? sha256(text) : undefined;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function field(value: unknown, key: string): unknown {
  return record(value)?.[key];
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = field(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

function hashField(value: unknown, key: string): string | undefined {
  const candidate = stringField(value, key);
  return candidate && /^[a-f0-9]{64}$/u.test(candidate) ? candidate : undefined;
}

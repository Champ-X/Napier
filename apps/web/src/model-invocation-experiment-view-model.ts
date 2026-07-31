import type {
  ModelInvocationCapsuleReceipt,
  ModelInvocationExperimentComparison,
  ModelInvocationExperimentResultFrame,
  ModelInvocationPurpose,
  ModelRef,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

export interface ModelInvocationCheckpointView {
  key: string;
  runId: string;
  turnIndex: number;
  capsuleEventSeq: number;
  runIndex: number;
  status: RunRecord["status"];
  purpose: ModelInvocationPurpose;
  model: ModelRef;
  capsuleBytes: number;
  createdAt: string;
}

export interface ModelInvocationExperimentComparisonView {
  sourceStatus: string;
  targetStatus: string;
  sourceStopReason: string;
  targetStopReason: string;
  sourceModel: string;
  targetModel: string;
  outputChanged: boolean;
  textChanged: boolean;
  durationMsDelta: number;
  tokenDelta: number;
  toolCallDelta: number;
  costUsdDelta: number;
  addedToolNames: string[];
  removedToolNames: string[];
  sourceToolCallCount: number;
  targetToolCallCount: number;
}

export function modelInvocationCheckpoints(
  runs: RunRecord[],
  events: RunEvent[],
): ModelInvocationCheckpointView[] {
  const runIndexes = new Map(runs.map((run, index) => [run.id, index + 1]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  return events.flatMap((event): ModelInvocationCheckpointView[] => {
    const run = runsById.get(event.runId);
    const receipt = modelInvocationReceipt(event);
    if (
      !receipt ||
      !run ||
      !terminalStatus(run.status) ||
      !run.finishedAt ||
      !run.configuration
    ) {
      return [];
    }
    return [
      {
        key: `${run.id}:${String(receipt.turnIndex)}:${String(event.seq)}`,
        runId: run.id,
        turnIndex: receipt.turnIndex,
        capsuleEventSeq: event.seq,
        runIndex: runIndexes.get(run.id) ?? 0,
        status: run.status,
        purpose: receipt.purpose,
        model: structuredClone(receipt.model),
        capsuleBytes: receipt.capsuleBytes,
        createdAt: event.createdAt,
      },
    ];
  });
}

export function parseModelInvocationExperimentModelKey(
  value: string,
): ModelRef {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    throw new Error("Model invocation experiment model is invalid");
  }
  return { provider, id };
}

export function projectModelInvocationExperimentComparison(
  comparison: ModelInvocationExperimentComparison,
): ModelInvocationExperimentComparisonView {
  return {
    sourceStatus: comparison.source.status,
    targetStatus: comparison.target.status,
    sourceStopReason: comparison.source.stopReason,
    targetStopReason: comparison.target.stopReason,
    sourceModel: modelKey(comparison.source.model),
    targetModel: modelKey(comparison.target.model),
    outputChanged: comparison.outputChanged,
    textChanged: comparison.textChanged,
    durationMsDelta: comparison.metricDelta.durationMs,
    tokenDelta:
      comparison.metricDelta.inputTokens + comparison.metricDelta.outputTokens,
    toolCallDelta: comparison.metricDelta.toolCallCount,
    costUsdDelta: comparison.metricDelta.costUsd,
    addedToolNames: [...comparison.addedToolNames],
    removedToolNames: [...comparison.removedToolNames],
    sourceToolCallCount: comparison.source.toolCallCount,
    targetToolCallCount: comparison.target.toolCallCount,
  };
}

export function modelInvocationExperimentResultFilename(
  frame: ModelInvocationExperimentResultFrame,
): string {
  return `napier-model-experiment-${safeSegment(
    frame.targetRunId,
    "run",
  )}-${frame.contentSha256.slice(0, 16)}.json`;
}

function modelInvocationReceipt(
  event: RunEvent,
): ModelInvocationCapsuleReceipt | undefined {
  if (event.type !== "context.model_invocation") return undefined;
  const value = record(event.payload);
  if (
    !value ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "turnIndex",
      "purpose",
      "model",
      "contextEnvelopeSha256",
      "contextSha256",
      "capsuleSha256",
      "capsuleBytes",
      "storage",
      "contentSha256",
    ]) ||
    value["kind"] !== "napier.model-invocation-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !nonNegativeInteger(value["turnIndex"]) ||
    !purpose(value["purpose"]) ||
    !modelRef(value["model"]) ||
    !hash(value["contextEnvelopeSha256"]) ||
    !hash(value["contextSha256"]) ||
    !hash(value["capsuleSha256"]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    value["capsuleBytes"] > 8 * 1024 * 1024 ||
    value["storage"] !== "local_only" ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  return structuredClone(value) as unknown as ModelInvocationCapsuleReceipt;
}

function terminalStatus(status: RunRecord["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function purpose(value: unknown): value is ModelInvocationPurpose {
  return (
    value === "agent_turn" ||
    value === "context_compaction" ||
    value === "goal_evaluation" ||
    value === "memory_extraction"
  );
}

function modelRef(value: unknown): value is ModelRef {
  const model = record(value);
  return Boolean(
    model &&
    exactKeys(model, ["provider", "id"]) &&
    typeof model["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(model["provider"]) &&
    typeof model["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(model["id"]),
  );
}

function modelKey(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return normalized || fallback;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

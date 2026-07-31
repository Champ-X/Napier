import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentResultFrame,
  ModelRef,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

export interface AgentMessageCheckpointView {
  key: string;
  runId: string;
  messageSeq: number;
  runIndex: number;
  status: RunRecord["status"];
  model: ModelRef;
  createdAt: string;
}

export interface AgentMessageExperimentComparisonView {
  sourceStatus: RunRecord["status"];
  targetStatus: RunRecord["status"];
  sourceModel: string;
  targetModel: string;
  outputChanged: boolean;
  durationMsDelta: number;
  tokenDelta: number;
  toolCallDelta: number;
  costUsdDelta: number;
  changedConfigurationFields: string[];
  addedToolNames: string[];
  removedToolNames: string[];
  sourceToolCallCount: number;
  targetToolCallCount: number;
}

export function agentMessageCheckpoints(
  runs: RunRecord[],
  events: RunEvent[],
): AgentMessageCheckpointView[] {
  const runIndexes = new Map(runs.map((run, index) => [run.id, index + 1]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  return events.flatMap((event): AgentMessageCheckpointView[] => {
    const run = runsById.get(event.runId);
    if (
      event.type !== "message.user" ||
      !run ||
      run.source !== "user" ||
      !terminalStatus(run.status) ||
      !run.finishedAt ||
      !run.configuration ||
      run.configuration.schemaVersion < 7
    ) {
      return [];
    }
    return [
      {
        key: `${run.id}:${String(event.seq)}`,
        runId: run.id,
        messageSeq: event.seq,
        runIndex: runIndexes.get(run.id) ?? 0,
        status: run.status,
        model: structuredClone(run.configuration.model),
        createdAt: event.createdAt,
      },
    ];
  });
}

export function parseAgentExperimentModelKey(value: string): ModelRef {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    throw new Error("Agent experiment model is invalid");
  }
  return { provider, id };
}

export function projectAgentMessageExperimentComparison(
  comparison: AgentMessageExperimentComparison,
): AgentMessageExperimentComparisonView {
  return {
    sourceStatus: comparison.source.status,
    targetStatus: comparison.target.status,
    sourceModel: modelKey(comparison.source.model),
    targetModel: modelKey(comparison.target.model),
    outputChanged: comparison.outputChanged,
    durationMsDelta: comparison.metricDelta.durationMs,
    tokenDelta:
      comparison.metricDelta.inputTokens + comparison.metricDelta.outputTokens,
    toolCallDelta: comparison.metricDelta.toolCallCount,
    costUsdDelta: comparison.metricDelta.costUsd,
    changedConfigurationFields: [
      ...comparison.configurationDelta.changedFields,
    ],
    addedToolNames: [...comparison.addedToolNames],
    removedToolNames: [...comparison.removedToolNames],
    sourceToolCallCount: comparison.source.metrics.toolCallCount,
    targetToolCallCount: comparison.target.metrics.toolCallCount,
  };
}

export function agentMessageExperimentResultFilename(
  frame: AgentMessageExperimentResultFrame,
): string {
  return `napier-agent-experiment-${safeSegment(
    frame.targetRunId,
    "run",
  )}-${frame.contentSha256.slice(0, 16)}.json`;
}

function terminalStatus(status: RunRecord["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
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

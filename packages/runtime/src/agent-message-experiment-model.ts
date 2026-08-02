import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentRunObservation,
  AgentMessageExperimentToolEffects,
  RunEvent,
  RunMetricDelta,
  RunMetrics,
  RunRecord,
  TerminalRunStatus,
} from "@napier/contracts";

import { collectRunToolEffectObservations } from "./automatic-recovery.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { deriveRunMetrics } from "./run-replay.js";
import { compareRunConfigurations } from "./run-config.js";
import type { LocalStore } from "./store.js";

const METRIC_KEYS: Array<keyof RunMetricDelta> = [
  "durationMs",
  "eventCount",
  "messageCount",
  "modelResponseCount",
  "modelContextEnvelopeCount",
  "embeddedModelContextEnvelopeCount",
  "modelContextBoundResponseCount",
  "modelContextUnboundResponseCount",
  "toolCallCount",
  "toolCompletedCount",
  "toolFailedCount",
  "toolBlockedCount",
  "subagentCount",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
];

export function agentMessageExperimentToolEffects(
  events: RunEvent[],
): AgentMessageExperimentToolEffects {
  const observations = collectRunToolEffectObservations(events);
  return {
    toolCallCount: observations.length,
    readOnlyCount: observations.filter(
      (observation) => observation.effect === "read",
    ).length,
    writeCount: observations.filter(
      (observation) => observation.effect === "write",
    ).length,
    unknownCount: observations.filter(
      (observation) => observation.effect === "unknown",
    ).length,
    unresolvedCount: observations.filter(
      (observation) => observation.unresolved,
    ).length,
    writeToolNames: canonicalToolNames(
      observations
        .filter((observation) => observation.effect === "write")
        .map((observation) => observation.toolName),
    ),
    unknownToolNames: canonicalToolNames(
      observations
        .filter(
          (observation) =>
            observation.effect === "unknown" || observation.unresolved,
        )
        .map((observation) => observation.toolName),
    ),
  };
}

export function agentMessageExperimentHistoryBinding(
  events: RunEvent[],
  beforeSeq: number,
): { messageCount: number; sha256: string } {
  const messages = events
    .filter(
      (event) =>
        event.seq < beforeSeq &&
        (event.type === "message.user" ||
          event.type === "message.assistant" ||
          event.type === "goal.continuation.prompt"),
    )
    .map((event) => ({
      type: event.type,
      payload: event.payload,
    }));
  return {
    messageCount: messages.length,
    sha256: sha256(canonicalJson(messages)),
  };
}

export async function createAgentMessageExperimentComparison(options: {
  store: LocalStore;
  sourceRun: RunRecord;
  targetRun: RunRecord;
}): Promise<AgentMessageExperimentComparison> {
  const [source, target] = await Promise.all([
    observeRun(options.store, options.sourceRun),
    observeRun(options.store, options.targetRun),
  ]);
  const metricDelta = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, target.metrics[key] - source.metrics[key]]),
  ) as RunMetricDelta;
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  const content = {
    kind: "napier.agent-message-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source,
    target,
    metricDelta,
    outputChanged:
      source.metrics.assistantTextSha256 !== target.metrics.assistantTextSha256,
    addedToolNames: target.toolNames.filter((name) => !sourceTools.has(name)),
    removedToolNames: source.toolNames.filter((name) => !targetTools.has(name)),
    configurationDelta: compareRunConfigurations(
      options.sourceRun.configuration,
      options.targetRun.configuration,
    ),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

async function observeRun(
  store: LocalStore,
  run: RunRecord,
): Promise<AgentMessageExperimentRunObservation> {
  if (
    !run.configuration ||
    !run.finishedAt ||
    !isTerminalRunStatus(run.status)
  ) {
    throw new Error("Agent message experiment Run evidence is incomplete");
  }
  const events = (await store.listEvents(run.threadId)).filter(
    (event) => event.runId === run.id,
  );
  const subagents = store.listSubagentTasks(run.threadId, run.id);
  return {
    threadId: run.threadId,
    runId: run.id,
    status: run.status,
    configurationSha256: run.configuration.contentSha256,
    model: structuredClone(run.configuration.model),
    executionMode:
      run.configuration.schemaVersion === 1
        ? "standard"
        : run.configuration.executionMode,
    metrics: deriveRunMetrics(run.startedAt, run.finishedAt, events, subagents),
    toolNames: toolNames(events),
    toolEffects: agentMessageExperimentToolEffects(events),
  };
}

function toolNames(events: RunEvent[]): string[] {
  return canonicalToolNames(
    events.flatMap((event): string[] => {
      if (
        event.type !== "tool.started" ||
        !event.payload ||
        Array.isArray(event.payload) ||
        typeof event.payload !== "object" ||
        typeof event.payload["toolName"] !== "string"
      ) {
        return [];
      }
      return [event.payload["toolName"]];
    }),
  );
}

function canonicalToolNames(names: string[]): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function isTerminalRunStatus(
  status: RunRecord["status"],
): status is TerminalRunStatus {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

export function agentMessageExperimentMetricDeltaIsFinite(
  metrics: RunMetrics | RunMetricDelta,
): boolean {
  return METRIC_KEYS.every(
    (key) => typeof metrics[key] === "number" && Number.isFinite(metrics[key]),
  );
}

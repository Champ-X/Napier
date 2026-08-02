import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  CreateAgentMessageExperimentRequest,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";

import type { AgentRuntime } from "./agent-runtime.js";
import type { EventSink } from "./event-sink.js";
import {
  AGENT_MESSAGE_TOOL_RESULT_REPLAY,
  FrozenToolResultReplayController,
  liveToolResultReuseSummary,
} from "./agent-message-tool-result-replay.js";
import { AGENT_MESSAGE_EXPERIMENT_EXECUTION } from "./agent-message-experiment-execution.js";
import {
  agentMessageExperimentHistoryBinding,
  createAgentMessageExperimentComparison,
} from "./agent-message-experiment-model.js";
import {
  validateAgentMessageExperimentPreview,
  validateAgentMessageExperimentResult,
  validateCreateAgentMessageExperimentRequest,
} from "./agent-message-experiment-protocol.js";
import {
  projectAgentMessageExperimentSource,
  type AgentMessageExperimentSource,
} from "./agent-message-experiment-source.js";
import { sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { createThreadBranch } from "./thread-branches.js";

export class AgentMessageExperimentPreviewChangedError extends Error {
  constructor() {
    super("Agent message experiment preview changed before execution");
    this.name = "AgentMessageExperimentPreviewChangedError";
  }
}

export interface RunAgentMessageExperimentOptions {
  sourceThreadId: string;
  request: CreateAgentMessageExperimentRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onTargetCreated?: (thread: ThreadRecord) => Promise<void> | void;
}

export class AgentMessageExperimentRuntime {
  constructor(
    private readonly store: LocalStore,
    private readonly agents: AgentRuntime,
  ) {}

  async preview(
    sourceThreadId: string,
    request: CreateAgentMessageExperimentRequest,
    signal?: AbortSignal,
  ): Promise<AgentMessageExperimentPreview> {
    signal?.throwIfAborted();
    const validated = validateCreateAgentMessageExperimentRequest(request);
    const source = await this.project(sourceThreadId, validated);
    await this.agents.modelRegistry.resolveConfigured(
      source.preview.targetModel,
    );
    signal?.throwIfAborted();
    return validateAgentMessageExperimentPreview(source.preview);
  }

  async run(
    options: RunAgentMessageExperimentOptions,
  ): Promise<AgentMessageExperimentResult> {
    options.signal?.throwIfAborted();
    const request = validateCreateAgentMessageExperimentRequest(
      options.request,
    );
    if (!request.expectedPreviewSha256) {
      throw new Error(
        "Agent message experiment execution requires an expected preview hash",
      );
    }
    const source = await this.project(options.sourceThreadId, request);
    const preview = validateAgentMessageExperimentPreview(source.preview);
    if (request.expectedPreviewSha256 !== preview.previewSha256) {
      throw new AgentMessageExperimentPreviewChangedError();
    }
    await this.agents.modelRegistry.resolveConfigured(preview.targetModel);
    options.signal?.throwIfAborted();
    const toolResultReplay =
      preview.toolResultMode === "reuse_source"
        ? new FrozenToolResultReplayController(
            preview.sourceThreadId,
            preview.sourceRunId,
            source.frozenToolResults,
          )
        : undefined;
    const branch = await createThreadBranch(
      this.store,
      options.sourceThreadId,
      {
        fromSeq: preview.branchFromSeq,
        title: source.title,
      },
      { includeGoalContinuationPrompts: true },
    );
    let targetRun: RunRecord | undefined;
    try {
      const refreshedPreview = validateAgentMessageExperimentPreview(
        (await this.project(options.sourceThreadId, request)).preview,
      );
      if (refreshedPreview.previewSha256 !== preview.previewSha256) {
        throw new AgentMessageExperimentPreviewChangedError();
      }
      const targetHistory = agentMessageExperimentHistoryBinding(
        branch.detail.events,
        Number.POSITIVE_INFINITY,
      );
      if (
        targetHistory.messageCount !== preview.sourceHistoryMessageCount ||
        targetHistory.sha256 !== preview.sourceHistorySha256
      ) {
        throw new Error(
          "Agent message experiment materialized history does not match its preview",
        );
      }
      await options.onTargetCreated?.(branch.detail.thread);
      targetRun = await this.agents.runPrompt({
        threadId: branch.detail.thread.id,
        text: source.prompt,
        model: preview.targetModel,
        agentRevision: preview.sourceAgentRevision,
        executionMode: "agent_experiment_read_only",
        source: "user",
        parentRunId: branch.run.id,
        [AGENT_MESSAGE_EXPERIMENT_EXECUTION]: {
          sourceThreadId: preview.sourceThreadId,
          sourceRunId: preview.sourceRunId,
          sourceMessageSeq: preview.sourceMessageSeq,
          sourceRunConfigurationSha256: preview.sourceRunConfigurationSha256,
          sourcePromptVariableResolvedAt:
            preview.sourcePromptVariableResolvedAt,
          previewSha256: preview.previewSha256,
          sourcePromptSha256: preview.sourcePromptSha256,
          candidateWorkspaceSnapshotSha256:
            preview.candidateWorkspaceSnapshotSha256,
          toolResultMode: preview.toolResultMode,
          sourceReusableToolResultCount: preview.sourceReusableToolResultCount,
          sourceToolResultSetSha256: preview.sourceToolResultSetSha256,
        },
        ...(toolResultReplay
          ? { [AGENT_MESSAGE_TOOL_RESULT_REPLAY]: toolResultReplay }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onRunCreated: async (run) => {
          targetRun = run;
          const event = await this.store.appendEvent({
            threadId: run.threadId,
            runId: run.id,
            type: "agent.experiment.started",
            category: "model",
            visibility: "user",
            payload: {
              schemaVersion: 1,
              sourceThreadId: preview.sourceThreadId,
              sourceRunId: preview.sourceRunId,
              sourceMessageSeq: preview.sourceMessageSeq,
              branchFromSeq: preview.branchFromSeq,
              previewSha256: preview.previewSha256,
              sourcePromptSha256: preview.sourcePromptSha256,
              sourceRunConfigurationSha256:
                preview.sourceRunConfigurationSha256,
              sourcePromptVariableResolvedAt:
                preview.sourcePromptVariableResolvedAt,
              candidateWorkspaceSnapshotSha256:
                preview.candidateWorkspaceSnapshotSha256,
              sourceModel: `${preview.sourceModel.provider}/${preview.sourceModel.id}`,
              targetModel: `${preview.targetModel.provider}/${preview.targetModel.id}`,
              targetExecutionMode: preview.targetExecutionMode,
              toolResultMode: preview.toolResultMode,
              sourceReusableToolResultCount:
                preview.sourceReusableToolResultCount,
              sourceToolResultSetSha256: preview.sourceToolResultSetSha256,
            },
          });
          await emit(options.onEvent, event);
        },
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      const comparison = await createAgentMessageExperimentComparison({
        store: this.store,
        sourceRun: source.sourceRun,
        targetRun,
      });
      const toolResultReuse =
        toolResultReplay?.summary() ??
        liveToolResultReuseSummary(source.frozenToolResults);
      if (
        comparison.target.executionMode !== "agent_experiment_read_only" ||
        comparison.target.toolEffects.writeCount > 0 ||
        comparison.target.toolEffects.unknownCount > 0 ||
        comparison.target.toolEffects.unresolvedCount > 0
      ) {
        throw new Error(
          "Agent message experiment target exceeded its read-only boundary",
        );
      }
      const compared = await this.store.appendEvent({
        threadId: targetRun.threadId,
        runId: targetRun.id,
        type: "agent.experiment.compared",
        category: "model",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          sourceThreadId: preview.sourceThreadId,
          sourceRunId: preview.sourceRunId,
          sourceMessageSeq: preview.sourceMessageSeq,
          targetThreadId: targetRun.threadId,
          targetRunId: targetRun.id,
          previewSha256: preview.previewSha256,
          comparisonSha256: comparison.contentSha256,
          sourceStatus: comparison.source.status,
          targetStatus: comparison.target.status,
          outputChanged: comparison.outputChanged,
          durationMsDelta: comparison.metricDelta.durationMs,
          inputTokensDelta: comparison.metricDelta.inputTokens,
          outputTokensDelta: comparison.metricDelta.outputTokens,
          costUsdDelta: comparison.metricDelta.costUsd,
          toolCallCountDelta: comparison.metricDelta.toolCallCount,
          changedConfigurationFieldCount:
            comparison.configurationDelta.changedFields.length,
          toolResultMode: toolResultReuse.mode,
          sourceReusableToolResultCount: toolResultReuse.sourceResultCount,
          reusedToolResultCount: toolResultReuse.reusedResultCount,
          toolResultDivergenceCount: toolResultReuse.divergenceCount,
          toolResultReuseComplete: toolResultReuse.complete,
          sourceToolResultSetSha256: toolResultReuse.sourceResultSetSha256,
          targetToolResultReuseSetSha256: toolResultReuse.targetReuseSetSha256,
        },
      });
      await emit(options.onEvent, compared);
      return validateAgentMessageExperimentResult({
        kind: "napier.agent-message-experiment-result",
        schemaVersion: 2,
        preview,
        targetThreadId: targetRun.threadId,
        targetRunId: targetRun.id,
        status: targetRun.status,
        ...assistantText(
          await this.store.listEvents(targetRun.threadId),
          targetRun,
        ),
        toolResultReuse,
        comparison,
      });
    } catch (error) {
      const event = await this.store.appendEvent({
        threadId: branch.detail.thread.id,
        runId: targetRun?.id ?? branch.run.id ?? createId("runctl"),
        type: "agent.experiment.failed",
        category: "model",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          sourceThreadId: preview.sourceThreadId,
          sourceRunId: preview.sourceRunId,
          sourceMessageSeq: preview.sourceMessageSeq,
          targetThreadId: branch.detail.thread.id,
          ...(targetRun ? { targetRunId: targetRun.id } : {}),
          previewSha256: preview.previewSha256,
          diagnosticSha256: sha256(errorMessage(error)),
        },
      });
      await emit(options.onEvent, event);
      throw error;
    }
  }

  private project(
    sourceThreadId: string,
    request: CreateAgentMessageExperimentRequest,
  ): Promise<AgentMessageExperimentSource> {
    return projectAgentMessageExperimentSource(
      this.store,
      this.agents.toolInvocationResultCapsules,
      sourceThreadId,
      request,
    );
  }
}

function assistantText(
  events: RunEvent[],
  run: RunRecord,
): { assistantText?: string } {
  const text = [...events]
    .reverse()
    .find(
      (event) =>
        event.runId === run.id &&
        event.type === "message.assistant" &&
        record(event.payload)?.["role"] === "assistant" &&
        typeof record(event.payload)?.["text"] === "string",
    );
  const value = record(text?.payload)?.["text"];
  return typeof value === "string" ? { assistantText: value } : {};
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable experiment evidence survives a disconnected projection.
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

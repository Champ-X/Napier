import type {
  Api,
  AssistantMessage,
  Model,
  Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type {
  CreateModelInvocationExperimentRequest,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import {
  MODEL_INVOCATION_EXPERIMENT_EXECUTION,
  type ModelInvocationExperimentExecution,
} from "./model-invocation-experiment-execution.js";
import {
  createModelInvocationExperimentComparison,
  projectCandidateModelInvocation,
} from "./model-invocation-experiment-model.js";
import {
  validateCreateModelInvocationExperimentRequest,
  validateModelInvocationExperimentResult,
} from "./model-invocation-experiment-protocol.js";
import {
  projectModelInvocationExperimentSource,
  type ModelInvocationExperimentSource,
} from "./model-invocation-experiment-source.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";
import { createUsageAccounting } from "./token-accounting.js";

const RUN_LEASE_TTL_MS = 30_000;
const RUN_LEASE_HEARTBEAT_MS = 10_000;

export class ModelInvocationExperimentPreviewChangedError extends Error {
  constructor() {
    super("Model invocation experiment preview changed before execution");
    this.name = "ModelInvocationExperimentPreviewChangedError";
  }
}

export interface RunModelInvocationExperimentOptions {
  sourceThreadId: string;
  request: CreateModelInvocationExperimentRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onTargetCreated?: (thread: ThreadRecord) => Promise<void> | void;
}

export class ModelInvocationExperimentRuntime {
  private readonly workerId = createProcessLeaseOwnerId("modelexperiment");

  constructor(
    private readonly store: LocalStore,
    private readonly models: ModelRegistry,
    private readonly capsules: ModelInvocationCapsuleStore,
  ) {}

  async preview(
    sourceThreadId: string,
    request: CreateModelInvocationExperimentRequest,
    signal?: AbortSignal,
  ): Promise<ModelInvocationExperimentPreview> {
    signal?.throwIfAborted();
    const source = await this.project(sourceThreadId, request);
    await this.requireProviderModel(source.preview.targetModel);
    signal?.throwIfAborted();
    return source.preview;
  }

  async run(
    options: RunModelInvocationExperimentOptions,
  ): Promise<ModelInvocationExperimentResult> {
    options.signal?.throwIfAborted();
    const request = validateCreateModelInvocationExperimentRequest(
      options.request,
    );
    if (!request.expectedPreviewSha256) {
      throw new Error(
        "Model invocation experiment requires an expected preview hash",
      );
    }
    const source = await this.project(options.sourceThreadId, request);
    const preview = source.preview;
    if (request.expectedPreviewSha256 !== preview.previewSha256) {
      throw new ModelInvocationExperimentPreviewChangedError();
    }
    const targetModel = await this.requireProviderModel(preview.targetModel);
    options.signal?.throwIfAborted();
    const refreshed = await this.project(options.sourceThreadId, request);
    if (refreshed.preview.previewSha256 !== preview.previewSha256) {
      throw new ModelInvocationExperimentPreviewChangedError();
    }
    const targetThread = await this.store.createThread({
      title: source.title,
      agentId: preview.sourceAgentId,
    });
    await options.onTargetCreated?.(targetThread);
    return this.executeTarget({
      source,
      preview,
      targetModel,
      targetThread,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
  }

  private async executeTarget(input: {
    source: ModelInvocationExperimentSource;
    preview: ModelInvocationExperimentPreview;
    targetModel: Model<Api>;
    targetThread: ThreadRecord;
    signal?: AbortSignal;
    onEvent?: EventSink;
  }): Promise<ModelInvocationExperimentResult> {
    const execution = executionCapability(input.preview);
    const leased = await this.store.createLeasedRun(
      {
        threadId: input.targetThread.id,
        agentId: input.preview.sourceAgentId,
        agentRevision: input.preview.sourceAgentRevision,
        model: input.preview.targetModel,
        source: "model_experiment",
        executionMode: "model_experiment_single_call",
        [MODEL_INVOCATION_EXPERIMENT_EXECUTION]: execution,
      },
      { ownerId: this.workerId, ttlMs: RUN_LEASE_TTL_MS },
    );
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.store
        .renewRunLease(leased.run.id, leased.token, RUN_LEASE_TTL_MS)
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, RUN_LEASE_HEARTBEAT_MS);
    try {
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: {
            agentId: input.preview.sourceAgentId,
            agentRevision: input.preview.sourceAgentRevision,
            model: `${input.preview.targetModel.provider}/${input.preview.targetModel.id}`,
            source: "model_experiment",
            executionMode: input.preview.targetExecutionMode,
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        input.onEvent,
      );
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "model.experiment.started",
          category: "model",
          visibility: "user",
          payload: {
            schemaVersion: 1,
            sourceThreadId: input.preview.sourceThreadId,
            sourceRunId: input.preview.sourceRunId,
            sourceTurnIndex: input.preview.sourceTurnIndex,
            sourceCapsuleEventSeq: input.preview.sourceCapsuleEventSeq,
            sourceResponseEventSeq: input.preview.sourceResponseEventSeq,
            sourceContextEnvelopeSha256:
              input.preview.sourceContextEnvelopeSha256,
            sourceContextSha256: input.preview.sourceContextSha256,
            sourceCapsuleSha256: input.preview.sourceCapsuleSha256,
            previewSha256: input.preview.previewSha256,
            sourceModel: `${input.preview.sourceModel.provider}/${input.preview.sourceModel.id}`,
            targetModel: `${input.preview.targetModel.provider}/${input.preview.targetModel.id}`,
            targetExecutionMode: input.preview.targetExecutionMode,
          },
        },
        input.onEvent,
      );
      const targetEnvelope = createModelContextEnvelopeReceipt({
        turnIndex: 0,
        systemPrompt: input.source.capsule.context.systemPrompt ?? "",
        messages: input.source.capsule.context.messages,
        tools: input.source.capsule.context.tools ?? [],
      });
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "context.model_envelope",
          category: "model",
          visibility: "debug",
          payload: JSON.parse(JSON.stringify(targetEnvelope)),
        },
        input.onEvent,
      );
      const startedAtMs = Date.now();
      const message = await completeOnce(
        this.models,
        input.targetModel,
        input.source.capsule.context,
        input.source.capsule.options,
        controller.signal,
      );
      const finishedAtMs = Date.now();
      if (leaseLost) {
        throw new Error("Model invocation experiment Run lease was lost");
      }
      const candidate = projectCandidateModelInvocation({
        threadId: input.targetThread.id,
        runId: leased.run.id,
        model: input.preview.targetModel,
        message,
        startedAtMs,
        finishedAtMs,
      });
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "model.response",
          category: "model",
          visibility: "debug",
          payload: {
            ...candidate.responsePayload,
            modelCallPurpose: "model_invocation_experiment",
            modelContextEnvelopeSha256: targetEnvelope.contentSha256,
            modelContextEnvelopeTurnIndex: targetEnvelope.turnIndex,
            modelContextMessageSetSha256: targetEnvelope.messageSetSha256,
            modelContextToolDefinitionSetSha256:
              targetEnvelope.toolDefinitionSetSha256,
            usageAccounting: createUsageAccounting(
              input.preview.targetModel,
              candidate.observation.usage,
            ),
          },
        },
        input.onEvent,
      );
      const comparison = createModelInvocationExperimentComparison(
        input.source.sourceObservation,
        candidate.observation,
      );
      const result = validateModelInvocationExperimentResult({
        kind: "napier.model-invocation-experiment-result",
        schemaVersion: 1,
        preview: input.preview,
        targetThreadId: input.targetThread.id,
        targetRunId: leased.run.id,
        status: candidate.observation.status,
        ...(candidate.assistantText
          ? { assistantText: candidate.assistantText }
          : {}),
        candidateToolCallNames: candidate.toolCallNames,
        comparison,
      });
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "model.experiment.compared",
          category: "model",
          visibility: "user",
          payload: {
            schemaVersion: 1,
            sourceThreadId: input.preview.sourceThreadId,
            sourceRunId: input.preview.sourceRunId,
            sourceTurnIndex: input.preview.sourceTurnIndex,
            targetRunId: leased.run.id,
            status: result.status,
            outputChanged: comparison.outputChanged,
            textChanged: comparison.textChanged,
            toolCallDelta: comparison.metricDelta.toolCallCount,
            durationMsDelta: comparison.metricDelta.durationMs,
            costUsdDelta: comparison.metricDelta.costUsd,
            comparisonSha256: comparison.contentSha256,
            previewSha256: input.preview.previewSha256,
          },
        },
        input.onEvent,
      );
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type:
            result.status === "completed"
              ? "run.completed"
              : result.status === "cancelled"
                ? "run.cancelled"
                : "run.failed",
          category: "lifecycle",
          visibility: result.status === "completed" ? "debug" : "user",
          payload: { status: result.status },
        },
        input.onEvent,
      );
      await this.store.finishRun(leased.run.id, result.status, {
        usage: candidate.observation.usage,
        ...(result.status === "failed"
          ? { error: "Model invocation experiment provider call failed" }
          : {}),
        leaseToken: leased.token,
      });
      return result;
    } catch (error) {
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "model.experiment.failed",
          category: "model",
          visibility: "user",
          payload: {
            schemaVersion: 1,
            sourceRunId: input.preview.sourceRunId,
            sourceTurnIndex: input.preview.sourceTurnIndex,
            previewSha256: input.preview.previewSha256,
            diagnosticSha256: sha256(errorMessage(error)),
          },
        },
        input.onEvent,
      ).catch(() => undefined);
      await this.store
        .finishRun(leased.run.id, "failed", {
          error: "Model invocation experiment orchestration failed",
          leaseToken: leased.token,
        })
        .catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeat);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
  }

  private async project(
    sourceThreadId: string,
    request: CreateModelInvocationExperimentRequest,
  ): Promise<ModelInvocationExperimentSource> {
    return projectModelInvocationExperimentSource(
      this.store,
      this.capsules,
      sourceThreadId,
      request,
    );
  }

  private async requireProviderModel(model: {
    provider: string;
    id: string;
  }): Promise<Model<Api>> {
    const configured = await this.models.resolveConfigured(model);
    if (!configured) {
      throw new Error(
        "Model invocation experiments require a provider-backed model",
      );
    }
    return configured;
  }

  private async append(
    input: Parameters<LocalStore["appendEvent"]>[0],
    onEvent?: EventSink,
  ): Promise<RunEvent> {
    const event = await this.store.appendEvent(input);
    if (onEvent) {
      try {
        await onEvent(event);
      } catch {
        // A disconnected observer must not cancel durable model execution.
      }
    }
    return event;
  }
}

function executionCapability(
  preview: ModelInvocationExperimentPreview,
): ModelInvocationExperimentExecution {
  return {
    sourceThreadId: preview.sourceThreadId,
    sourceRunId: preview.sourceRunId,
    sourceTurnIndex: preview.sourceTurnIndex,
    sourceCapsuleEventSeq: preview.sourceCapsuleEventSeq,
    sourceResponseEventSeq: preview.sourceResponseEventSeq,
    sourceAgentRevision: preview.sourceAgentRevision,
    sourceContextEnvelopeSha256: preview.sourceContextEnvelopeSha256,
    sourceContextSha256: preview.sourceContextSha256,
    sourceCapsuleSha256: preview.sourceCapsuleSha256,
    targetModel: structuredClone(preview.targetModel),
    previewSha256: preview.previewSha256,
  };
}

async function completeOnce(
  models: ModelRegistry,
  model: Model<Api>,
  context: ModelInvocationExperimentSource["capsule"]["context"],
  options: ModelInvocationExperimentSource["capsule"]["options"],
  signal: AbortSignal,
): Promise<AssistantMessage> {
  try {
    return await models.models.completeSimple(model, context, {
      signal,
      ...(options.reasoning !== undefined
        ? { reasoning: options.reasoning }
        : {}),
      ...(options.maxTokens !== undefined
        ? { maxTokens: options.maxTokens }
        : {}),
      ...(options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options.cacheRetention !== undefined
        ? { cacheRetention: options.cacheRetention }
        : {}),
    });
  } catch (error) {
    return failedAssistantMessage(
      model,
      signal.aborted ? "aborted" : "error",
      errorMessage(error),
    );
  }
}

function failedAssistantMessage(
  model: Model<Api>,
  stopReason: "error" | "aborted",
  message: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyPiUsage(),
    stopReason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}

function emptyPiUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

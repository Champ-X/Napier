import type {
  CreateToolInvocationExperimentRequest,
  RunEvent,
  ThreadRecord,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
  ToolInvocationExperimentStatus,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import type { AgentRuntime } from "./agent-runtime.js";
import {
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import { sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  candidateToolInvocationObservation,
  createToolInvocationExperimentComparison,
  toolResultText,
} from "./tool-invocation-experiment-model.js";
import {
  appendToolExperimentComparison,
  appendToolExperimentTerminal,
  toolExperimentStartedPayload,
  toolResultDetails,
} from "./tool-invocation-experiment-ledger.js";
import {
  validateCreateToolInvocationExperimentRequest,
  validateToolInvocationExperimentResult,
} from "./tool-invocation-experiment-protocol.js";
import {
  TOOL_INVOCATION_EXPERIMENT_EXECUTION,
  type ToolInvocationExperimentExecution,
} from "./tool-invocation-experiment-execution.js";
import {
  projectToolInvocationExperimentSource,
  type ToolInvocationExperimentSource,
} from "./tool-invocation-experiment-source.js";
import { resolveToolInvocationExperimentTool } from "./tool-invocation-experiment-tool.js";
import type { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";
import type { LocalStore } from "./store.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface RunToolInvocationExperimentOptions {
  sourceThreadId: string;
  request: CreateToolInvocationExperimentRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onTargetCreated?: (thread: ThreadRecord) => Promise<void> | void;
}

export class ToolInvocationExperimentPreviewChangedError extends Error {
  constructor() {
    super("Tool invocation experiment preview changed");
    this.name = "ToolInvocationExperimentPreviewChangedError";
  }
}

export class ToolInvocationExperimentRuntime {
  private readonly workerId = createId("toolexperiment");

  constructor(
    private readonly store: LocalStore,
    private readonly runtime: AgentRuntime,
    private readonly capsules: ToolInvocationCapsuleStore,
  ) {}

  async preview(
    sourceThreadId: string,
    request: CreateToolInvocationExperimentRequest,
    signal?: AbortSignal,
  ): Promise<ToolInvocationExperimentPreview> {
    signal?.throwIfAborted();
    const source = await this.project(sourceThreadId, request);
    signal?.throwIfAborted();
    return source.preview;
  }

  async run(
    options: RunToolInvocationExperimentOptions,
  ): Promise<ToolInvocationExperimentResult> {
    options.signal?.throwIfAborted();
    const request = validateCreateToolInvocationExperimentRequest(
      options.request,
    );
    if (!request.expectedPreviewSha256) {
      throw new Error(
        "Tool invocation experiment requires an expected preview hash",
      );
    }
    const source = await this.project(options.sourceThreadId, request);
    if (request.expectedPreviewSha256 !== source.preview.previewSha256) {
      throw new ToolInvocationExperimentPreviewChangedError();
    }
    options.signal?.throwIfAborted();
    const refreshed = await this.project(options.sourceThreadId, request);
    if (refreshed.preview.previewSha256 !== source.preview.previewSha256) {
      throw new ToolInvocationExperimentPreviewChangedError();
    }
    const targetThread = await this.store.createThread({
      title: source.title,
      agentId: source.preview.sourceAgentId,
    });
    await options.onTargetCreated?.(targetThread);
    return this.executeTarget({
      source,
      targetThread,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
  }

  private project(
    sourceThreadId: string,
    request: CreateToolInvocationExperimentRequest,
  ): Promise<ToolInvocationExperimentSource> {
    return projectToolInvocationExperimentSource(
      this.store,
      this.runtime,
      this.capsules,
      sourceThreadId,
      request,
    );
  }

  private async executeTarget(input: {
    source: ToolInvocationExperimentSource;
    targetThread: ThreadRecord;
    signal?: AbortSignal;
    onEvent?: EventSink;
  }): Promise<ToolInvocationExperimentResult> {
    const { preview } = input.source;
    const execution = executionCapability(preview);
    const sourceModel = input.source.sourceRun.configuration!.model;
    const leased = await this.store.createLeasedRun(
      {
        threadId: input.targetThread.id,
        agentId: preview.sourceAgentId,
        agentRevision: preview.sourceAgentRevision,
        model: sourceModel,
        source: "tool_experiment",
        executionMode: "tool_experiment_read_only",
        [TOOL_INVOCATION_EXPERIMENT_EXECUTION]: execution,
      },
      { ownerId: this.workerId, ttlMs: RUN_LEASE_TTL_MS },
    );
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    let leaseLost = false;
    let toolStarted = false;
    let targetCallId: string | undefined;
    let startedAtMs = Date.now();
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
            agentId: preview.sourceAgentId,
            agentRevision: preview.sourceAgentRevision,
            model: `${sourceModel.provider}/${sourceModel.id}`,
            source: "tool_experiment",
            executionMode: preview.targetExecutionMode,
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        input.onEvent,
      );
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "tool.experiment.started",
          category: "tool",
          visibility: "user",
          payload: toolExperimentStartedPayload(preview),
        },
        input.onEvent,
      );
      controller.signal.throwIfAborted();
      const tool = resolveToolInvocationExperimentTool({
        store: this.store,
        runtime: this.runtime,
        agentId: preview.sourceAgentId,
        agentRevision: preview.sourceAgentRevision,
        threadId: input.targetThread.id,
        runId: leased.run.id,
        toolName: preview.sourceToolName,
        arguments: input.source.capsule.arguments,
        expectedDefinitionSha256: preview.sourceToolDefinitionSha256,
      });
      startedAtMs = Date.now();
      targetCallId = createId("toolcall");
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "tool.started",
          category: "tool",
          visibility: "user",
          payload: {
            callId: targetCallId,
            toolName: preview.sourceToolName,
            status: "started",
            effect: "read",
            sourceCallId: preview.sourceCallId,
            ...agentToolInputLedgerProjection(
              preview.sourceToolName,
              input.source.capsule.arguments,
            ),
          },
        },
        input.onEvent,
      );
      toolStarted = true;
      const toolResult = await tool.execute(
        targetCallId,
        input.source.capsule.arguments as never,
        controller.signal,
      );
      if (leaseLost) {
        throw new Error("Tool invocation experiment Run lease was lost");
      }
      const finishedAtMs = Date.now();
      const output = toolResultText(toolResult);
      const targetObservation = candidateToolInvocationObservation({
        threadId: input.targetThread.id,
        runId: leased.run.id,
        toolName: preview.sourceToolName,
        status: "completed",
        output,
        startedAtMs,
        finishedAtMs,
      });
      await this.append(
        {
          threadId: input.targetThread.id,
          runId: leased.run.id,
          type: "tool.completed",
          category: "tool",
          visibility: "user",
          payload: {
            callId: targetCallId,
            toolName: preview.sourceToolName,
            status: "completed",
            effect: "read",
            sourceCallId: preview.sourceCallId,
            outputTextSha256: targetObservation.outputSha256,
            outputTextBytes: targetObservation.outputBytes,
            ...agentToolOutputLedgerProjection(
              preview.sourceToolName,
              output,
              toolResult,
            ),
            ...(toolResultDetails(toolResult) !== undefined
              ? { details: toolResultDetails(toolResult)! }
              : {}),
          },
        },
        input.onEvent,
      );
      const comparison = createToolInvocationExperimentComparison(
        input.source.sourceObservation,
        targetObservation,
      );
      await appendToolExperimentComparison(
        this.store,
        input.targetThread.id,
        leased.run.id,
        preview,
        comparison,
        input.onEvent,
      );
      await appendToolExperimentTerminal(
        this.store,
        input.targetThread.id,
        leased.run.id,
        "completed",
        input.onEvent,
      );
      await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      return validateToolInvocationExperimentResult({
        kind: "napier.tool-invocation-experiment-result",
        schemaVersion: 1,
        preview,
        targetThreadId: input.targetThread.id,
        targetRunId: leased.run.id,
        status: "completed",
        ...(output ? { candidateOutput: output } : {}),
        comparison,
      });
    } catch (error) {
      const status: ToolInvocationExperimentStatus =
        controller.signal.aborted && !leaseLost ? "cancelled" : "failed";
      const finishedAtMs = Date.now();
      const targetObservation = candidateToolInvocationObservation({
        threadId: input.targetThread.id,
        runId: leased.run.id,
        toolName: preview.sourceToolName,
        status,
        output: "",
        startedAtMs,
        finishedAtMs,
      });
      if (toolStarted) {
        await this.append(
          {
            threadId: input.targetThread.id,
            runId: leased.run.id,
            type: "tool.failed",
            category: "tool",
            visibility: "user",
            payload: {
              callId: targetCallId!,
              toolName: preview.sourceToolName,
              status: "failed",
              effect: "read",
              sourceCallId: preview.sourceCallId,
              outputTextSha256: targetObservation.outputSha256,
              outputTextBytes: 0,
              diagnosticSha256: sha256(errorMessage(error)),
            },
          },
          input.onEvent,
        ).catch(() => undefined);
      }
      const comparison = createToolInvocationExperimentComparison(
        input.source.sourceObservation,
        targetObservation,
      );
      await appendToolExperimentComparison(
        this.store,
        input.targetThread.id,
        leased.run.id,
        preview,
        comparison,
        input.onEvent,
      ).catch(() => undefined);
      await appendToolExperimentTerminal(
        this.store,
        input.targetThread.id,
        leased.run.id,
        status,
        input.onEvent,
        error,
      ).catch(() => undefined);
      await this.store
        .finishRun(leased.run.id, status, {
          leaseToken: leased.token,
          ...(status === "failed" ? { error: errorMessage(error) } : {}),
        })
        .catch(() => undefined);
      return validateToolInvocationExperimentResult({
        kind: "napier.tool-invocation-experiment-result",
        schemaVersion: 1,
        preview,
        targetThreadId: input.targetThread.id,
        targetRunId: leased.run.id,
        status,
        comparison,
      });
    } finally {
      clearInterval(heartbeat);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
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
        // A disconnected observer must not cancel durable execution.
      }
    }
    return event;
  }
}

function executionCapability(
  preview: ToolInvocationExperimentPreview,
): ToolInvocationExperimentExecution {
  return {
    sourceThreadId: preview.sourceThreadId,
    sourceRunId: preview.sourceRunId,
    sourceAgentRevision: preview.sourceAgentRevision,
    sourceCallId: preview.sourceCallId,
    sourceCapsuleEventSeq: preview.sourceCapsuleEventSeq,
    sourceStartedEventSeq: preview.sourceStartedEventSeq,
    sourceTerminalEventSeq: preview.sourceTerminalEventSeq,
    sourceToolName: preview.sourceToolName,
    sourceToolDefinitionSha256: preview.sourceToolDefinitionSha256,
    sourceArgumentsSha256: preview.sourceArgumentsSha256,
    sourceWorkspaceScopeSha256: preview.sourceWorkspaceScopeSha256,
    sourceCapsuleSha256: preview.sourceCapsuleSha256,
    candidateWorkspaceSnapshotSha256: preview.candidateWorkspaceSnapshotSha256,
    executionMode: preview.targetExecutionMode,
    previewSha256: preview.previewSha256,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

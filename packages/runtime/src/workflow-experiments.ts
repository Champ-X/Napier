import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { createExecutionPlanWorkflowExperimentComparison } from "./workflow-experiment-comparison.js";
import {
  validateCreateExecutionPlanWorkflowExperimentRequest,
  validateExecutionPlanWorkflowExperimentPreview,
  validateExecutionPlanWorkflowExperimentResult,
} from "./workflow-experiment-protocol.js";
import { WORKFLOW_EXPERIMENT_EXECUTION } from "./workflow-experiment-execution.js";
import {
  projectExecutionPlanWorkflowExperimentSource,
  type ExecutionPlanWorkflowExperimentSource,
} from "./workflow-experiment-source.js";
import type { ExecutionPlanWorkflowRuntime } from "./workflow-runtime.js";

export type WorkflowExperimentConflictCode =
  | "confirmation_required"
  | "stale_preview";

export class WorkflowExperimentConflictError extends Error {
  constructor(
    readonly code: WorkflowExperimentConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowExperimentConflictError";
  }
}

export class WorkflowExperimentConfirmationRequiredError extends WorkflowExperimentConflictError {
  constructor(readonly preview: ExecutionPlanWorkflowExperimentPreview) {
    super(
      "confirmation_required",
      "Workflow experiment requires explicit confirmation of current side-effect evidence",
    );
    this.name = "WorkflowExperimentConfirmationRequiredError";
  }
}

export class WorkflowExperimentPreviewChangedError extends WorkflowExperimentConflictError {
  constructor() {
    super(
      "stale_preview",
      "Workflow experiment preview changed before execution",
    );
    this.name = "WorkflowExperimentPreviewChangedError";
  }
}

export interface RunExecutionPlanWorkflowExperimentOptions {
  sourceThreadId: string;
  request: CreateExecutionPlanWorkflowExperimentRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  onTargetCreated?: (thread: ThreadRecord) => Promise<void> | void;
}

export class ExecutionPlanWorkflowExperimentRuntime {
  constructor(
    private readonly store: LocalStore,
    private readonly workflows: ExecutionPlanWorkflowRuntime,
  ) {}

  async preview(
    sourceThreadId: string,
    request: CreateExecutionPlanWorkflowExperimentRequest,
    signal?: AbortSignal,
  ): Promise<ExecutionPlanWorkflowExperimentPreview> {
    signal?.throwIfAborted();
    const validated =
      validateCreateExecutionPlanWorkflowExperimentRequest(request);
    const source = await this.project(sourceThreadId, validated);
    signal?.throwIfAborted();
    return validateExecutionPlanWorkflowExperimentPreview(source.preview);
  }

  async run(
    options: RunExecutionPlanWorkflowExperimentOptions,
  ): Promise<ExecutionPlanWorkflowExperimentResult> {
    options.signal?.throwIfAborted();
    const request = validateCreateExecutionPlanWorkflowExperimentRequest(
      options.request,
    );
    const source = await this.project(options.sourceThreadId, request);
    const preview = validateExecutionPlanWorkflowExperimentPreview(
      source.preview,
    );
    if (
      request.expectedPreviewSha256 !== undefined &&
      request.expectedPreviewSha256 !== preview.previewSha256
    ) {
      throw new WorkflowExperimentPreviewChangedError();
    }
    if (
      preview.requiresSideEffectConfirmation &&
      (request.confirmSideEffects !== true ||
        request.expectedPreviewSha256 !== preview.previewSha256)
    ) {
      throw new WorkflowExperimentConfirmationRequiredError(preview);
    }
    options.signal?.throwIfAborted();
    const sourceThread = this.store.getThread(options.sourceThreadId);
    const target = await this.store.createThread({
      title:
        request.title ??
        defaultExperimentTitle(sourceThread.title, request.fromNodeId),
      agentId: source.sourceAgentId,
    });
    try {
      await options.onTargetCreated?.(target);
      const result = await this.workflows.run({
        threadId: target.id,
        request: {
          manifest: source.candidateManifest,
          input: source.sourceInput,
        },
        [WORKFLOW_EXPERIMENT_EXECUTION]: {
          agentRevision: source.sourceAgentRevision,
          reusedNodes: source.reusedNodes,
          lineage: {
            sourceThreadId: options.sourceThreadId,
            sourcePlanId: source.sourcePlan.id,
            sourcePlanRevision: source.sourcePlan.revision,
            sourceManifestSha256: request.manifest.contentSha256,
            fromNodeId: request.fromNodeId,
            reusedNodeIds: preview.reusedNodeIds,
            rerunNodeIds: preview.rerunNodeIds,
            previewSha256: preview.previewSha256,
            sideEffectsConfirmed:
              preview.requiresSideEffectConfirmation &&
              request.confirmSideEffects === true,
          },
        },
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      const comparison = await createExecutionPlanWorkflowExperimentComparison({
        store: this.store,
        preview,
        sourcePlan: source.sourcePlan,
        targetPlan: this.store.getPlan(result.planId),
        sourceManifest: request.manifest,
        candidateManifest: source.candidateManifest,
        targetResult: result,
      });
      const comparedEvent = await this.store.appendEvent({
        threadId: target.id,
        runId: createId("runctl"),
        type: "workflow.experiment.compared",
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          planId: result.planId,
          manifestSha256: source.candidateManifest.contentSha256,
          comparisonSha256: comparison.contentSha256,
          sourceStatus: comparison.sourceStatus,
          targetStatus: comparison.targetStatus,
          reusedNodeCount: comparison.reusedNodeCount,
          rerunNodeCount: comparison.rerunNodeCount,
          changedNodeCount: comparison.changedNodeIds.length,
          inputChange: comparison.inputChange,
          outputChange: comparison.outputChange,
          durationMsDelta: comparison.metricDelta.durationMs,
          inputTokensDelta: comparison.metricDelta.inputTokens,
          outputTokensDelta: comparison.metricDelta.outputTokens,
          costUsdDelta: comparison.metricDelta.costUsd,
          toolCallCountDelta: comparison.metricDelta.toolCallCount,
          evaluationCountDelta:
            comparison.targetEvaluations.total -
            comparison.sourceEvaluations.total,
          artifactCountDelta:
            comparison.targetArtifacts.total - comparison.sourceArtifacts.total,
        },
      });
      await emit(options.onEvent, comparedEvent);
      return validateExecutionPlanWorkflowExperimentResult({
        kind: "napier.execution-plan-workflow-experiment-result",
        schemaVersion: 1,
        preview,
        sourceManifest: structuredClone(request.manifest),
        candidateManifest: source.candidateManifest,
        targetThreadId: target.id,
        result,
        comparison,
      });
    } catch (error) {
      const targetPlan = this.store.listPlans(target.id).at(-1);
      const event = await this.store.appendEvent({
        threadId: target.id,
        runId: createId("runctl"),
        type: "workflow.experiment.failed",
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          ...(targetPlan ? { planId: targetPlan.id } : {}),
          manifestSha256: source.candidateManifest.contentSha256,
          sourceThreadId: options.sourceThreadId,
          sourcePlanId: source.sourcePlan.id,
          sourceManifestSha256: request.manifest.contentSha256,
          candidateManifestSha256: source.candidateManifest.contentSha256,
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
    request: CreateExecutionPlanWorkflowExperimentRequest,
  ): Promise<ExecutionPlanWorkflowExperimentSource> {
    return projectExecutionPlanWorkflowExperimentSource(
      this.store,
      sourceThreadId,
      request,
    );
  }
}

function defaultExperimentTitle(
  sourceTitle: string,
  fromNodeId: string,
): string {
  return `${sourceTitle} / experiment ${fromNodeId}`
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Experiment failure evidence remains durable if the stream disconnects.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

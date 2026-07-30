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

export class WorkflowExperimentConfirmationRequiredError extends Error {
  constructor(readonly preview: ExecutionPlanWorkflowExperimentPreview) {
    super(
      "Workflow experiment requires explicit confirmation of current side-effect evidence",
    );
    this.name = "WorkflowExperimentConfirmationRequiredError";
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

  preview(
    sourceThreadId: string,
    request: CreateExecutionPlanWorkflowExperimentRequest,
  ): Promise<ExecutionPlanWorkflowExperimentPreview> {
    const validated =
      validateCreateExecutionPlanWorkflowExperimentRequest(request);
    return this.project(sourceThreadId, validated).then((source) =>
      validateExecutionPlanWorkflowExperimentPreview(source.preview),
    );
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
      throw new Error("Workflow experiment preview changed before execution");
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
      return validateExecutionPlanWorkflowExperimentResult({
        kind: "napier.execution-plan-workflow-experiment-result",
        schemaVersion: 1,
        preview,
        sourceManifest: structuredClone(request.manifest),
        candidateManifest: source.candidateManifest,
        targetThreadId: target.id,
        result,
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

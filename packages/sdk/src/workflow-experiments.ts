import type {
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  JsonValue,
  ModelRef,
  RunEvent,
} from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime";

import type { NapierWorkflow } from "./workflow.js";

export interface PreviewNapierWorkflowExperimentOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  sourceThreadId: string;
  sourcePlanId: string;
  fromNodeId?: string;
  mode?: ExecutionPlanWorkflowExperimentMode;
  simulatedOutput?: JsonValue;
  replacementInput?: JsonValue;
  replacementWorkflowInput?: TInput;
  title?: string;
  modelOverrides?: Record<string, ModelRef>;
  signal?: AbortSignal;
}

export interface RunNapierWorkflowExperimentOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> extends PreviewNapierWorkflowExperimentOptions<TInput, TOutput> {
  expectedPreviewSha256: string;
  confirmSideEffects?: boolean;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export async function previewNapierWorkflowExperiment<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(
  services: LocalAgentRuntimeServices,
  options: PreviewNapierWorkflowExperimentOptions<TInput, TOutput>,
  signal: AbortSignal,
): Promise<ExecutionPlanWorkflowExperimentPreview> {
  return structuredClone(
    await services.workflowExperiments.preview(
      options.sourceThreadId,
      workflowExperimentRequest(options),
      signal,
    ),
  );
}

export async function runNapierWorkflowExperiment<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(
  services: LocalAgentRuntimeServices,
  options: RunNapierWorkflowExperimentOptions<TInput, TOutput>,
  signal: AbortSignal,
): Promise<ExecutionPlanWorkflowExperimentResult> {
  if (!/^[a-f0-9]{64}$/u.test(options.expectedPreviewSha256)) {
    throw new Error(
      "Workflow experiment execution requires a valid expected preview hash",
    );
  }
  return structuredClone(
    await services.workflowExperiments.run({
      sourceThreadId: options.sourceThreadId,
      request: {
        ...workflowExperimentRequest(options),
        expectedPreviewSha256: options.expectedPreviewSha256,
        ...(options.confirmSideEffects ? { confirmSideEffects: true } : {}),
      },
      signal,
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    }),
  );
}

function workflowExperimentRequest<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(options: PreviewNapierWorkflowExperimentOptions<TInput, TOutput>) {
  return {
    manifest: options.workflow.manifest,
    planId: options.sourcePlanId,
    ...(options.fromNodeId !== undefined
      ? { fromNodeId: options.fromNodeId }
      : {}),
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.simulatedOutput !== undefined
      ? { simulatedOutput: options.simulatedOutput }
      : {}),
    ...(options.replacementInput !== undefined
      ? { replacementInput: options.replacementInput }
      : {}),
    ...(options.replacementWorkflowInput !== undefined
      ? { replacementWorkflowInput: options.replacementWorkflowInput }
      : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.modelOverrides !== undefined
      ? { modelOverrides: options.modelOverrides }
      : {}),
  };
}

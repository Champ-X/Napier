import type {
  ExecutionPlanWorkflowManifest,
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";
import type { DefineEmbeddedWorkflowInput } from "@napier/runtime";

declare const workflowInputType: unique symbol;
declare const workflowOutputType: unique symbol;

export interface NapierWorkflow<
  TInput extends JsonValue = JsonValue,
  TOutput extends JsonValue = JsonValue,
> {
  readonly manifest: ExecutionPlanWorkflowManifest;
  readonly sourceThreadId: string;
  readonly sourcePlanId: string;
  readonly [workflowInputType]?: TInput;
  readonly [workflowOutputType]?: TOutput;
}

export type DefineNapierWorkflowInput<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> = Omit<DefineEmbeddedWorkflowInput, "inputSchema" | "outputSchema"> & {
  inputSchema: WorkflowValueSchema;
  outputSchema: WorkflowValueSchema;
  readonly [workflowInputType]?: TInput;
  readonly [workflowOutputType]?: TOutput;
};

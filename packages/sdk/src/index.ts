import type { JsonValue } from "@napier/contracts";
import {
  createLocalAgentRuntime,
} from "@napier/runtime/agent";
import {
  validateExecutionPlanWorkflowManifest,
} from "@napier/runtime/workflow";

import type { NapierClient, NapierClientOptions } from "./client-types.js";
import { LocalNapierClient, workflowHandle } from "./local-client.js";
import type { NapierWorkflow } from "./workflow.js";

export type {
  PreviewNapierAgentMessageExperimentOptions,
  RunNapierAgentMessageExperimentOptions,
} from "./agent-message-experiments.js";
export type {
  AnswerNapierWorkflowApprovalOptions,
  NapierAgentExecution,
  NapierClient,
  NapierClientOptions,
  NapierWorkflowApprovalExecution,
  NapierWorkflowExecution,
  ResumeNapierAgentOptions,
  ResumeNapierWorkflowOptions,
  RunNapierAgentOptions,
  RunNapierWorkflowOptions,
} from "./client-types.js";
export type {
  PreviewNapierModelInvocationExperimentOptions,
  RunNapierModelInvocationExperimentOptions,
} from "./model-invocation-experiments.js";
export type {
  PreviewNapierToolInvocationExperimentOptions,
  RunNapierToolInvocationExperimentOptions,
} from "./tool-invocation-experiments.js";
export type {
  PreviewNapierWorkflowExperimentOptions,
  RunNapierWorkflowExperimentOptions,
} from "./workflow-experiments.js";
export type { DefineNapierWorkflowInput, NapierWorkflow } from "./workflow.js";

export async function createNapierClient(
  options: NapierClientOptions = {},
): Promise<NapierClient> {
  return new LocalNapierClient(await createLocalAgentRuntime(options));
}

export function loadNapierWorkflow<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(input: unknown): NapierWorkflow<TInput, TOutput> {
  return workflowHandle<TInput, TOutput>(
    validateExecutionPlanWorkflowManifest(input),
  );
}

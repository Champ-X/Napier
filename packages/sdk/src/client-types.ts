import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  ExecutionPlanWorkflowResult,
  JsonValue,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  ModelRef,
  OperatorDecision,
  RunEvent,
  RunRecord,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
} from "@napier/contracts";
import type { LocalAgentRuntimeOptions } from "@napier/runtime/agent";

import type {
  PreviewNapierAgentMessageExperimentOptions,
  RunNapierAgentMessageExperimentOptions,
} from "./agent-message-experiments.js";
import type {
  PreviewNapierModelInvocationExperimentOptions,
  RunNapierModelInvocationExperimentOptions,
} from "./model-invocation-experiments.js";
import type {
  PreviewNapierToolInvocationExperimentOptions,
  RunNapierToolInvocationExperimentOptions,
} from "./tool-invocation-experiments.js";
import type {
  PreviewNapierWorkflowExperimentOptions,
  RunNapierWorkflowExperimentOptions,
} from "./workflow-experiments.js";
import type { DefineNapierWorkflowInput, NapierWorkflow } from "./workflow.js";

export interface RunNapierAgentOptions {
  prompt: string;
  threadId?: string;
  agentId?: string;
  title?: string;
  model?: ModelRef;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface ResumeNapierAgentOptions {
  threadId: string;
  runId?: string;
  model?: ModelRef;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface NapierAgentExecution {
  threadId: string;
  runId: string;
  status: RunRecord["status"];
  assistantText?: string;
  run: RunRecord;
}

export interface RunNapierWorkflowOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  input: TInput;
  breakBeforeNodeIds?: string[];
  threadId?: string;
  agentId?: string;
  title?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface ResumeNapierWorkflowOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  threadId: string;
  planId: string;
  retryBlocked?: boolean;
  continueBreakpoint?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface AnswerNapierWorkflowApprovalOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  threadId: string;
  planId: string;
  decisionId: string;
  expectedDecisionSha256: string;
  selectedOptionIds: ["option_1" | "option_2"];
  customText?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface NapierWorkflowExecution<TOutput extends JsonValue> {
  threadId: string;
  planId: string;
  status: ExecutionPlanWorkflowResult["status"];
  output?: TOutput;
  breakpoint?: ExecutionPlanWorkflowBreakpoint;
  result: ExecutionPlanWorkflowResult;
  pendingDecision?: OperatorDecision;
}

export interface NapierWorkflowApprovalExecution<
  TOutput extends JsonValue,
> extends NapierWorkflowExecution<TOutput> {
  decision: OperatorDecision;
}

export type NapierClientOptions = LocalAgentRuntimeOptions;

export interface NapierClient {
  runAgent(options: RunNapierAgentOptions): Promise<NapierAgentExecution>;
  resumeAgent(options: ResumeNapierAgentOptions): Promise<NapierAgentExecution>;
  previewAgentMessageExperiment(
    options: PreviewNapierAgentMessageExperimentOptions,
  ): Promise<AgentMessageExperimentPreview>;
  runAgentMessageExperiment(
    options: RunNapierAgentMessageExperimentOptions,
  ): Promise<AgentMessageExperimentResult>;
  previewModelInvocationExperiment(
    options: PreviewNapierModelInvocationExperimentOptions,
  ): Promise<ModelInvocationExperimentPreview>;
  runModelInvocationExperiment(
    options: RunNapierModelInvocationExperimentOptions,
  ): Promise<ModelInvocationExperimentResult>;
  previewToolInvocationExperiment(
    options: PreviewNapierToolInvocationExperimentOptions,
  ): Promise<ToolInvocationExperimentPreview>;
  runToolInvocationExperiment(
    options: RunNapierToolInvocationExperimentOptions,
  ): Promise<ToolInvocationExperimentResult>;
  defineWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    definition: DefineNapierWorkflowInput<TInput, TOutput>,
  ): Promise<NapierWorkflow<TInput, TOutput>>;
  runWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: RunNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>>;
  resumeWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: ResumeNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>>;
  answerWorkflowApproval<TInput extends JsonValue, TOutput extends JsonValue>(
    options: AnswerNapierWorkflowApprovalOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowApprovalExecution<TOutput>>;
  previewWorkflowExperiment<
    TInput extends JsonValue,
    TOutput extends JsonValue,
  >(
    options: PreviewNapierWorkflowExperimentOptions<TInput, TOutput>,
  ): Promise<ExecutionPlanWorkflowExperimentPreview>;
  runWorkflowExperiment<TInput extends JsonValue, TOutput extends JsonValue>(
    options: RunNapierWorkflowExperimentOptions<TInput, TOutput>,
  ): Promise<ExecutionPlanWorkflowExperimentResult>;
  close(): Promise<void>;
}

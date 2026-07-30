import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";

export interface WorkflowExecutionContext {
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  input: JsonValue;
  agentId: string;
  agentRevision: number;
  plan: ExecutionPlan;
  resumed: boolean;
  retryBlocked: boolean;
  onEvent?: EventSink;
  signal?: AbortSignal;
  outputs: Map<string, JsonValue>;
  nodeResults: Map<string, ExecutionPlanWorkflowNodeResult>;
}

export interface WorkflowNodeFailure {
  runId?: string;
  inputSha256: string;
  attempt: number;
  errorCode: string;
  diagnosticSha256: string;
}

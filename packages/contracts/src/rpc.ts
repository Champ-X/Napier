import type {
  AnswerOperatorDecisionRequest,
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowStatus,
  JsonValue,
  ModelRef,
  OperatorDecision,
  RunEvent,
  RunRecord,
  RunStatus,
} from "./index.js";

export const NAPIER_RPC_PROTOCOL_VERSION = 1;

export type NapierRpcId = string | number;

export interface NapierRpcInitializeParams {
  clientInfo?: {
    name: string;
    version?: string;
  };
}

export interface NapierRpcAgentRunParams {
  prompt: string;
  threadId?: string;
  agentId?: string;
  title?: string;
  model?: ModelRef;
}

export interface NapierRpcAgentResumeParams {
  threadId: string;
  runId?: string;
  model?: ModelRef;
}

export interface NapierRpcWorkflowRunParams {
  manifest: ExecutionPlanWorkflowManifest;
  input: JsonValue;
  threadId?: string;
  agentId?: string;
  title?: string;
}

export interface NapierRpcWorkflowResumeParams {
  manifest: ExecutionPlanWorkflowManifest;
  threadId: string;
  planId: string;
  retryBlocked?: boolean;
}

export interface NapierRpcWorkflowApprovalAnswerParams {
  manifest: ExecutionPlanWorkflowManifest;
  threadId: string;
  planId: string;
  decisionId: string;
  expectedDecisionSha256: string;
  answer: Omit<AnswerOperatorDecisionRequest, "selectedOptionIds"> & {
    selectedOptionIds: ["option_1" | "option_2"];
  };
}

export interface NapierRpcWorkflowExperimentPreviewParams extends Omit<
  CreateExecutionPlanWorkflowExperimentRequest,
  "confirmSideEffects" | "expectedPreviewSha256"
> {
  sourceThreadId: string;
}

export interface NapierRpcWorkflowExperimentRunParams extends Omit<
  CreateExecutionPlanWorkflowExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
  expectedPreviewSha256: string;
}

export type NapierRpcRequest =
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "initialize";
      params?: NapierRpcInitializeParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/agent/run";
      params: NapierRpcAgentRunParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/agent/resume";
      params: NapierRpcAgentResumeParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/workflow/run";
      params: NapierRpcWorkflowRunParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/workflow/resume";
      params: NapierRpcWorkflowResumeParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/workflow/answer";
      params: NapierRpcWorkflowApprovalAnswerParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/workflow/experiment/preview";
      params: NapierRpcWorkflowExperimentPreviewParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/workflow/experiment/run";
      params: NapierRpcWorkflowExperimentRunParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "shutdown";
    };

export type NapierRpcClientNotification =
  | {
      jsonrpc: "2.0";
      method: "$/cancelRequest";
      params: { id: NapierRpcId };
    }
  | {
      jsonrpc: "2.0";
      method: "exit";
    };

export interface NapierRpcEventNotification {
  jsonrpc: "2.0";
  method: "napier/event";
  params: {
    requestId: NapierRpcId;
    event: RunEvent;
    eventSha256: string;
  };
}

export interface NapierRpcInitializeResult {
  protocolVersion: typeof NAPIER_RPC_PROTOCOL_VERSION;
  serverInfo: {
    name: "napier";
    version: string;
  };
  capabilities: {
    agentRun: true;
    agentResume: true;
    workflowRun: true;
    workflowResume: true;
    workflowApprovalAnswer: true;
    workflowExperimentPreview: true;
    workflowExperimentRun: true;
    eventNotifications: true;
    requestCancellation: true;
    maxConcurrentRequests: number;
  };
}

export interface NapierRpcAgentExecution {
  threadId: string;
  runId: string;
  status: RunStatus;
  assistantText?: string;
  run: RunRecord;
}

export interface NapierRpcWorkflowExecution {
  threadId: string;
  planId: string;
  status: ExecutionPlanWorkflowStatus;
  output?: JsonValue;
  result: ExecutionPlanWorkflowResult;
  pendingDecision?: OperatorDecision;
}

export interface NapierRpcWorkflowApprovalExecution extends NapierRpcWorkflowExecution {
  decision: OperatorDecision;
}

export interface NapierRpcWorkflowExperimentExecution {
  sourceThreadId: string;
  sourcePlanId: string;
  targetThreadId: string;
  targetPlanId: string;
  status: ExecutionPlanWorkflowStatus;
  previewSha256: string;
  candidateManifestSha256: string;
  experiment: ExecutionPlanWorkflowExperimentResult;
}

export interface NapierRpcSuccessResponse<TResult> {
  jsonrpc: "2.0";
  id: NapierRpcId;
  result: TResult;
}

export interface NapierRpcErrorResponse {
  jsonrpc: "2.0";
  id: NapierRpcId | null;
  error: {
    code: number;
    message: string;
    data?: {
      diagnosticSha256: string;
    };
  };
}

export type NapierRpcResponse =
  | NapierRpcSuccessResponse<NapierRpcInitializeResult>
  | NapierRpcSuccessResponse<NapierRpcAgentExecution>
  | NapierRpcSuccessResponse<NapierRpcWorkflowExecution>
  | NapierRpcSuccessResponse<NapierRpcWorkflowApprovalExecution>
  | NapierRpcSuccessResponse<ExecutionPlanWorkflowExperimentPreview>
  | NapierRpcSuccessResponse<NapierRpcWorkflowExperimentExecution>
  | NapierRpcSuccessResponse<null>
  | NapierRpcErrorResponse;

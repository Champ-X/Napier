import type {
  AnswerOperatorDecisionRequest,
  JsonValue,
  ModelRef,
  OperatorDecision,
  RunEvent,
  RunStatus,
  TerminalRunStatus,
} from "./execution-core.js";
import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  CreateAgentMessageExperimentRequest,
  CreateModelInvocationExperimentRequest,
  CreateToolInvocationExperimentRequest,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
} from "./execution-experiments.js";
import type { RunRecord } from "./execution-runs.js";
import type {
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowStatus,
} from "./execution-workflows.js";
import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
} from "./workflow-experiments.js";

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

export interface NapierRpcAgentMessageExperimentPreviewParams extends Omit<
  CreateAgentMessageExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
}

export interface NapierRpcAgentMessageExperimentRunParams extends Omit<
  CreateAgentMessageExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
  expectedPreviewSha256: string;
}

export interface NapierRpcModelInvocationExperimentPreviewParams extends Omit<
  CreateModelInvocationExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
}

export interface NapierRpcModelInvocationExperimentRunParams extends Omit<
  CreateModelInvocationExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
  expectedPreviewSha256: string;
}

export interface NapierRpcToolInvocationExperimentPreviewParams extends Omit<
  CreateToolInvocationExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
}

export interface NapierRpcToolInvocationExperimentRunParams extends Omit<
  CreateToolInvocationExperimentRequest,
  "expectedPreviewSha256"
> {
  sourceThreadId: string;
  expectedPreviewSha256: string;
}

export interface NapierRpcWorkflowRunParams {
  manifest: ExecutionPlanWorkflowManifest;
  input: JsonValue;
  breakBeforeNodeIds?: string[];
  threadId?: string;
  agentId?: string;
  title?: string;
}

export interface NapierRpcWorkflowResumeParams {
  manifest: ExecutionPlanWorkflowManifest;
  threadId: string;
  planId: string;
  retryBlocked?: boolean;
  continueBreakpoint?: boolean;
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
      method: "napier/agent/experiment/preview";
      params: NapierRpcAgentMessageExperimentPreviewParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/agent/experiment/run";
      params: NapierRpcAgentMessageExperimentRunParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/model/experiment/preview";
      params: NapierRpcModelInvocationExperimentPreviewParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/model/experiment/run";
      params: NapierRpcModelInvocationExperimentRunParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/tool/experiment/preview";
      params: NapierRpcToolInvocationExperimentPreviewParams;
    }
  | {
      jsonrpc: "2.0";
      id: NapierRpcId;
      method: "napier/tool/experiment/run";
      params: NapierRpcToolInvocationExperimentRunParams;
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
    agentMessageExperimentPreview: true;
    agentMessageExperimentRun: true;
    modelInvocationExperimentPreview: true;
    modelInvocationExperimentRun: true;
    toolInvocationExperimentPreview: true;
    toolInvocationExperimentRun: true;
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

export interface NapierRpcAgentMessageExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  targetThreadId: string;
  targetRunId: string;
  status: TerminalRunStatus;
  previewSha256: string;
  experiment: AgentMessageExperimentResult;
}

export interface NapierRpcModelInvocationExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceTurnIndex: number;
  targetThreadId: string;
  targetRunId: string;
  status: TerminalRunStatus;
  previewSha256: string;
  experiment: ModelInvocationExperimentResult;
}

export interface NapierRpcToolInvocationExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceCallId: string;
  targetThreadId: string;
  targetRunId: string;
  status: TerminalRunStatus;
  previewSha256: string;
  experiment: ToolInvocationExperimentResult;
}

export interface NapierRpcWorkflowExecution {
  threadId: string;
  planId: string;
  status: ExecutionPlanWorkflowStatus;
  output?: JsonValue;
  breakpoint?: ExecutionPlanWorkflowBreakpoint;
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
  | NapierRpcSuccessResponse<AgentMessageExperimentPreview>
  | NapierRpcSuccessResponse<NapierRpcAgentMessageExperimentExecution>
  | NapierRpcSuccessResponse<ModelInvocationExperimentPreview>
  | NapierRpcSuccessResponse<NapierRpcModelInvocationExperimentExecution>
  | NapierRpcSuccessResponse<ToolInvocationExperimentPreview>
  | NapierRpcSuccessResponse<NapierRpcToolInvocationExperimentExecution>
  | NapierRpcSuccessResponse<NapierRpcWorkflowExecution>
  | NapierRpcSuccessResponse<NapierRpcWorkflowApprovalExecution>
  | NapierRpcSuccessResponse<ExecutionPlanWorkflowExperimentPreview>
  | NapierRpcSuccessResponse<NapierRpcWorkflowExperimentExecution>
  | NapierRpcSuccessResponse<null>
  | NapierRpcErrorResponse;

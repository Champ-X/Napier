import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowStatus,
  JsonValue,
  ModelRef,
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
  | NapierRpcSuccessResponse<null>
  | NapierRpcErrorResponse;

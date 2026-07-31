import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  ExecutionPlanWorkflowExperimentPreview,
  NapierRpcAgentMessageExperimentExecution,
  NapierRpcAgentExecution,
  NapierRpcModelInvocationExperimentExecution,
  NapierRpcToolInvocationExperimentExecution,
  NapierRpcWorkflowExperimentExecution,
  NapierRpcWorkflowExecution,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
  RunEvent,
} from "@napier/contracts";
import type {
  EmbeddedAgentService,
  EmbeddedWorkflowService,
  AgentMessageExperimentRuntime,
  ExecutionPlanWorkflowExperimentRuntime,
  ModelInvocationExperimentRuntime,
  ToolInvocationExperimentRuntime,
} from "@napier/runtime";
import {
  AgentMessageExperimentPreviewChangedError,
  EmbeddedWorkflowApprovalError,
  ModelInvocationExperimentPreviewChangedError,
  ToolInvocationExperimentPreviewChangedError,
  streamEventFrame,
  WorkflowExperimentConflictError,
} from "@napier/runtime";

import {
  parseAgentMessageExperimentPreviewParams,
  parseAgentMessageExperimentRunParams,
} from "./rpc-agent-message-experiments.js";
import {
  parseModelInvocationExperimentPreviewParams,
  parseModelInvocationExperimentRunParams,
} from "./rpc-model-invocation-experiments.js";
import {
  parseToolInvocationExperimentPreviewParams,
  parseToolInvocationExperimentRunParams,
} from "./rpc-tool-invocation-experiments.js";
import {
  parseAgentResumeParams,
  parseAgentRunParams,
  parseWorkflowApprovalAnswerParams,
  parseWorkflowResumeParams,
  parseWorkflowRunParams,
  rpcError,
  rpcSuccess,
  type JsonRpcRequest,
} from "./rpc-protocol.js";
import {
  parseWorkflowExperimentPreviewParams,
  parseWorkflowExperimentRunParams,
} from "./rpc-workflow-experiments.js";
import type { RpcOutputWriter } from "./rpc-transport.js";

export interface RpcInvocationServices {
  agents: Pick<EmbeddedAgentService, "run" | "resume">;
  workflows: Pick<
    EmbeddedWorkflowService,
    "run" | "resume" | "answerAndResume"
  >;
  experiments: Pick<ExecutionPlanWorkflowExperimentRuntime, "preview" | "run">;
  agentExperiments: Pick<AgentMessageExperimentRuntime, "preview" | "run">;
  modelExperiments: Pick<ModelInvocationExperimentRuntime, "preview" | "run">;
  toolExperiments: Pick<ToolInvocationExperimentRuntime, "preview" | "run">;
}

interface RpcInvocationOutcome {
  cancelled: boolean;
  returnCancelledResult?: boolean;
  result:
    | NapierRpcAgentExecution
    | AgentMessageExperimentPreview
    | NapierRpcAgentMessageExperimentExecution
    | ModelInvocationExperimentPreview
    | NapierRpcModelInvocationExperimentExecution
    | ToolInvocationExperimentPreview
    | NapierRpcToolInvocationExperimentExecution
    | NapierRpcWorkflowExecution
    | ExecutionPlanWorkflowExperimentPreview
    | NapierRpcWorkflowExperimentExecution;
}

type RpcInvocation = (
  signal: AbortSignal,
  onEvent: (event: RunEvent) => Promise<void>,
) => Promise<RpcInvocationOutcome>;

const INVOCATION_METHODS = new Set([
  "napier/agent/run",
  "napier/agent/resume",
  "napier/agent/experiment/preview",
  "napier/agent/experiment/run",
  "napier/model/experiment/preview",
  "napier/model/experiment/run",
  "napier/tool/experiment/preview",
  "napier/tool/experiment/run",
  "napier/workflow/run",
  "napier/workflow/resume",
  "napier/workflow/answer",
  "napier/workflow/experiment/preview",
  "napier/workflow/experiment/run",
]);

export function isRpcInvocationMethod(method: string): boolean {
  return INVOCATION_METHODS.has(method);
}

export function prepareRpcInvocation(
  services: RpcInvocationServices,
  request: JsonRpcRequest,
): RpcInvocation {
  if (request.method === "napier/agent/run") {
    const params = parseAgentRunParams(request.params);
    return async (signal, onEvent) => {
      const execution = await services.agents.run({
        ...params,
        signal,
        onEvent,
      });
      return {
        cancelled: execution.run.status === "cancelled",
        result: {
          threadId: execution.threadId,
          runId: execution.run.id,
          status: execution.run.status,
          ...(execution.assistantText !== undefined
            ? { assistantText: execution.assistantText }
            : {}),
          run: execution.run,
        },
      };
    };
  }
  if (request.method === "napier/agent/resume") {
    const params = parseAgentResumeParams(request.params);
    return async (signal, onEvent) => {
      const execution = await services.agents.resume({
        ...params,
        signal,
        onEvent,
      });
      return {
        cancelled: execution.run.status === "cancelled",
        result: {
          threadId: execution.threadId,
          runId: execution.run.id,
          status: execution.run.status,
          ...(execution.assistantText !== undefined
            ? { assistantText: execution.assistantText }
            : {}),
          run: execution.run,
        },
      };
    };
  }
  if (request.method === "napier/agent/experiment/preview") {
    const { sourceThreadId, ...experimentRequest } =
      parseAgentMessageExperimentPreviewParams(request.params);
    return async (signal) => ({
      cancelled: false,
      result: await services.agentExperiments.preview(
        sourceThreadId,
        experimentRequest,
        signal,
      ),
    });
  }
  if (request.method === "napier/agent/experiment/run") {
    const { sourceThreadId, ...experimentRequest } =
      parseAgentMessageExperimentRunParams(request.params);
    return async (signal, onEvent) => {
      const experiment = await services.agentExperiments.run({
        sourceThreadId,
        request: experimentRequest,
        signal,
        onEvent,
      });
      return {
        cancelled: experiment.status === "cancelled",
        returnCancelledResult: experiment.status === "cancelled",
        result: agentMessageExperimentExecution(experiment),
      };
    };
  }
  if (request.method === "napier/model/experiment/preview") {
    const { sourceThreadId, ...experimentRequest } =
      parseModelInvocationExperimentPreviewParams(request.params);
    return async (signal) => ({
      cancelled: false,
      result: await services.modelExperiments.preview(
        sourceThreadId,
        experimentRequest,
        signal,
      ),
    });
  }
  if (request.method === "napier/model/experiment/run") {
    const { sourceThreadId, ...experimentRequest } =
      parseModelInvocationExperimentRunParams(request.params);
    return async (signal, onEvent) => {
      const experiment = await services.modelExperiments.run({
        sourceThreadId,
        request: experimentRequest,
        signal,
        onEvent,
      });
      return {
        cancelled: experiment.status === "cancelled",
        returnCancelledResult: experiment.status === "cancelled",
        result: modelInvocationExperimentExecution(experiment),
      };
    };
  }
  if (request.method === "napier/tool/experiment/preview") {
    const { sourceThreadId, ...experimentRequest } =
      parseToolInvocationExperimentPreviewParams(request.params);
    return async (signal) => ({
      cancelled: false,
      result: await services.toolExperiments.preview(
        sourceThreadId,
        experimentRequest,
        signal,
      ),
    });
  }
  if (request.method === "napier/tool/experiment/run") {
    const { sourceThreadId, ...experimentRequest } =
      parseToolInvocationExperimentRunParams(request.params);
    return async (signal, onEvent) => {
      const experiment = await services.toolExperiments.run({
        sourceThreadId,
        request: experimentRequest,
        signal,
        onEvent,
      });
      return {
        cancelled: experiment.status === "cancelled",
        returnCancelledResult: experiment.status === "cancelled",
        result: toolInvocationExperimentExecution(experiment),
      };
    };
  }
  if (request.method === "napier/workflow/run") {
    const params = parseWorkflowRunParams(request.params);
    return async (signal, onEvent) => {
      const execution = await services.workflows.run({
        ...params,
        signal,
        onEvent,
      });
      return workflowOutcome(
        execution.threadId,
        execution.result,
        execution.pendingDecision,
      );
    };
  }
  if (request.method === "napier/workflow/resume") {
    const params = parseWorkflowResumeParams(request.params);
    return async (signal, onEvent) => {
      const execution = await services.workflows.resume({
        ...params,
        signal,
        onEvent,
      });
      return workflowOutcome(
        execution.threadId,
        execution.result,
        execution.pendingDecision,
      );
    };
  }
  if (request.method === "napier/workflow/answer") {
    const params = parseWorkflowApprovalAnswerParams(request.params);
    return async (signal, onEvent) => {
      const execution = await services.workflows.answerAndResume({
        ...params,
        signal,
        onEvent,
      });
      const outcome = workflowOutcome(
        execution.threadId,
        execution.result,
        execution.pendingDecision,
      );
      return {
        ...outcome,
        result: {
          ...outcome.result,
          decision: execution.decision,
        },
      };
    };
  }
  if (request.method === "napier/workflow/experiment/preview") {
    const { sourceThreadId, ...experimentRequest } =
      parseWorkflowExperimentPreviewParams(request.params);
    return async (signal) => ({
      cancelled: false,
      result: await services.experiments.preview(
        sourceThreadId,
        experimentRequest,
        signal,
      ),
    });
  }
  if (request.method === "napier/workflow/experiment/run") {
    const { sourceThreadId, ...experimentRequest } =
      parseWorkflowExperimentRunParams(request.params);
    return async (signal, onEvent) => {
      const experiment = await services.experiments.run({
        sourceThreadId,
        request: experimentRequest,
        signal,
        onEvent,
      });
      return {
        cancelled: experiment.result.status === "cancelled",
        returnCancelledResult: experiment.result.status === "cancelled",
        result: {
          sourceThreadId: experiment.preview.sourceThreadId,
          sourcePlanId: experiment.preview.sourcePlanId,
          targetThreadId: experiment.targetThreadId,
          targetPlanId: experiment.result.planId,
          status: experiment.result.status,
          previewSha256: experiment.preview.previewSha256,
          candidateManifestSha256: experiment.candidateManifest.contentSha256,
          experiment,
        },
      };
    };
  }
  throw new Error("Unsupported RPC invocation method");
}

export async function executeRpcInvocation(input: {
  request: JsonRpcRequest;
  signal: AbortSignal;
  invoke: RpcInvocation;
  writer: RpcOutputWriter;
  shouldWrite(): boolean;
}): Promise<void> {
  try {
    const outcome = await input.invoke(input.signal, async (event) => {
      if (!input.shouldWrite()) return;
      const eventFrame = streamEventFrame(event);
      await input.writer.write({
        jsonrpc: "2.0",
        method: "napier/event",
        params: {
          requestId: input.request.id,
          event,
          eventSha256: eventFrame.eventSha256,
        },
      });
    });
    if (!input.shouldWrite()) return;
    if (
      (input.signal.aborted || outcome.cancelled) &&
      outcome.returnCancelledResult !== true
    ) {
      await input.writer.write(
        rpcError(input.request.id, -32800, "Request cancelled"),
      );
      return;
    }
    await input.writer.write(rpcSuccess(input.request.id, outcome.result));
  } catch (error) {
    if (!input.shouldWrite()) return;
    await input.writer.write(
      input.signal.aborted
        ? rpcError(input.request.id, -32800, "Request cancelled")
        : invocationError(input.request.id, error),
    );
  }
}

function workflowOutcome(
  threadId: string,
  result: NapierRpcWorkflowExecution["result"],
  pendingDecision?: NapierRpcWorkflowExecution["pendingDecision"],
): RpcInvocationOutcome {
  return {
    cancelled: result.status === "cancelled",
    result: {
      threadId,
      planId: result.planId,
      status: result.status,
      ...(result.output !== undefined ? { output: result.output } : {}),
      result,
      ...(pendingDecision ? { pendingDecision } : {}),
    },
  };
}

function agentMessageExperimentExecution(
  experiment: AgentMessageExperimentResult,
): NapierRpcAgentMessageExperimentExecution {
  return {
    sourceThreadId: experiment.preview.sourceThreadId,
    sourceRunId: experiment.preview.sourceRunId,
    sourceMessageSeq: experiment.preview.sourceMessageSeq,
    targetThreadId: experiment.targetThreadId,
    targetRunId: experiment.targetRunId,
    status: experiment.status,
    previewSha256: experiment.preview.previewSha256,
    experiment,
  };
}

function modelInvocationExperimentExecution(
  experiment: ModelInvocationExperimentResult,
): NapierRpcModelInvocationExperimentExecution {
  return {
    sourceThreadId: experiment.preview.sourceThreadId,
    sourceRunId: experiment.preview.sourceRunId,
    sourceTurnIndex: experiment.preview.sourceTurnIndex,
    targetThreadId: experiment.targetThreadId,
    targetRunId: experiment.targetRunId,
    status: experiment.status,
    previewSha256: experiment.preview.previewSha256,
    experiment,
  };
}

function toolInvocationExperimentExecution(
  experiment: ToolInvocationExperimentResult,
): NapierRpcToolInvocationExperimentExecution {
  return {
    sourceThreadId: experiment.preview.sourceThreadId,
    sourceRunId: experiment.preview.sourceRunId,
    sourceCallId: experiment.preview.sourceCallId,
    targetThreadId: experiment.targetThreadId,
    targetRunId: experiment.targetRunId,
    status: experiment.status,
    previewSha256: experiment.preview.previewSha256,
    experiment,
  };
}

function invocationError(
  id: JsonRpcRequest["id"],
  error: unknown,
): ReturnType<typeof rpcError> {
  if (error instanceof EmbeddedWorkflowApprovalError) {
    return error.code === "invalid_answer"
      ? rpcError(id, -32602, "Invalid params", error)
      : rpcError(id, -32003, "Workflow approval conflict", error);
  }
  if (error instanceof WorkflowExperimentConflictError) {
    return rpcError(id, -32004, "Workflow experiment conflict", error);
  }
  if (error instanceof AgentMessageExperimentPreviewChangedError) {
    return rpcError(id, -32005, "Agent message experiment conflict", error);
  }
  if (error instanceof ModelInvocationExperimentPreviewChangedError) {
    return rpcError(id, -32006, "Model invocation experiment conflict", error);
  }
  if (error instanceof ToolInvocationExperimentPreviewChangedError) {
    return rpcError(id, -32007, "Tool invocation experiment conflict", error);
  }
  return rpcError(id, -32603, "Internal error", error);
}

import type {
  ExecutionPlanWorkflowExperimentPreview,
  NapierRpcAgentExecution,
  NapierRpcWorkflowExperimentExecution,
  NapierRpcWorkflowExecution,
  RunEvent,
} from "@napier/contracts";
import type {
  EmbeddedAgentService,
  EmbeddedWorkflowService,
  ExecutionPlanWorkflowExperimentRuntime,
} from "@napier/runtime";
import {
  EmbeddedWorkflowApprovalError,
  streamEventFrame,
  WorkflowExperimentConflictError,
} from "@napier/runtime";

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
}

interface RpcInvocationOutcome {
  cancelled: boolean;
  returnCancelledResult?: boolean;
  result:
    | NapierRpcAgentExecution
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
  return rpcError(id, -32603, "Internal error", error);
}

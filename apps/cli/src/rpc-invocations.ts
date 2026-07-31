import type {
  NapierRpcAgentExecution,
  NapierRpcWorkflowExecution,
  RunEvent,
} from "@napier/contracts";
import type {
  EmbeddedAgentService,
  EmbeddedWorkflowService,
} from "@napier/runtime";
import { streamEventFrame } from "@napier/runtime";

import {
  parseAgentResumeParams,
  parseAgentRunParams,
  parseWorkflowResumeParams,
  parseWorkflowRunParams,
  rpcError,
  rpcSuccess,
  type JsonRpcRequest,
} from "./rpc-protocol.js";
import type { RpcOutputWriter } from "./rpc-transport.js";

export interface RpcInvocationServices {
  agents: Pick<EmbeddedAgentService, "run" | "resume">;
  workflows: Pick<EmbeddedWorkflowService, "run" | "resume">;
}

interface RpcInvocationOutcome {
  cancelled: boolean;
  result: NapierRpcAgentExecution | NapierRpcWorkflowExecution;
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
      return workflowOutcome(execution.threadId, execution.result);
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
      return workflowOutcome(execution.threadId, execution.result);
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
    if (input.signal.aborted || outcome.cancelled) {
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
        : rpcError(input.request.id, -32603, "Internal error", error),
    );
  }
}

function workflowOutcome(
  threadId: string,
  result: NapierRpcWorkflowExecution["result"],
): RpcInvocationOutcome {
  return {
    cancelled: result.status === "cancelled",
    result: {
      threadId,
      planId: result.planId,
      status: result.status,
      ...(result.output !== undefined ? { output: result.output } : {}),
      result,
    },
  };
}

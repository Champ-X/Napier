import type { Writable } from "node:stream";

import type {
  AgentMessageExperimentRuntime,
  EmbeddedAgentService,
  EmbeddedWorkflowService,
  ExecutionPlanWorkflowExperimentRuntime,
  ModelInvocationExperimentRuntime,
  ToolInvocationExperimentRuntime,
} from "@napier/runtime";

import {
  JsonRpcProtocolError,
  MAX_RPC_ACTIVE_REQUESTS,
  NAPIER_RPC_PROTOCOL_VERSION,
  parseCancelParams,
  parseInitializeParams,
  parseJsonRpcMessage,
  rpcError,
  rpcSuccess,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
} from "./rpc-protocol.js";
import {
  executeRpcInvocation,
  isRpcInvocationMethod,
  prepareRpcInvocation,
} from "./rpc-invocations.js";
import {
  readRpcLines,
  RpcOutputWriter,
  RpcTransportError,
} from "./rpc-transport.js";

export interface NapierRpcServerOptions {
  agents: Pick<EmbeddedAgentService, "run" | "resume">;
  workflows: Pick<
    EmbeddedWorkflowService,
    "run" | "resume" | "answerAndResume"
  >;
  experiments: Pick<ExecutionPlanWorkflowExperimentRuntime, "preview" | "run">;
  agentExperiments: Pick<AgentMessageExperimentRuntime, "preview" | "run">;
  modelExperiments: Pick<ModelInvocationExperimentRuntime, "preview" | "run">;
  toolExperiments: Pick<ToolInvocationExperimentRuntime, "preview" | "run">;
  input: AsyncIterable<Buffer | string>;
  output: Writable;
  serverVersion: string;
  signal?: AbortSignal;
}

interface ActiveRpcRequest {
  id: JsonRpcId;
  controller: AbortController;
  pending: Promise<void>;
}

export async function runNapierRpcServer(
  options: NapierRpcServerOptions,
): Promise<number> {
  const lifetime = new AbortController();
  let exitCode = 0;
  const writer = new RpcOutputWriter(options.output, () => {
    exitCode = 1;
    lifetime.abort();
  });
  const active = new Map<string, ActiveRpcRequest>();
  let initialized = false;
  let shutdownRequested = false;
  let exitRequested = false;
  const abortLifetime = (): void => lifetime.abort();
  options.signal?.addEventListener("abort", abortLifetime, { once: true });
  if (options.signal?.aborted) lifetime.abort();

  const abortActive = (): void => {
    for (const request of active.values()) request.controller.abort();
  };
  lifetime.signal.addEventListener("abort", abortActive, { once: true });

  try {
    for await (const line of readRpcLines(
      options.input,
      undefined,
      lifetime.signal,
    )) {
      if (lifetime.signal.aborted || exitRequested) break;
      let message: JsonRpcMessage;
      try {
        message = parseJsonRpcMessage(line);
      } catch (error) {
        const protocol = protocolError(error);
        await writer.write(
          rpcError(
            protocol.responseId,
            protocol.code,
            protocol.publicMessage,
            error,
          ),
        );
        continue;
      }
      if (isNotification(message)) {
        if (
          await handleNotification(message, active, () => {
            exitRequested = true;
            exitCode = shutdownRequested ? 0 : 1;
            lifetime.abort();
          })
        ) {
          continue;
        }
        continue;
      }
      if (message.method === "initialize") {
        if (initialized || shutdownRequested) {
          await writer.write(
            rpcError(
              message.id,
              -32600,
              "Invalid Request",
              "duplicate initialize",
            ),
          );
          continue;
        }
        try {
          parseInitializeParams(message.params);
          initialized = true;
          await writer.write(
            rpcSuccess(message.id, {
              protocolVersion: NAPIER_RPC_PROTOCOL_VERSION,
              serverInfo: {
                name: "napier",
                version: options.serverVersion,
              },
              capabilities: {
                agentRun: true,
                agentResume: true,
                agentMessageExperimentPreview: true,
                agentMessageExperimentRun: true,
                modelInvocationExperimentPreview: true,
                modelInvocationExperimentRun: true,
                toolInvocationExperimentPreview: true,
                toolInvocationExperimentRun: true,
                workflowRun: true,
                workflowResume: true,
                workflowApprovalAnswer: true,
                workflowExperimentPreview: true,
                workflowExperimentRun: true,
                eventNotifications: true,
                requestCancellation: true,
                maxConcurrentRequests: MAX_RPC_ACTIVE_REQUESTS,
              },
            }),
          );
        } catch (error) {
          await writeRequestError(writer, message.id, error);
        }
        continue;
      }
      if (message.method === "shutdown") {
        if (!initialized || shutdownRequested) {
          await writer.write(
            rpcError(message.id, -32600, "Invalid Request", "invalid shutdown"),
          );
          continue;
        }
        try {
          requireEmptyParams(message.params);
          shutdownRequested = true;
          await writer.write(rpcSuccess(message.id, null));
        } catch (error) {
          await writeRequestError(writer, message.id, error);
        }
        continue;
      }
      if (!initialized) {
        await writer.write(
          rpcError(message.id, -32002, "Server not initialized"),
        );
        continue;
      }
      if (shutdownRequested) {
        await writer.write(
          rpcError(message.id, -32000, "Server is shutting down"),
        );
        continue;
      }
      if (!isRpcInvocationMethod(message.method)) {
        await writer.write(rpcError(message.id, -32601, "Method not found"));
        continue;
      }
      const key = requestKey(message.id);
      if (active.has(key)) {
        await writer.write(
          rpcError(
            message.id,
            -32600,
            "Invalid Request",
            "duplicate active id",
          ),
        );
        continue;
      }
      if (active.size >= MAX_RPC_ACTIVE_REQUESTS) {
        await writer.write(rpcError(message.id, -32001, "Server busy"));
        continue;
      }
      try {
        const invoke = prepareRpcInvocation(
          {
            agents: options.agents,
            workflows: options.workflows,
            experiments: options.experiments,
            agentExperiments: options.agentExperiments,
            modelExperiments: options.modelExperiments,
            toolExperiments: options.toolExperiments,
          },
          message,
        );
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, lifetime.signal]);
        const pending = executeRpcInvocation({
          request: message,
          signal,
          invoke,
          writer,
          shouldWrite: () => !exitRequested,
        }).finally(() => active.delete(key));
        active.set(key, { id: message.id, controller, pending });
      } catch (error) {
        await writeRequestError(writer, message.id, error);
      }
    }
  } catch (error) {
    if (!lifetime.signal.aborted) {
      exitCode = 1;
      await writer
        .write(
          rpcError(
            null,
            error instanceof RpcTransportError ? -32700 : -32603,
            error instanceof RpcTransportError
              ? "Parse error"
              : "Internal error",
            error,
          ),
        )
        .catch(() => undefined);
    }
  } finally {
    lifetime.abort();
    abortActive();
    await Promise.allSettled(
      [...active.values()].map((entry) => entry.pending),
    );
    await writer.close().catch(() => undefined);
    options.signal?.removeEventListener("abort", abortLifetime);
  }
  return exitCode;
}

async function handleNotification(
  notification: JsonRpcNotification,
  active: Map<string, ActiveRpcRequest>,
  exit: () => void,
): Promise<boolean> {
  if (notification.method === "$/cancelRequest") {
    try {
      const id = parseCancelParams(notification.params);
      active.get(requestKey(id))?.controller.abort();
    } catch {
      // JSON-RPC notifications intentionally have no response.
    }
    return true;
  }
  if (notification.method === "exit") {
    try {
      requireEmptyParams(notification.params);
      exit();
    } catch {
      exit();
    }
    return true;
  }
  return false;
}

async function writeRequestError(
  writer: RpcOutputWriter,
  id: JsonRpcId,
  error: unknown,
): Promise<void> {
  const protocol = protocolError(error);
  await writer.write(
    rpcError(id, protocol.code, protocol.publicMessage, error),
  );
}

function protocolError(error: unknown): JsonRpcProtocolError {
  return error instanceof JsonRpcProtocolError
    ? error
    : new JsonRpcProtocolError(
        -32603,
        "Internal error",
        null,
        error instanceof Error ? error.message : String(error),
      );
}

function requireEmptyParams(params: Record<string, unknown> | undefined): void {
  if (params && Object.keys(params).length > 0) {
    throw new JsonRpcProtocolError(
      -32602,
      "Invalid params",
      null,
      "params must be empty",
    );
  }
}

function requestKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function isNotification(
  message: JsonRpcMessage,
): message is JsonRpcNotification {
  return !Object.hasOwn(message, "id");
}

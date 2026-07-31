import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import type {
  EmbeddedAgentExecution,
  EmbeddedAgentService,
} from "@napier/runtime";
import { streamEventFrame } from "@napier/runtime";

import {
  JsonRpcProtocolError,
  MAX_RPC_ACTIVE_REQUESTS,
  NAPIER_RPC_PROTOCOL_VERSION,
  parseAgentResumeParams,
  parseAgentRunParams,
  parseCancelParams,
  parseInitializeParams,
  parseJsonRpcMessage,
  rpcError,
  rpcSuccess,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from "./rpc-protocol.js";
import {
  readRpcLines,
  RpcOutputWriter,
  RpcTransportError,
} from "./rpc-transport.js";

export interface NapierRpcServerOptions {
  agents: Pick<EmbeddedAgentService, "run" | "resume">;
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
      if (
        message.method !== "napier/agent/run" &&
        message.method !== "napier/agent/resume"
      ) {
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
        const invoke = prepareInvocation(options.agents, message);
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, lifetime.signal]);
        const pending = executeInvocation({
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

function prepareInvocation(
  agents: Pick<EmbeddedAgentService, "run" | "resume">,
  request: JsonRpcRequest,
): (
  signal: AbortSignal,
  onEvent: (event: RunEvent) => Promise<void>,
) => Promise<EmbeddedAgentExecution> {
  if (request.method === "napier/agent/run") {
    const params = parseAgentRunParams(request.params);
    return (signal, onEvent) =>
      agents.run({
        ...params,
        signal,
        onEvent,
      });
  }
  const params = parseAgentResumeParams(request.params);
  return (signal, onEvent) =>
    agents.resume({
      ...params,
      signal,
      onEvent,
    });
}

async function executeInvocation(input: {
  request: JsonRpcRequest;
  signal: AbortSignal;
  invoke: (
    signal: AbortSignal,
    onEvent: (event: RunEvent) => Promise<void>,
  ) => Promise<EmbeddedAgentExecution>;
  writer: RpcOutputWriter;
  shouldWrite(): boolean;
}): Promise<void> {
  try {
    const execution = await input.invoke(input.signal, async (event) => {
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
    if (input.signal.aborted || execution.run.status === "cancelled") {
      await input.writer.write(
        rpcError(input.request.id, -32800, "Request cancelled"),
      );
      return;
    }
    await input.writer.write(
      rpcSuccess(input.request.id, {
        threadId: execution.threadId,
        runId: execution.run.id,
        status: execution.run.status,
        ...(execution.assistantText !== undefined
          ? { assistantText: execution.assistantText }
          : {}),
        run: execution.run,
      }),
    );
  } catch (error) {
    if (!input.shouldWrite()) return;
    await input.writer.write(
      input.signal.aborted
        ? rpcError(input.request.id, -32800, "Request cancelled")
        : rpcError(input.request.id, -32603, "Internal error", error),
    );
  }
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

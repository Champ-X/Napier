import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";

import { agentToolResultText } from "./agent-tool-result-text.js";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { claimRunHeadEvent } from "./event-idempotency.js";
import {
  createOwnedToolRecordV2,
  type OwnedToolRecordV2,
} from "./owned-tool-protocol.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import { executeAdmittedToolCall } from "./tool-execution-admission-service.js";
import type { ToolOperationJournalStore } from "./tool-operation-model.js";

export function governSubagentTools(input: {
  tools: readonly AgentTool[];
  store: ToolOperationJournalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  taskId: string;
  concurrencyGate: ToolConcurrencyGate;
  onEvent: EventSink | undefined;
}): AgentTool[] {
  return input.tools.map((tool) => {
    const protocol = createOwnedToolRecordV2(tool);
    const acquisitionCapable =
      protocol.definition.progress.operations.includes("acquire");
    const opaqueProgress = protocol.definition.progress.coverage === "opaque";
    return preserveAgentToolIdentity(tool, {
      ...tool,
      ...(acquisitionCapable || opaqueProgress
        ? { executionMode: "sequential" as const }
        : {}),
      execute: async (callId, args, signal, onUpdate) => {
        let started = false;
        try {
          const admitted = await executeAdmittedToolCall({
            store: input.store,
            run: input.run,
            callId,
            toolName: tool.name,
            args,
            protocol,
            concurrencyGate: input.concurrencyGate,
            startedPayload: {
              subagentTaskId: input.taskId,
              ...privateInputProjection(tool.name, args),
              toolProtocol: protocol.uiProjection(
                "started",
                args,
              ) as unknown as JsonValue,
            },
            ...(signal ? { signal } : {}),
            ...(input.onEvent ? { onEvent: input.onEvent } : {}),
            admissionPayload: { subagentTaskId: input.taskId },
            onStarted: () => {
              started = true;
            },
            execute: () =>
              tool.execute(callId, args as never, signal, onUpdate),
            settlement: (result) => ({ result, isError: false }),
          });
          await appendTerminal(input, tool, protocol, callId, args, {
            status: "completed",
            result: admitted.value,
          });
          return admitted.value;
        } catch (error) {
          if (started) {
            await appendTerminal(input, tool, protocol, callId, args, {
              status: "failed",
              error,
            }).catch(() => undefined);
          }
          throw error;
        }
      },
    });
  });
}

async function appendTerminal(
  input: Parameters<typeof governSubagentTools>[0],
  tool: AgentTool,
  protocol: OwnedToolRecordV2,
  callId: string,
  args: unknown,
  outcome:
    | {
        status: "completed";
        result: Awaited<ReturnType<AgentTool["execute"]>>;
      }
    | { status: "failed"; error: unknown },
): Promise<RunEvent> {
  const completed = outcome.status === "completed";
  const output = completed ? agentToolResultText(outcome.result) : "";
  const payload: Record<string, JsonValue> = {
    callId,
    toolName: tool.name,
    status: completed ? "completed" : "failed",
    subagentTaskId: input.taskId,
    toolProtocol: protocol.uiProjection(
      completed ? "completed" : "failed",
      args,
      completed ? outcome.result : undefined,
      !completed,
    ) as unknown as JsonValue,
    ...(completed
      ? {
          outputTextSha256: sha256(output),
          outputTextBytes: Buffer.byteLength(output, "utf8"),
          outputRedacted: true,
          outputSha256: sha256(output),
          outputBytes: Buffer.byteLength(output, "utf8"),
        }
      : {
          diagnosticSha256: sha256(errorMessage(outcome.error)),
          toolFailure: protocol.failure(
            args,
            outcome.error,
          ) as unknown as JsonValue,
        }),
  };
  const eventInput = {
    threadId: input.run.threadId,
    runId: input.run.id,
    type: completed ? "tool.completed" : "tool.failed",
    category: "tool",
    visibility: "user",
    payload,
  } as AppendEventInput;
  const receipt = await claimRunHeadEvent(input.store, eventInput, {
    namespace: "subagent-tool-terminal",
    key: `${input.run.id}:${callId}`,
  });
  if (receipt.appended) await emitBestEffort(input.onEvent, receipt.event);
  return receipt.event;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function privateInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  const input = toJsonValue(args);
  const encoded = canonicalJson(input);
  return {
    inputRedacted: true,
    inputSha256: sha256(canonicalJson({ toolName, input })),
    inputBytes: Buffer.byteLength(encoded, "utf8"),
  };
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

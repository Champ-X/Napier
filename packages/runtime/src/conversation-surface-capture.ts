import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ModelContextEnvelopeReceipt, RunRecord } from "@napier/contracts";

import type { ConversationSurfaceCapsuleStore } from "./conversation-surface-capsule-store.js";
import { sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";

export interface ConversationSurfaceCaptureHost {
  store: LocalStore;
  conversationSurfaceCapsules: ConversationSurfaceCapsuleStore;
}

export async function captureConversationSurfaceTurn(input: {
  host: ConversationSurfaceCaptureHost;
  run: RunRecord;
  event:
    | { type: "turn_start" }
    | {
        type: "turn_end";
        message: AssistantMessage | { role: string };
        toolResults: ToolResultMessage[];
      };
  envelope: ModelContextEnvelopeReceipt | undefined;
  onEvent?: EventSink;
}): Promise<void> {
  if (
    input.event.type !== "turn_end" ||
    input.event.message.role !== "assistant" ||
    input.event.toolResults.length === 0
  ) {
    return;
  }
  await captureConversationSurfaceExchange({
    store: input.host.store,
    capsules: input.host.conversationSurfaceCapsules,
    run: input.run,
    envelope: input.envelope,
    assistant: input.event.message as AssistantMessage,
    toolResults: input.event.toolResults,
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
}

export async function captureConversationSurfaceExchange(input: {
  store: LocalStore;
  capsules: ConversationSurfaceCapsuleStore;
  run: RunRecord;
  envelope: ModelContextEnvelopeReceipt | undefined;
  assistant: AssistantMessage;
  toolResults: ToolResultMessage[];
  onEvent?: EventSink;
}): Promise<void> {
  const toolCallCount = input.assistant.content.filter(
    (item) => item.type === "toolCall",
  ).length;
  if (toolCallCount === 0 || input.toolResults.length === 0) return;
  try {
    if (!input.envelope) {
      throw new Error("Model Context Envelope is unavailable");
    }
    const receipt = await input.capsules.put({
      sourceThreadId: input.run.threadId,
      sourceRunId: input.run.id,
      modelContextEnvelopeSha256: input.envelope.contentSha256,
      modelContextEnvelopeTurnIndex: input.envelope.turnIndex,
      assistant: input.assistant,
      toolResults: input.toolResults,
    });
    await append(
      input.store,
      {
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "context.conversation_surface",
        category: "model",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(receipt)),
      },
      input.onEvent,
    );
  } catch (error) {
    await append(
      input.store,
      {
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "context.conversation_surface_unavailable",
        category: "model",
        visibility: "debug",
        payload: {
          schemaVersion: 1,
          toolCallCount,
          reason: captureFailureReason(error),
          diagnosticSha256: sha256(errorMessage(error)),
          ...(input.envelope
            ? {
                modelContextEnvelopeSha256: input.envelope.contentSha256,
                modelContextEnvelopeTurnIndex: input.envelope.turnIndex,
              }
            : {}),
        },
      },
      input.onEvent,
    );
  }
}

async function append(
  store: LocalStore,
  eventInput: Parameters<LocalStore["appendEvent"]>[0],
  onEvent?: EventSink,
): Promise<void> {
  const event = await store.appendEvent(eventInput);
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch {
    // Durable context evidence survives a disconnected observer.
  }
}

function captureFailureReason(error: unknown): "limit" | "storage" | "invalid" {
  const message = errorMessage(error);
  if (/\b(?:byte|count|limit|exceeds)\b/iu.test(message)) return "limit";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["EACCES", "EDQUOT", "ENOSPC", "EROFS"].includes(String(error.code))
  ) {
    return "storage";
  }
  return "invalid";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

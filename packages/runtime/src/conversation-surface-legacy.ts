import type { Message } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";

import {
  normalizeConversationSurfaceExchange,
  type ConversationSurfaceExchange,
} from "./conversation-surface-capsule.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import { validateModelInvocationCapsuleReceipt } from "./model-invocation-capsule.js";

export interface LegacyConversationSurfaceUnit {
  seq: number;
  response: RunEvent;
  exchange: ConversationSurfaceExchange;
  terminals: RunEvent[];
}

export interface LegacyConversationSurfaceProjection {
  units: LegacyConversationSurfaceUnit[];
  omittedCount: number;
}

interface ResponseCandidate {
  event: RunEvent;
  text: string;
  envelopeSha256: string;
  envelopeTurnIndex: number;
  calls: Array<{ id: string; name: string }>;
}

export async function projectLegacyConversationSurface(input: {
  events: RunEvent[];
  minimumEventSeq: number;
  importedEventCount: number;
  claimedResponseKeys: ReadonlySet<string>;
  capsules: ModelInvocationCapsuleStore;
}): Promise<LegacyConversationSurfaceProjection> {
  const candidates = input.events.flatMap((event) => {
    const candidate = responseCandidate(event);
    if (
      !candidate ||
      event.seq < input.minimumEventSeq ||
      event.seq <= input.importedEventCount ||
      input.claimedResponseKeys.has(responseKey(event.runId, candidate))
    ) {
      return [];
    }
    return [candidate];
  });
  const units: LegacyConversationSurfaceUnit[] = [];
  let omittedCount = 0;
  for (const candidate of candidates) {
    try {
      units.push(await legacyUnit(candidate, input.events, input.capsules));
    } catch {
      omittedCount += 1;
    }
  }
  return { units, omittedCount };
}

export function responseKey(
  runId: string,
  binding: { envelopeSha256: string; envelopeTurnIndex: number },
): string {
  return `${runId}:${String(binding.envelopeTurnIndex)}:${binding.envelopeSha256}`;
}

async function legacyUnit(
  candidate: ResponseCandidate,
  events: RunEvent[],
  capsules: ModelInvocationCapsuleStore,
): Promise<LegacyConversationSurfaceUnit> {
  const invocationEvents = events.filter(
    (event) =>
      event.type === "context.model_invocation" &&
      event.runId === candidate.event.runId &&
      event.seq > candidate.event.seq,
  );
  for (const invocationEvent of invocationEvents) {
    let receipt;
    try {
      receipt = validateModelInvocationCapsuleReceipt(invocationEvent.payload);
    } catch {
      continue;
    }
    if (receipt.purpose !== "agent_turn") continue;
    const capsule = await capsules.read(receipt.capsuleSha256);
    if (
      capsule.sourceThreadId !== candidate.event.threadId ||
      capsule.sourceRunId !== candidate.event.runId ||
      capsule.turnIndex !== receipt.turnIndex ||
      capsule.purpose !== receipt.purpose ||
      capsule.contextEnvelopeSha256 !== receipt.contextEnvelopeSha256 ||
      capsule.contextSha256 !== receipt.contextSha256 ||
      capsule.contentSha256 !== receipt.capsuleSha256
    ) {
      throw new Error("Legacy Conversation Surface invocation binding failed");
    }
    const exchange = matchingExchange(capsule.context.messages, candidate);
    if (!exchange) continue;
    return {
      seq: candidate.event.seq,
      response: candidate.event,
      exchange,
      terminals: matchingTerminals(
        events,
        candidate,
        invocationEvent,
        exchange,
      ),
    };
  }
  throw new Error("Legacy Conversation Surface source is unavailable");
}

function matchingExchange(
  messages: Message[],
  candidate: ResponseCandidate,
): ConversationSurfaceExchange | undefined {
  const matches: ConversationSurfaceExchange[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant") continue;
    const calls = message.content.flatMap((item) =>
      item.type === "toolCall" ? [{ id: item.id, name: item.name }] : [],
    );
    const text = message.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    if (
      text !== candidate.text ||
      calls.length !== candidate.calls.length ||
      calls.some(
        (call, callIndex) =>
          call.id !== candidate.calls[callIndex]?.id ||
          call.name !== candidate.calls[callIndex]?.name,
      )
    ) {
      continue;
    }
    const results = messages.slice(index + 1, index + 1 + calls.length);
    if (
      results.length !== calls.length ||
      results.some(
        (result, resultIndex) =>
          result.role !== "toolResult" ||
          result.toolCallId !== calls[resultIndex]?.id ||
          result.toolName !== calls[resultIndex]?.name,
      )
    ) {
      continue;
    }
    matches.push(
      normalizeConversationSurfaceExchange({
        assistantContent: message.content,
        toolResults: results,
      }),
    );
  }
  if (matches.length > 1) {
    throw new Error("Legacy Conversation Surface exchange is ambiguous");
  }
  return matches[0];
}

function matchingTerminals(
  events: RunEvent[],
  candidate: ResponseCandidate,
  invocationEvent: RunEvent,
  exchange: ConversationSurfaceExchange,
): RunEvent[] {
  return exchange.toolResults.map((result) => {
    const matches = events.filter(
      (event) =>
        (event.type === "tool.completed" || event.type === "tool.failed") &&
        event.runId === candidate.event.runId &&
        event.seq > candidate.event.seq &&
        event.seq < invocationEvent.seq &&
        record(event.payload) &&
        event.payload["callId"] === result.toolCallId &&
        event.payload["toolName"] === result.toolName &&
        (event.type === "tool.failed") === result.isError,
    );
    if (matches.length !== 1) {
      throw new Error("Legacy Conversation Surface terminal is ambiguous");
    }
    return matches[0]!;
  });
}

function responseCandidate(event: RunEvent): ResponseCandidate | undefined {
  if (
    event.type !== "model.response" ||
    !record(event.payload) ||
    event.payload["contentRedacted"] === true ||
    typeof event.payload["text"] !== "string" ||
    typeof event.payload["modelContextEnvelopeSha256"] !== "string" ||
    typeof event.payload["modelContextEnvelopeTurnIndex"] !== "number" ||
    !Array.isArray(event.payload["toolCalls"])
  ) {
    return undefined;
  }
  const calls = event.payload["toolCalls"].flatMap((item) => {
    if (
      !record(item) ||
      typeof item["id"] !== "string" ||
      typeof item["name"] !== "string"
    ) {
      return [];
    }
    return [{ id: item["id"], name: item["name"] }];
  });
  if (
    calls.length === 0 ||
    calls.length !== event.payload["toolCalls"].length
  ) {
    return undefined;
  }
  return {
    event,
    text: event.payload["text"],
    envelopeSha256: event.payload["modelContextEnvelopeSha256"],
    envelopeTurnIndex: event.payload["modelContextEnvelopeTurnIndex"],
    calls,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { RunEvent, RunRecord } from "@napier/contracts";

import { contextEventText } from "./compaction.js";
import { recordCompatibilityHit } from "./compatibility-telemetry.js";
import type { ConversationSurfaceCapsuleStore } from "./conversation-surface-capsule-store.js";
import {
  toolCallSetSha256,
  toolCalls,
  type ConversationSurfaceCapsule,
  type ConversationSurfaceCapsuleReceipt,
  type ConversationSurfaceExchange,
  validateConversationSurfaceCapsuleReceipt,
} from "./conversation-surface-capsule.js";
import { formatImportedHistoryMessage } from "./import-boundary-format.js";
import { groupedConversationSurfaceDeclarations } from "./conversation-surface-declarations.js";
import { assertConversationSurfaceResultEvidence } from "./conversation-surface-result-evidence.js";
import { projectLegacyConversationSurface } from "./conversation-surface-legacy.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";

export interface ConversationSurfaceProjection {
  messages: AgentMessage[];
  textEventCount: number;
  toolExchangeCount: number;
  omittedToolExchangeCount: number;
}

interface SurfaceUnit {
  seq: number;
  messages: AgentMessage[];
}

interface ModelResponseBinding {
  event: RunEvent;
  toolCalls: Array<{ id: string; name: string }>;
  text: string;
}

export async function projectConversationSurface(input: {
  events: RunEvent[];
  textEvents: RunEvent[];
  model: Model<Api>;
  importedEventCount: number;
  minimumEventSeq: number;
  projectionRun?: Pick<RunRecord, "id" | "source">;
  capsules: ConversationSurfaceCapsuleStore;
  resultCapsules: ToolInvocationResultCapsuleStore;
  modelInvocationCapsules: ModelInvocationCapsuleStore;
}): Promise<ConversationSurfaceProjection> {
  const minimumEventSeq = conversationSurfaceMinimumEventSeq(input);
  const units: SurfaceUnit[] = input.textEvents.map((event) => ({
    seq: event.seq,
    messages: textEventMessages(event, input.model, input.importedEventCount),
  }));
  const declarations = groupedConversationSurfaceDeclarations(input.events);
  const candidates = declarations.filter(
    (group) =>
      group.length === 1 &&
      group[0]!.type === "context.conversation_surface" &&
      group[0]!.seq >= minimumEventSeq &&
      group[0]!.seq > input.importedEventCount,
  );
  let omittedToolExchangeCount = declarations.filter(
    (group) =>
      group.some(
        (event) =>
          event.seq >= minimumEventSeq && event.seq > input.importedEventCount,
      ) &&
      (group.length !== 1 || group[0]!.type !== "context.conversation_surface"),
  ).length;
  for (const [event] of candidates) {
    try {
      units.push(
        await surfaceUnit(
          event!,
          input.events,
          input.model,
          minimumEventSeq,
          input.capsules,
          input.resultCapsules,
        ),
      );
    } catch {
      omittedToolExchangeCount += 1;
    }
  }
  const surfaceClaimedRunIds = new Set(
    input.events.flatMap((event) =>
      event.type === "context.conversation_surface" ||
      event.type === "context.conversation_surface_unavailable"
        ? [event.runId]
        : [],
    ),
  );
  const legacy = await projectLegacyConversationSurface({
    events: input.events.filter(
      (event) => !surfaceClaimedRunIds.has(event.runId),
    ),
    minimumEventSeq,
    importedEventCount: input.importedEventCount,
    claimedResponseKeys: new Set(),
    capsules: input.modelInvocationCapsules,
  });
  for (const _unit of legacy.units) {
    recordCompatibilityHit("compat.conversation_surface.legacy_read");
  }
  units.push(
    ...legacy.units.map((unit) => ({
      seq: unit.seq,
      messages: exchangeMessages(
        unit.exchange,
        input.model,
        unit.response,
        unit.terminals,
      ),
    })),
  );
  omittedToolExchangeCount += legacy.omittedCount;
  units.sort((left, right) => left.seq - right.seq);
  return {
    messages: units.flatMap((unit) => unit.messages),
    textEventCount: input.textEvents.length,
    toolExchangeCount: units.filter((unit) => unit.messages.length > 1).length,
    omittedToolExchangeCount,
  };
}

function conversationSurfaceMinimumEventSeq(
  input: Pick<
    Parameters<typeof projectConversationSurface>[0],
    "events" | "minimumEventSeq" | "projectionRun"
  >,
): number {
  if (input.projectionRun?.source !== "recovery") {
    return input.minimumEventSeq;
  }
  const recoveryBoundary = input.events.find(
    (event) =>
      event.runId === input.projectionRun?.id &&
      event.type === "run.recovery.started",
  );
  if (!recoveryBoundary) {
    throw new Error("Recovery Conversation Surface boundary is unavailable");
  }
  return Math.max(input.minimumEventSeq, recoveryBoundary.seq);
}

async function surfaceUnit(
  receiptEvent: RunEvent,
  events: RunEvent[],
  model: Model<Api>,
  minimumEventSeq: number,
  capsules: ConversationSurfaceCapsuleStore,
  resultCapsules: ToolInvocationResultCapsuleStore,
): Promise<SurfaceUnit> {
  const receipt = validateConversationSurfaceCapsuleReceipt(
    receiptEvent.payload,
  );
  const capsule = await capsules.read(receipt.capsuleSha256);
  assertReceiptBinding(receiptEvent, receipt, capsule);
  const response = matchingModelResponse(events, receiptEvent, receipt);
  if (response.event.seq < minimumEventSeq) {
    throw new Error("Conversation Surface unit crosses the retained boundary");
  }
  assertResponseBinding(response, receipt, capsule.exchange);
  const terminals = matchingTerminalEvents(
    events,
    response.event,
    receiptEvent,
    capsule.exchange,
  );
  await assertConversationSurfaceResultEvidence({
    events,
    response: response.event,
    receiptEvent,
    surface: capsule,
    resultCapsules,
  });
  return {
    seq: response.event.seq,
    messages: exchangeMessages(
      capsule.exchange,
      model,
      response.event,
      terminals,
    ),
  };
}

function assertReceiptBinding(
  event: RunEvent,
  receipt: ConversationSurfaceCapsuleReceipt,
  capsule: ConversationSurfaceCapsule,
): void {
  if (
    capsule.sourceThreadId !== event.threadId ||
    capsule.sourceRunId !== event.runId ||
    capsule.modelContextEnvelopeSha256 !== receipt.modelContextEnvelopeSha256 ||
    capsule.modelContextEnvelopeTurnIndex !==
      receipt.modelContextEnvelopeTurnIndex ||
    capsule.exchangeSha256 !== receipt.exchangeSha256 ||
    capsule.contentSha256 !== receipt.capsuleSha256 ||
    toolCalls(capsule.exchange).length !== receipt.toolCallCount ||
    toolCallSetSha256(capsule.exchange) !== receipt.toolCallSetSha256
  ) {
    throw new Error("Conversation Surface receipt binding is invalid");
  }
}

function matchingModelResponse(
  events: RunEvent[],
  receiptEvent: RunEvent,
  receipt: ConversationSurfaceCapsuleReceipt,
): ModelResponseBinding {
  const matches = events.flatMap((event): ModelResponseBinding[] => {
    if (
      event.type !== "model.response" ||
      event.runId !== receiptEvent.runId ||
      event.seq >= receiptEvent.seq ||
      !record(event.payload) ||
      event.payload["modelContextEnvelopeSha256"] !==
        receipt.modelContextEnvelopeSha256 ||
      event.payload["modelContextEnvelopeTurnIndex"] !==
        receipt.modelContextEnvelopeTurnIndex ||
      event.payload["contentRedacted"] === true ||
      typeof event.payload["text"] !== "string"
    ) {
      return [];
    }
    const calls = parseResponseToolCalls(event.payload["toolCalls"]);
    return calls
      ? [{ event, toolCalls: calls, text: event.payload["text"] }]
      : [];
  });
  if (matches.length !== 1) {
    throw new Error("Conversation Surface model response is ambiguous");
  }
  return matches[0]!;
}

function assertResponseBinding(
  response: ModelResponseBinding,
  receipt: ConversationSurfaceCapsuleReceipt,
  exchange: ConversationSurfaceExchange,
): void {
  const calls = toolCalls(exchange);
  const text = exchange.assistantContent
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (
    response.toolCalls.length !== calls.length ||
    response.toolCalls.some(
      (call, index) =>
        call.id !== calls[index]?.id || call.name !== calls[index]?.name,
    ) ||
    response.text !== text ||
    receipt.toolCallCount !== calls.length
  ) {
    throw new Error("Conversation Surface response binding is invalid");
  }
}

function matchingTerminalEvents(
  events: RunEvent[],
  response: RunEvent,
  receipt: RunEvent,
  exchange: ConversationSurfaceExchange,
): RunEvent[] {
  return exchange.toolResults.map((result) => {
    const matches = events.filter(
      (event) =>
        (event.type === "tool.completed" || event.type === "tool.failed") &&
        event.runId === receipt.runId &&
        event.seq > response.seq &&
        event.seq < receipt.seq &&
        record(event.payload) &&
        event.payload["callId"] === result.toolCallId &&
        event.payload["toolName"] === result.toolName &&
        (event.type === "tool.failed") === result.isError,
    );
    if (matches.length !== 1) {
      throw new Error("Conversation Surface terminal binding is invalid");
    }
    return matches[0]!;
  });
}

function exchangeMessages(
  exchange: ConversationSurfaceExchange,
  model: Model<Api>,
  response: RunEvent,
  terminals: RunEvent[],
): AgentMessage[] {
  const assistant: AssistantMessage = {
    role: "assistant",
    content: exchange.assistantContent,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: Date.parse(response.createdAt),
  };
  const results: ToolResultMessage[] = exchange.toolResults.map(
    (result, index) => ({
      role: "toolResult",
      ...result,
      timestamp: Date.parse(terminals[index]!.createdAt),
    }),
  );
  return [assistant, ...results];
}

function textEventMessages(
  event: RunEvent,
  model: Model<Api>,
  importedEventCount: number,
): AgentMessage[] {
  const eventText = contextEventText(event);
  if (!eventText) return [];
  const text =
    event.seq <= importedEventCount
      ? formatImportedHistoryMessage(event.seq, eventText)
      : eventText;
  if (
    event.type === "message.user" ||
    event.type === "goal.continuation.prompt" ||
    event.type === "run.progress.directive.delivered"
  ) {
    const message: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.parse(event.createdAt),
    };
    return [message];
  }
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.parse(event.createdAt),
  };
  return [message];
}

function parseResponseToolCalls(
  input: unknown,
): Array<{ id: string; name: string }> | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const calls = input.flatMap((item) => {
    if (
      !record(item) ||
      typeof item["id"] !== "string" ||
      typeof item["name"] !== "string"
    ) {
      return [];
    }
    return [{ id: item["id"], name: item["name"] }];
  });
  return calls.length === input.length ? calls : undefined;
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

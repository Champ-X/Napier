import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
} from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import type {
  ModelRouteAttempt,
  ModelRoutePlan,
  ModelRouteSideEffectState,
} from "@napier/contracts/model-route";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { routeErrorText } from "./model-route-policy.js";
import type { LocalStore } from "./store.js";

export function routeAttempt(
  input: Omit<ModelRouteAttempt, "kind" | "schemaVersion" | "contentSha256">,
): ModelRouteAttempt {
  const content = {
    kind: "napier.model-route-attempt" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function finalizeRouteAttempt(
  started: ModelRouteAttempt,
  completion: Pick<
    ModelRouteAttempt,
    "finishedAt" | "durationMs" | "sideEffectState" | "outcome"
  > &
    Partial<
      Pick<
        ModelRouteAttempt,
        "visibleOutputProduced" | "failureClass" | "diagnosticSha256"
      >
    >,
): ModelRouteAttempt {
  const { contentSha256: _startedSha256, ...startedContent } = started;
  return routeAttempt({ ...startedContent, ...completion });
}

export async function appendRouteEvent(
  store: LocalStore,
  run: Pick<RunRecord, "id" | "threadId">,
  type: "route_plan_created" | "route_attempt_started" | "route_attempt_ended",
  payload: ModelRoutePlan | ModelRouteAttempt,
  onEvent?: EventSink,
): Promise<void> {
  const event = await store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type,
    category: "model",
    visibility: "debug",
    payload: JSON.parse(JSON.stringify(payload)),
  });
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch {
    // Durable route evidence survives a disconnected observer.
  }
}

export async function routeSideEffectState(
  store: LocalStore,
  run: Pick<RunRecord, "id" | "threadId">,
): Promise<ModelRouteSideEffectState> {
  const events = (await store.listEvents(run.threadId)).filter(
    (event) => event.runId === run.id,
  );
  const terminals = new Map<string, string>();
  for (const event of events) {
    if (
      event.type !== "tool.completed" &&
      event.type !== "tool.failed" &&
      event.type !== "tool.blocked"
    ) {
      continue;
    }
    const callId = stringField(event.payload, "callId");
    if (callId) terminals.set(callId, event.type);
  }
  let known = false;
  for (const event of events) {
    if (event.type !== "tool.started") continue;
    const effect = stringField(event.payload, "effect");
    if (effect === "read") continue;
    const callId = stringField(event.payload, "callId");
    const terminal = callId ? terminals.get(callId) : undefined;
    if (terminal === "tool.blocked") continue;
    if (effect !== "write" || terminal !== "tool.completed") {
      return "unknown";
    }
    known = true;
  }
  return known ? "known" : "none";
}

export function routeVisibleOutput(event: AssistantMessageEvent): boolean {
  if (event.type === "text_delta" || event.type === "thinking_delta") {
    return event.delta.length > 0;
  }
  if (event.type === "text_end") return event.content.length > 0;
  if (event.type === "thinking_end") return event.content.length > 0;
  return (
    event.type === "toolcall_start" ||
    event.type === "toolcall_delta" ||
    event.type === "toolcall_end"
  );
}

export function terminalEvent(event: AssistantMessageEvent): boolean {
  return event.type === "done" || event.type === "error";
}

export function terminalFromMessage(
  message: AssistantMessage,
): Extract<AssistantMessageEvent, { type: "done" | "error" }> {
  return message.stopReason === "error" || message.stopReason === "aborted"
    ? { type: "error", reason: message.stopReason, error: message }
    : { type: "done", reason: message.stopReason, message };
}

export function routeFailureMessage(
  model: Model<Api>,
  error: unknown,
  aborted: boolean,
): AssistantMessage {
  const stopReason = aborted ? "aborted" : "error";
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage: routeErrorText(error),
    timestamp: Date.now(),
  };
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

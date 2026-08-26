import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import type {
  ModelRouteAttempt,
  ModelRouteCandidate,
  ModelRouteCredentialHealth,
  ModelRoutePlan,
  RouteFailureClass,
} from "@napier/contracts/model-route";

import { sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { createId, nowIso } from "./ids.js";
import {
  appendRouteEvent,
  finalizeRouteAttempt,
  routeAttempt,
  routeFailureMessage,
  routeSideEffectState,
  routeVisibleOutput,
  terminalEvent,
  terminalFromMessage,
} from "./model-route-evidence.js";
import {
  classifyRouteFailure,
  routeCanFallback,
  routeErrorText,
} from "./model-route-policy.js";
import type { LocalStore } from "./store.js";
import type {
  ModelRouteAttemptContext,
  ResolvedRouteCandidate,
} from "./model-route-types.js";

interface RouterPort {
  availableCandidates(
    candidates: readonly ResolvedRouteCandidate[],
  ): ResolvedRouteCandidate[];
  markFailure(
    candidate: ModelRouteCandidate,
    failureClass: RouteFailureClass,
    hints?: { providerHint?: string; retryAfterMs?: number },
    retryPolicy?: ModelRoutePlan["retryPolicy"],
  ): Promise<{ cooldownUntil?: string; backoffMs: number }>;
  markSuccess(candidate: ModelRouteCandidate): Promise<void>;
  candidateHealth(candidate: ModelRouteCandidate): {
    credentialHealth: ModelRouteCredentialHealth;
    cooldownUntil?: string;
  };
}

interface StreamOptions {
  store: LocalStore;
  router: RouterPort;
  run: RunRecord;
  plan: ModelRoutePlan;
  candidates: ResolvedRouteCandidate[];
  onEvent?: EventSink;
}

interface StreamInput {
  signal: AbortSignal;
  invoke(
    model: Model<Api>,
    context?: ModelRouteAttemptContext,
  ): Promise<AssistantMessageEventStream>;
}

type AttemptResult =
  | { action: "fallback"; attempt: number; reason: RouteFailureClass }
  | { action: "terminal"; message: AssistantMessage };

interface ConsumedStream {
  finalMessage?: AssistantMessage;
  failure?: unknown;
  visibleOutputProduced: boolean;
  pending: AssistantMessageEvent[];
}

export function createModelRouteStream(
  options: StreamOptions,
  input: StreamInput,
  nextAttempt: () => number,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let resolveTerminal: (message: AssistantMessage) => void = () => undefined;
  const terminal = new Promise<AssistantMessage>((resolve) => {
    resolveTerminal = resolve;
  });
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    resolveTerminal(message);
  };

  output[Symbol.asyncIterator] = () =>
    routeEvents(options, input, nextAttempt, settle)[Symbol.asyncIterator]();
  output.result = () => terminal;
  return output;
}

async function* routeEvents(
  options: StreamOptions,
  input: StreamInput,
  nextAttempt: () => number,
  settle: (message: AssistantMessage) => void,
): AsyncGenerator<AssistantMessageEvent> {
  const candidates = options.router.availableCandidates(options.candidates);
  let fallbackFromAttempt: number | undefined;
  let fallbackReason: RouteFailureClass | undefined;
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const result = yield* runCandidate({
        options,
        input,
        candidate: candidates[index]!,
        index,
        candidateCount: candidates.length,
        attempt: nextAttempt(),
        ...(fallbackFromAttempt !== undefined ? { fallbackFromAttempt } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
      });
      if (result.action === "terminal") {
        settle(result.message);
        yield terminalFromMessage(result.message);
        return;
      }
      fallbackFromAttempt = result.attempt;
      fallbackReason = result.reason;
    }
    throw new Error("Model route exhausted without a terminal result");
  } catch (error) {
    const message = routeFailureMessage(
      candidates[0]!.model,
      error,
      input.signal.aborted,
    );
    settle(message);
    yield terminalFromMessage(message);
  }
}

async function* runCandidate(input: {
  options: StreamOptions;
  input: StreamInput;
  candidate: ResolvedRouteCandidate;
  index: number;
  candidateCount: number;
  attempt: number;
  fallbackFromAttempt?: number;
  fallbackReason?: RouteFailureClass;
}): AsyncGenerator<AssistantMessageEvent, AttemptResult> {
  const startedAtMs = Date.now();
  const started = createStartedAttempt(input, startedAtMs);
  const responseHints: { providerHint?: string; retryAfterMs?: number } = {};
  await appendRouteEvent(
    input.options.store,
    input.options.run,
    "route_attempt_started",
    started,
    input.options.onEvent,
  );
  let source: AssistantMessageEventStream;
  try {
    source = await input.input.invoke(input.candidate.model, {
      descriptor: structuredClone(input.candidate.descriptor),
      streamOptions: {
        ...input.candidate.streamOptions,
        onResponse: (response) => {
          Object.assign(responseHints, routeResponseHints(response.headers));
        },
      },
    });
  } catch (error) {
    return settleFailure(
      input,
      started,
      startedAtMs,
      error,
      false,
      responseHints,
    );
  }

  const iterator = source[Symbol.asyncIterator]();
  try {
    const consumed = yield* consumeSource(source, iterator);
    if (consumed.failure !== undefined) {
      return settleFailure(
        input,
        started,
        startedAtMs,
        consumed.failure,
        consumed.visibleOutputProduced,
        responseHints,
      );
    }
    if (!consumed.finalMessage) {
      throw new Error("Model route stream ended without a result");
    }
    const result = await settleMessage(
      input,
      started,
      startedAtMs,
      consumed.finalMessage,
      consumed.visibleOutputProduced,
      responseHints,
    );
    if (result.action === "terminal") {
      for (const buffered of consumed.pending) yield buffered;
    }
    return result;
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

async function* consumeSource(
  source: AssistantMessageEventStream,
  iterator: AsyncIterator<AssistantMessageEvent>,
): AsyncGenerator<AssistantMessageEvent, ConsumedStream> {
  const pending: AssistantMessageEvent[] = [];
  let visibleOutputProduced = false;
  try {
    while (true) {
      const step = await iterator.next();
      if (step.done) {
        return {
          finalMessage: await source.result(),
          visibleOutputProduced,
          pending,
        };
      }
      const event = step.value;
      visibleOutputProduced ||= routeVisibleOutput(event);
      if (!visibleOutputProduced && !terminalEvent(event)) {
        pending.push(event);
        continue;
      }
      if (event.type === "done" || event.type === "error") {
        return {
          finalMessage: event.type === "done" ? event.message : event.error,
          visibleOutputProduced,
          pending,
        };
      }
      if (pending.length > 0) {
        for (const buffered of pending) yield buffered;
        pending.length = 0;
      }
      yield event;
    }
  } catch (failure) {
    return { failure, visibleOutputProduced, pending };
  }
}

async function settleFailure(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  error: unknown,
  visibleOutputProduced: boolean,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<AttemptResult> {
  const failureClass = classifyRouteFailure(error);
  const canFallback = await recordFailure(
    input,
    started,
    startedAtMs,
    failureClass,
    visibleOutputProduced,
    error,
    responseHints,
  );
  return canFallback
    ? { action: "fallback", attempt: input.attempt, reason: failureClass }
    : {
        action: "terminal",
        message: routeFailureMessage(
          input.candidate.model,
          error,
          input.input.signal.aborted,
        ),
      };
}

async function settleMessage(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  message: AssistantMessage,
  visibleOutputProduced: boolean,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<AttemptResult> {
  const failed =
    message.stopReason === "error" || message.stopReason === "aborted";
  const failureClass = failed ? classifyRouteFailure(message) : undefined;
  if (!failureClass) {
    await input.options.router.markSuccess(input.candidate.descriptor);
    await recordEnded(input, started, startedAtMs, {
      visibleOutputProduced,
      sideEffectState: await routeSideEffectState(
        input.options.store,
        input.options.run,
      ),
      outcome: "success",
    });
    return { action: "terminal", message };
  }
  const canFallback = await recordFailure(
    input,
    started,
    startedAtMs,
    failureClass,
    visibleOutputProduced,
    message,
    responseHints,
  );
  return canFallback
    ? { action: "fallback", attempt: input.attempt, reason: failureClass }
    : { action: "terminal", message };
}

async function recordFailure(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  failureClass: RouteFailureClass,
  visibleOutputProduced: boolean,
  error: unknown,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<boolean> {
  const sideEffectState = await routeSideEffectState(
    input.options.store,
    input.options.run,
  );
  const canFallback = routeCanFallback({
    failureClass,
    visibleOutputProduced,
    sideEffectState,
    hasNextCandidate: input.index + 1 < input.candidateCount,
    aborted: input.input.signal.aborted,
  });
  const hints = { ...responseHints, ...routeFailureHints(error) };
  const cooldown = await input.options.router.markFailure(
    input.candidate.descriptor,
    failureClass,
    hints,
    input.options.plan.retryPolicy,
  );
  await recordEnded(input, started, startedAtMs, {
    visibleOutputProduced,
    sideEffectState,
    outcome: canFallback ? "retryable" : "terminal",
    failureClass,
    diagnosticSha256: sha256(routeErrorText(error)),
    ...(hints.providerHint ? { providerHint: hints.providerHint } : {}),
    ...(hints.retryAfterMs !== undefined
      ? { retryAfterMs: hints.retryAfterMs }
      : {}),
    ...(cooldown.backoffMs > 0 ? { backoffMs: cooldown.backoffMs } : {}),
  });
  return canFallback;
}

function routeFailureHints(error: unknown): {
  providerHint?: string;
  retryAfterMs?: number;
} {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  const headers = normalizedHeaders(
    record["headers"] && typeof record["headers"] === "object"
      ? (record["headers"] as Record<string, unknown>)
      : {},
  );
  const retryAfter =
    record["retryAfterMs"] ??
    headers["retry-after-ms"];
  const retryAfterMs =
    retryAfter !== undefined
      ? parseMilliseconds(retryAfter)
      : parseRetryAfterHeader(headers["retry-after"]);
  const hint =
    record["providerHint"] ??
    headers["x-provider-hint"] ??
    headers["x-ratelimit-scope"];
  const providerHint =
    typeof hint === "string" && /^[A-Za-z0-9._:/ -]{1,120}$/u.test(hint)
      ? hint
      : undefined;
  return {
    ...(providerHint ? { providerHint } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function routeResponseHints(headers: Record<string, string>): {
  providerHint?: string;
  retryAfterMs?: number;
} {
  const normalized = normalizedHeaders(headers);
  const providerHint = safeProviderHint(
    normalized["x-provider-hint"] ?? normalized["x-ratelimit-scope"],
  );
  const retryAfterMs =
    parseMilliseconds(normalized["retry-after-ms"]) ??
    parseRetryAfterHeader(normalized["retry-after"]);
  return {
    ...(providerHint ? { providerHint } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function parseMilliseconds(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.min(300_000, Math.round(numeric));
}

function parseRetryAfterHeader(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(300_000, Math.round(seconds * 1_000));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.min(300_000, Math.max(0, timestamp - Date.now()))
    : undefined;
}

function normalizedHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function safeProviderHint(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:/ -]{1,120}$/u.test(value)
    ? value
    : undefined;
}

async function recordEnded(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  completion: Parameters<typeof finalizeRouteAttempt>[1],
): Promise<void> {
  await appendRouteEvent(
    input.options.store,
    input.options.run,
    "route_attempt_ended",
    finalizeRouteAttempt(started, {
      ...completion,
      finishedAt: nowIso(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
    }),
    input.options.onEvent,
  );
}

function createStartedAttempt(
  input: Parameters<typeof runCandidate>[0],
  startedAtMs: number,
): ModelRouteAttempt {
  return routeAttempt({
    routePlanId: input.options.plan.id,
    attemptId: createId("route_attempt"),
    attempt: input.attempt,
    stepAttempt: input.index + 1,
    ...input.candidate.descriptor,
    ...input.options.router.candidateHealth(input.candidate.descriptor),
    startedAt: new Date(startedAtMs).toISOString(),
    visibleOutputProduced: false,
    sideEffectState: "none",
    ...(input.fallbackFromAttempt !== undefined
      ? { fallbackFromAttempt: input.fallbackFromAttempt }
      : {}),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
  });
}

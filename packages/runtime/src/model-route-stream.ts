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
import { nowIso } from "./ids.js";
import {
  appendRouteEvent,
  createStartedRouteAttempt,
  finalizeRouteAttempt,
  routeFailureMessage,
  routeSideEffectState,
  terminalFromMessage,
} from "./model-route-evidence.js";
import {
  routeCanFallback,
  routeCanRetrySameCandidate,
  routeErrorText,
} from "./model-route-policy.js";
import {
  consumeModelRouteSource,
  type ModelRouteOutputProgress,
} from "./model-route-output-buffer.js";
import {
  classifyRouteAttemptFailure,
  MAX_INLINE_RETRY_DELAY_MS,
  routeFailureHints,
  routeResponseHints,
} from "./model-route-provider-evidence.js";
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
  waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void>;
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
  | {
      action: "retry";
      attempt: number;
      reason: RouteFailureClass;
      delayMs: number;
    }
  | { action: "terminal"; message: AssistantMessage };

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
  let currentModel = candidates[0]!.model;
  let terminalProduced = false;
  let index = 0;
  let stepAttempt = 0;
  let sameCandidateRetryUsed = false;
  let fallbackFromAttempt: number | undefined;
  let fallbackReason: RouteFailureClass | undefined;
  let retryFromAttempt: number | undefined;
  let retryReason: RouteFailureClass | undefined;
  let retryDelayMs: number | undefined;
  try {
    while (index < candidates.length) {
      stepAttempt += 1;
      currentModel = candidates[index]!.model;
      const result = yield* runCandidate({
        options,
        input,
        candidate: candidates[index]!,
        index,
        candidateCount: candidates.length,
        attempt: nextAttempt(),
        stepAttempt,
        hasRetryAttempt:
          !sameCandidateRetryUsed &&
          stepAttempt < options.plan.retryPolicy.maxAttemptsPerStep,
        ...(fallbackFromAttempt !== undefined ? { fallbackFromAttempt } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
        ...(retryFromAttempt !== undefined ? { retryFromAttempt } : {}),
        ...(retryReason ? { retryReason } : {}),
        ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
      });
      if (result.action === "terminal") {
        settle(result.message);
        terminalProduced = true;
        yield terminalFromMessage(result.message);
        return;
      }
      if (result.action === "retry") {
        sameCandidateRetryUsed = true;
        fallbackFromAttempt = undefined;
        fallbackReason = undefined;
        retryFromAttempt = result.attempt;
        retryReason = result.reason;
        retryDelayMs = result.delayMs;
        await options.router.waitBeforeRetry(result.delayMs, input.signal);
        continue;
      }
      index += 1;
      fallbackFromAttempt = result.attempt;
      fallbackReason = result.reason;
      retryFromAttempt = undefined;
      retryReason = undefined;
      retryDelayMs = undefined;
    }
    throw new Error("Model route exhausted without a terminal result");
  } catch (error) {
    const message = routeFailureMessage(
      currentModel,
      error,
      input.signal.aborted,
    );
    settle(message);
    terminalProduced = true;
    yield terminalFromMessage(message);
  } finally {
    if (!terminalProduced) {
      settle(
        routeFailureMessage(
          currentModel,
          new Error("Model route stream closed before a terminal result"),
          true,
        ),
      );
    }
  }
}

async function* runCandidate(input: {
  options: StreamOptions;
  input: StreamInput;
  candidate: ResolvedRouteCandidate;
  index: number;
  candidateCount: number;
  attempt: number;
  stepAttempt: number;
  hasRetryAttempt: boolean;
  fallbackFromAttempt?: number;
  fallbackReason?: RouteFailureClass;
  retryFromAttempt?: number;
  retryReason?: RouteFailureClass;
  retryDelayMs?: number;
}): AsyncGenerator<AssistantMessageEvent, AttemptResult> {
  const startedAtMs = Date.now();
  const started = createStartedRouteAttempt({
    routePlanId: input.options.plan.id,
    attempt: input.attempt,
    stepAttempt: input.stepAttempt,
    candidate: input.candidate.descriptor,
    health: input.options.router.candidateHealth(input.candidate.descriptor),
    startedAtMs,
    ...(input.fallbackFromAttempt !== undefined
      ? { fallbackFromAttempt: input.fallbackFromAttempt }
      : {}),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.retryFromAttempt !== undefined
      ? { retryFromAttempt: input.retryFromAttempt }
      : {}),
    ...(input.retryReason ? { retryReason: input.retryReason } : {}),
    ...(input.retryDelayMs !== undefined
      ? { retryDelayMs: input.retryDelayMs }
      : {}),
  });
  const responseHints: { providerHint?: string; retryAfterMs?: number } = {};
  const startedEvent = await appendRouteEvent(
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
      0,
      startedEvent.seq,
      responseHints,
    );
  }

  const iterator = source[Symbol.asyncIterator]();
  const progress: ModelRouteOutputProgress = {
    visibleOutputProduced: false,
    bufferedThinkingBytes: 0,
  };
  let attemptEnded = false;
  try {
    const consumed = yield* consumeModelRouteSource(source, iterator, progress);
    if (consumed.failure !== undefined) {
      const result = await settleFailure(
        input,
        started,
        startedAtMs,
        consumed.failure,
        consumed.visibleOutputProduced,
        consumed.bufferedThinkingBytes,
        startedEvent.seq,
        responseHints,
      );
      attemptEnded = true;
      return result;
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
      consumed.bufferedThinkingBytes,
      startedEvent.seq,
      responseHints,
    );
    attemptEnded = true;
    if (result.action === "terminal") {
      for (const buffered of consumed.pending) yield buffered;
    }
    return result;
  } finally {
    await Promise.resolve(iterator.return?.()).catch(() => undefined);
    if (!attemptEnded) {
      await recordEnded(input, started, startedAtMs, {
        visibleOutputProduced: progress.visibleOutputProduced,
        sideEffectState: await routeSideEffectState(
          input.options.store,
          input.options.run,
          startedEvent.seq,
        ),
        outcome: "terminal",
        failureClass: "cancelled",
        ...(progress.bufferedThinkingBytes > 0
          ? { bufferedThinkingBytes: progress.bufferedThinkingBytes }
          : {}),
        diagnosticSha256: sha256(
          "Model route stream closed before a terminal result",
        ),
      });
    }
  }
}

async function settleFailure(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  error: unknown,
  visibleOutputProduced: boolean,
  bufferedThinkingBytes: number,
  attemptStartedSeq: number,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<AttemptResult> {
  const failureClass = classifyRouteAttemptFailure(
    error,
    input.input.signal.aborted,
  );
  const continuation = await recordFailure(
    input,
    started,
    startedAtMs,
    failureClass,
    visibleOutputProduced,
    bufferedThinkingBytes,
    attemptStartedSeq,
    error,
    responseHints,
  );
  return continuation
    ? { ...continuation, attempt: input.attempt, reason: failureClass }
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
  bufferedThinkingBytes: number,
  attemptStartedSeq: number,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<AttemptResult> {
  const failed =
    message.stopReason === "error" || message.stopReason === "aborted";
  const failureClass = failed
    ? classifyRouteAttemptFailure(message, input.input.signal.aborted)
    : undefined;
  if (!failureClass) {
    await input.options.router.markSuccess(input.candidate.descriptor);
    await recordEnded(input, started, startedAtMs, {
      visibleOutputProduced,
      sideEffectState: await routeSideEffectState(
        input.options.store,
        input.options.run,
        attemptStartedSeq,
      ),
      ...(bufferedThinkingBytes > 0 ? { bufferedThinkingBytes } : {}),
      outcome: "success",
    });
    return { action: "terminal", message };
  }
  const continuation = await recordFailure(
    input,
    started,
    startedAtMs,
    failureClass,
    visibleOutputProduced,
    bufferedThinkingBytes,
    attemptStartedSeq,
    message,
    responseHints,
  );
  return continuation
    ? { ...continuation, attempt: input.attempt, reason: failureClass }
    : { action: "terminal", message };
}

async function recordFailure(
  input: Parameters<typeof runCandidate>[0],
  started: ModelRouteAttempt,
  startedAtMs: number,
  failureClass: RouteFailureClass,
  visibleOutputProduced: boolean,
  bufferedThinkingBytes: number,
  attemptStartedSeq: number,
  error: unknown,
  responseHints: { providerHint?: string; retryAfterMs?: number },
): Promise<
  { action: "fallback" } | { action: "retry"; delayMs: number } | undefined
> {
  const sideEffectState = await routeSideEffectState(
    input.options.store,
    input.options.run,
    attemptStartedSeq,
  );
  const canFallback = routeCanFallback({
    failureClass,
    visibleOutputProduced,
    sideEffectState,
    hasNextCandidate: input.index + 1 < input.candidateCount,
    aborted: input.input.signal.aborted,
  });
  const hints = { ...responseHints, ...routeFailureHints(error) };
  const canRetry =
    !canFallback &&
    (hints.retryAfterMs ?? 0) <= MAX_INLINE_RETRY_DELAY_MS &&
    routeCanRetrySameCandidate({
      failureClass,
      visibleOutputProduced,
      sideEffectState,
      hasRetryAttempt: input.hasRetryAttempt,
      aborted: input.input.signal.aborted,
    });
  const cooldown = await input.options.router.markFailure(
    input.candidate.descriptor,
    failureClass,
    hints,
    input.options.plan.retryPolicy,
  );
  const retryDelayMs = canRetry
    ? Math.min(cooldown.backoffMs, MAX_INLINE_RETRY_DELAY_MS)
    : 0;
  await recordEnded(input, started, startedAtMs, {
    visibleOutputProduced,
    sideEffectState,
    outcome: canFallback || canRetry ? "retryable" : "terminal",
    failureClass,
    ...(bufferedThinkingBytes > 0 ? { bufferedThinkingBytes } : {}),
    diagnosticSha256: sha256(routeErrorText(error)),
    ...(hints.providerHint ? { providerHint: hints.providerHint } : {}),
    ...(hints.retryAfterMs !== undefined
      ? { retryAfterMs: hints.retryAfterMs }
      : {}),
    ...(cooldown.backoffMs > 0 ? { backoffMs: cooldown.backoffMs } : {}),
  });
  if (canFallback) return { action: "fallback" };
  if (canRetry) return { action: "retry", delayMs: retryDelayMs };
  return undefined;
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

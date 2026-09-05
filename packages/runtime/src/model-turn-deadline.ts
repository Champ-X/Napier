import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { RouteFailureClass } from "@napier/contracts/model-route";

import { publicModelFailureMessage } from "./agent-runtime-utils.js";
import { classifyRouteFailure } from "./model-route-policy.js";
import { parseModelThinkingLoopError } from "./model-thinking-loop-policy.js";

export type ModelTurnWatchdogReason =
  | "first_event_timeout"
  | "idle_timeout"
  | "semantic_progress_timeout"
  | "turn_timeout";

export interface ModelTurnDeadlinePolicy {
  turnTimeoutMs: number;
  firstEventTimeoutMs: number;
  idleTimeoutMs: number;
  semanticProgressTimeoutMs: number;
}

export interface ModelTurnWatchdogEvidence extends ModelTurnDeadlinePolicy {
  reason: ModelTurnWatchdogReason;
  limitMs: number;
}

export const DEFAULT_MODEL_TURN_DEADLINE_POLICY: Readonly<ModelTurnDeadlinePolicy> =
  {
    turnTimeoutMs: 300_000,
    firstEventTimeoutMs: 45_000,
    idleTimeoutMs: 90_000,
    semanticProgressTimeoutMs: 90_000,
  };

const WATCHDOG_MESSAGE =
  /^Model turn watchdog triggered: (first_event_timeout|idle_timeout|semantic_progress_timeout|turn_timeout) after (\d+) ms \(turn=(\d+), first=(\d+), idle=(\d+), semantic=(\d+)\)\.$/u;

export class ModelTurnWatchdogError extends Error {
  constructor(readonly evidence: ModelTurnWatchdogEvidence) {
    super(watchdogMessage(evidence));
    this.name = "ModelTurnWatchdogError";
  }
}

export interface ModelProviderFailureEvidence {
  failureClass: RouteFailureClass;
  message: string;
}

export class ModelProviderFailureError extends Error {
  constructor(readonly evidence: ModelProviderFailureEvidence) {
    super(evidence.message);
    this.name = "ModelProviderFailureError";
  }
}

export function isModelProviderFailureError(
  value: unknown,
): value is ModelProviderFailureError {
  return value instanceof ModelProviderFailureError;
}

export function isModelTurnWatchdogError(
  value: unknown,
): value is ModelTurnWatchdogError {
  return value instanceof ModelTurnWatchdogError;
}

export interface ModelTurnDeadline {
  readonly signal: AbortSignal;
  readonly evidence: ModelTurnWatchdogEvidence | undefined;
  observe(event: AssistantMessageEvent): void;
  finish(): void;
}

export function createModelTurnDeadline(input: {
  rootSignal?: AbortSignal;
  remainingRunMs: number;
  policy?: Partial<ModelTurnDeadlinePolicy>;
  onTrigger?: (evidence: ModelTurnWatchdogEvidence) => Promise<void> | void;
}): ModelTurnDeadline {
  const policy = resolvePolicy(input.remainingRunMs, input.policy);
  const controller = new AbortController();
  const signal = input.rootSignal
    ? AbortSignal.any([input.rootSignal, controller.signal])
    : controller.signal;
  let evidence: ModelTurnWatchdogEvidence | undefined;
  let firstEventSeen = false;
  let turnTimer: ReturnType<typeof setTimeout> | undefined;
  let firstEventTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let semanticProgressTimer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (turnTimer) clearTimeout(turnTimer);
    if (firstEventTimer) clearTimeout(firstEventTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (semanticProgressTimer) clearTimeout(semanticProgressTimer);
    turnTimer = undefined;
    firstEventTimer = undefined;
    idleTimer = undefined;
    semanticProgressTimer = undefined;
  };
  const trigger = (reason: ModelTurnWatchdogReason, limitMs: number): void => {
    if (signal.aborted || evidence) return;
    evidence = { ...policy, reason, limitMs };
    clear();
    controller.abort(new ModelTurnWatchdogError(evidence));
    void Promise.resolve(input.onTrigger?.(evidence)).catch(() => undefined);
  };
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => trigger("idle_timeout", policy.idleTimeoutMs),
      policy.idleTimeoutMs,
    );
    idleTimer.unref?.();
  };
  const armSemanticProgress = (): void => {
    if (semanticProgressTimer) clearTimeout(semanticProgressTimer);
    semanticProgressTimer = setTimeout(
      () =>
        trigger("semantic_progress_timeout", policy.semanticProgressTimeoutMs),
      policy.semanticProgressTimeoutMs,
    );
    semanticProgressTimer.unref?.();
  };
  const finish = (): void => {
    clear();
  };

  if (!signal.aborted) {
    turnTimer = setTimeout(
      () => trigger("turn_timeout", policy.turnTimeoutMs),
      policy.turnTimeoutMs,
    );
    firstEventTimer = setTimeout(
      () => trigger("first_event_timeout", policy.firstEventTimeoutMs),
      policy.firstEventTimeoutMs,
    );
    turnTimer.unref?.();
    firstEventTimer.unref?.();
  }
  input.rootSignal?.addEventListener("abort", finish, { once: true });

  return {
    signal,
    get evidence() {
      return evidence;
    },
    observe(event) {
      if (signal.aborted || evidence) return;
      const firstEvent = !firstEventSeen;
      if (!firstEventSeen) {
        firstEventSeen = true;
        if (firstEventTimer) clearTimeout(firstEventTimer);
        firstEventTimer = undefined;
      }
      if (event.type === "done" || event.type === "error") {
        finish();
      } else {
        armIdle();
        if (firstEvent || hasSemanticProgress(event)) armSemanticProgress();
      }
    },
    finish,
  };
}

export function modelFailureError(
  stopReason: "error" | "aborted",
  diagnostic: string | undefined,
  rootSignalAborted = stopReason === "aborted",
): Error {
  const watchdog = parseModelTurnWatchdogError(diagnostic);
  const classifiedFailure = classifyRouteFailure({
    message: diagnostic ?? "",
  });
  const providerAborted =
    !rootSignalAborted &&
    (stopReason === "aborted" ||
      classifiedFailure === "cancelled" ||
      /\baborterror\b/iu.test(diagnostic ?? ""));
  return (
    watchdog ??
    parseModelThinkingLoopError(diagnostic) ??
    new ModelProviderFailureError({
      failureClass: providerAborted
        ? "network"
        : stopReason === "aborted"
          ? "cancelled"
          : classifiedFailure,
      message: publicModelFailureMessage(
        providerAborted ? "error" : stopReason,
        providerAborted ? "network error" : diagnostic,
      ),
    })
  );
}

function resolvePolicy(
  remainingRunMs: number,
  override: Partial<ModelTurnDeadlinePolicy> | undefined,
): ModelTurnDeadlinePolicy {
  const remaining = positiveInteger(remainingRunMs, "remaining Run deadline");
  const turnTimeoutMs = Math.min(
    remaining,
    positiveInteger(
      override?.turnTimeoutMs ??
        DEFAULT_MODEL_TURN_DEADLINE_POLICY.turnTimeoutMs,
      "model turn timeout",
    ),
  );
  return {
    turnTimeoutMs,
    firstEventTimeoutMs: Math.min(
      turnTimeoutMs,
      positiveInteger(
        override?.firstEventTimeoutMs ??
          DEFAULT_MODEL_TURN_DEADLINE_POLICY.firstEventTimeoutMs,
        "model first-event timeout",
      ),
    ),
    idleTimeoutMs: Math.min(
      turnTimeoutMs,
      positiveInteger(
        override?.idleTimeoutMs ??
          DEFAULT_MODEL_TURN_DEADLINE_POLICY.idleTimeoutMs,
        "model idle timeout",
      ),
    ),
    semanticProgressTimeoutMs: Math.min(
      turnTimeoutMs,
      positiveInteger(
        override?.semanticProgressTimeoutMs ??
          DEFAULT_MODEL_TURN_DEADLINE_POLICY.semanticProgressTimeoutMs,
        "model semantic-progress timeout",
      ),
    ),
  };
}

export function parseModelTurnWatchdogError(
  diagnostic: string | undefined,
): ModelTurnWatchdogError | undefined {
  const match = diagnostic ? WATCHDOG_MESSAGE.exec(diagnostic) : undefined;
  if (!match) return undefined;
  const reason = match[1] as ModelTurnWatchdogReason;
  const limitMs = Number(match[2]);
  const turnTimeoutMs = Number(match[3]);
  const firstEventTimeoutMs = Number(match[4]);
  const idleTimeoutMs = Number(match[5]);
  const semanticProgressTimeoutMs = Number(match[6]);
  if (
    [
      limitMs,
      turnTimeoutMs,
      firstEventTimeoutMs,
      idleTimeoutMs,
      semanticProgressTimeoutMs,
    ].some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    return undefined;
  }
  return new ModelTurnWatchdogError({
    turnTimeoutMs,
    firstEventTimeoutMs,
    idleTimeoutMs,
    semanticProgressTimeoutMs,
    reason,
    limitMs,
  });
}

function watchdogMessage(evidence: ModelTurnWatchdogEvidence): string {
  return `Model turn watchdog triggered: ${evidence.reason} after ${String(evidence.limitMs)} ms (turn=${String(evidence.turnTimeoutMs)}, first=${String(evidence.firstEventTimeoutMs)}, idle=${String(evidence.idleTimeoutMs)}, semantic=${String(evidence.semanticProgressTimeoutMs)}).`;
}

function hasSemanticProgress(event: AssistantMessageEvent): boolean {
  if (event.type === "text_delta" || event.type === "toolcall_delta") {
    return event.delta.trim().length > 0;
  }
  if (event.type === "text_end") {
    return event.content.trim().length > 0;
  }
  return event.type === "toolcall_end";
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

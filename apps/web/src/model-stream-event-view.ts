import type { RunEvent } from "@napier/contracts";

interface ModelStreamEventView {
  action: "stream.watchdog_triggered" | "stream.cancellation_failed";
  provider: string;
  model: string;
  reason?: string;
  limitMs?: number;
  turnTimeoutMs?: number;
  firstEventTimeoutMs?: number;
  idleTimeoutMs?: number;
  semanticProgressTimeoutMs?: number;
  graceMs?: number;
  contentSha256: string;
}

const TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export function modelStreamEventTraceSummary(
  event: RunEvent,
): string | undefined {
  const view = modelStreamEventView(event);
  if (!view)
    return event.type.startsWith("model.stream.") ? "model receipt" : undefined;
  return [
    `model / ${view.action}`,
    `content ${view.contentSha256.slice(0, 12)}`,
    `provider ${view.provider}`,
    `model ${view.model}`,
    ...(view.reason ? [`reason ${view.reason}`] : []),
    ...(view.limitMs !== undefined ? [`limit-ms ${view.limitMs}`] : []),
    ...(view.turnTimeoutMs !== undefined
      ? [`turn-ms ${view.turnTimeoutMs}`]
      : []),
    ...(view.firstEventTimeoutMs !== undefined
      ? [`first-ms ${view.firstEventTimeoutMs}`]
      : []),
    ...(view.idleTimeoutMs !== undefined
      ? [`idle-ms ${view.idleTimeoutMs}`]
      : []),
    ...(view.semanticProgressTimeoutMs !== undefined
      ? [`semantic-ms ${view.semanticProgressTimeoutMs}`]
      : []),
    ...(view.graceMs !== undefined ? [`grace-ms ${view.graceMs}`] : []),
  ].join(" / ");
}

function modelStreamEventView(
  event: RunEvent,
): ModelStreamEventView | undefined {
  if (
    event.type !== "model.stream.watchdog_triggered" &&
    event.type !== "model.stream.cancellation_failed"
  ) {
    return undefined;
  }
  const payload = record(event.payload);
  const provider = token(payload?.["provider"]);
  const model = token(payload?.["model"]);
  const contentSha256 = hash(payload?.["contentSha256"]);
  if (!payload || !provider || !model || !contentSha256) return undefined;
  if (event.type === "model.stream.cancellation_failed") {
    const graceMs = integer(payload["graceMs"]);
    return graceMs === undefined
      ? undefined
      : {
          action: "stream.cancellation_failed",
          provider,
          model,
          graceMs,
          contentSha256,
        };
  }
  const reason = token(payload["reason"]);
  const limitMs = integer(payload["limitMs"]);
  const turnTimeoutMs = integer(payload["turnTimeoutMs"]);
  const firstEventTimeoutMs = integer(payload["firstEventTimeoutMs"]);
  const idleTimeoutMs = integer(payload["idleTimeoutMs"]);
  const semanticProgressTimeoutMs = integer(
    payload["semanticProgressTimeoutMs"],
  );
  return reason &&
    limitMs !== undefined &&
    turnTimeoutMs !== undefined &&
    firstEventTimeoutMs !== undefined &&
    idleTimeoutMs !== undefined
    ? {
        action: "stream.watchdog_triggered",
        provider,
        model,
        reason,
        limitMs,
        turnTimeoutMs,
        firstEventTimeoutMs,
        idleTimeoutMs,
        ...(semanticProgressTimeoutMs !== undefined
          ? { semanticProgressTimeoutMs }
          : {}),
        contentSha256,
      }
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && HASH.test(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

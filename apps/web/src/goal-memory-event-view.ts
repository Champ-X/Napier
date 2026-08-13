import type { RunEvent } from "@napier/contracts";

export interface GoalEventTraceView {
  action: string;
  status?: string;
  blocker?: string;
  satisfied?: boolean;
  continuation?: number;
  maxContinuations?: number;
  noProgressCount?: number;
}

export interface MemoryEventTraceView {
  action: string;
  memoryId?: string;
  status?: string;
  category?: string;
  scope?: string;
  confidence?: number;
  proposed?: number;
  created?: number;
  corrections?: number;
  consolidations?: number;
  useCount?: number;
  reviewIntervalDays?: number;
  reason?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/u;
const MEMORY_ID = /^memory_[a-z0-9]{8,80}$/u;
const GOAL_RECEIPT_SUMMARY = "goal receipt";
const MEMORY_RECEIPT_SUMMARY = "memory receipt";

export function goalEventTraceView(
  event: RunEvent,
): GoalEventTraceView | undefined {
  if (!event.type.startsWith("goal.")) return undefined;
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const status = safeToken(event.payload["status"]);
  const blocker = safeToken(event.payload["blocker"]);
  const continuation = nonNegativeInteger(event.payload["continuation"]);
  const continuationCount = nonNegativeInteger(
    event.payload["continuationCount"],
  );
  const maxContinuations = nonNegativeInteger(
    event.payload["maxContinuations"],
  );
  const noProgressCount = nonNegativeInteger(event.payload["noProgressCount"]);
  const satisfied =
    typeof event.payload["satisfied"] === "boolean"
      ? event.payload["satisfied"]
      : undefined;
  return {
    action: event.type.slice("goal.".length),
    ...(status ? { status } : {}),
    ...(blocker ? { blocker } : {}),
    ...(satisfied !== undefined ? { satisfied } : {}),
    ...(continuation !== undefined
      ? { continuation }
      : continuationCount !== undefined
        ? { continuation: continuationCount }
        : {}),
    ...(maxContinuations !== undefined ? { maxContinuations } : {}),
    ...(noProgressCount !== undefined ? { noProgressCount } : {}),
  };
}

export function memoryEventTraceView(
  event: RunEvent,
): MemoryEventTraceView | undefined {
  if (!event.type.startsWith("memory.")) return undefined;
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const memoryId = memoryIdValue(event.payload["memoryId"]);
  const status = safeToken(event.payload["status"]);
  const category = safeToken(event.payload["category"]);
  const scope = safeToken(event.payload["scope"]);
  const reason = safeToken(event.payload["reason"]);
  const confidence = boundedNumber(event.payload["confidence"], 0, 1);
  const proposed = nonNegativeInteger(event.payload["proposed"]);
  const created = nonNegativeInteger(event.payload["created"]);
  const corrections = nonNegativeInteger(event.payload["corrections"]);
  const consolidations = nonNegativeInteger(event.payload["consolidations"]);
  const useCount = nonNegativeInteger(event.payload["useCount"]);
  const reviewIntervalDays = nonNegativeInteger(
    event.payload["reviewIntervalDays"],
  );
  return {
    action: event.type.slice("memory.".length),
    ...(memoryId ? { memoryId } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(scope ? { scope } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(proposed !== undefined ? { proposed } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(corrections !== undefined ? { corrections } : {}),
    ...(consolidations !== undefined ? { consolidations } : {}),
    ...(useCount !== undefined ? { useCount } : {}),
    ...(reviewIntervalDays !== undefined ? { reviewIntervalDays } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function goalEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("goal.")) return undefined;
  const view = goalEventTraceView(event);
  if (!view) return GOAL_RECEIPT_SUMMARY;
  return [
    `goal / ${view.action}`,
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.blocker ? [`blocker ${view.blocker}`] : []),
    ...(view.satisfied !== undefined ? [`satisfied ${view.satisfied}`] : []),
    ...(view.continuation !== undefined
      ? [
          `continuation ${view.continuation}${
            view.maxContinuations !== undefined
              ? `/${view.maxContinuations}`
              : ""
          }`,
        ]
      : view.maxContinuations !== undefined
        ? [`max-continuations ${view.maxContinuations}`]
        : []),
    ...(view.noProgressCount !== undefined
      ? [`no-progress ${view.noProgressCount}`]
      : []),
  ].join(" / ");
}

export function memoryEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("memory.")) return undefined;
  const view = memoryEventTraceView(event);
  if (!view) return MEMORY_RECEIPT_SUMMARY;
  return [
    `memory / ${view.action}`,
    ...(view.memoryId ? [`id ${view.memoryId.slice(-10)}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.category ? [`category ${view.category}`] : []),
    ...(view.scope ? [`scope ${view.scope}`] : []),
    ...(view.confidence !== undefined ? [`confidence ${view.confidence}`] : []),
    ...(view.proposed !== undefined ? [`proposed ${view.proposed}`] : []),
    ...(view.created !== undefined ? [`created ${view.created}`] : []),
    ...(view.corrections !== undefined
      ? [`corrections ${view.corrections}`]
      : []),
    ...(view.consolidations !== undefined
      ? [`consolidations ${view.consolidations}`]
      : []),
    ...(view.useCount !== undefined ? [`uses ${view.useCount}`] : []),
    ...(view.reviewIntervalDays !== undefined
      ? [`review ${view.reviewIntervalDays}d`]
      : []),
    ...(view.reason ? [`reason ${view.reason}`] : []),
  ].join(" / ");
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function memoryIdValue(value: unknown): string | undefined {
  return typeof value === "string" && MEMORY_ID.test(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

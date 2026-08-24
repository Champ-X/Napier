import type { RunEvent } from "@napier/contracts";

export interface ModelRouteEventTraceView {
  action: "plan.created" | "attempt.started" | "attempt.ended";
  role?: string;
  candidateCount?: number;
  attempt?: number;
  stepAttempt?: number;
  servingModel?: string;
  outcome?: string;
  failureClass?: string;
  fallbackReason?: string;
  visibleOutputProduced?: boolean;
  sideEffectState?: string;
  durationMs?: number;
  contentSha256?: string;
}

const ROUTE_EVENTS = new Map<string, ModelRouteEventTraceView["action"]>([
  ["route_plan_created", "plan.created"],
  ["route_attempt_started", "attempt.started"],
  ["route_attempt_ended", "attempt.ended"],
]);
const SHA256 = /^[a-f0-9]{64}$/u;

export function modelRouteEventTraceView(
  event: RunEvent,
): ModelRouteEventTraceView | undefined {
  const action = ROUTE_EVENTS.get(event.type);
  const payload = record(event.payload);
  if (!action || !payload) return undefined;
  const providerId = token(payload["providerId"]);
  const modelId = token(payload["modelId"]);
  const candidates = Array.isArray(payload["candidates"])
    ? payload["candidates"]
    : undefined;
  return {
    action,
    ...tokenField(payload, "role"),
    ...(candidates ? { candidateCount: candidates.length } : {}),
    ...integerField(payload, "attempt"),
    ...integerField(payload, "stepAttempt"),
    ...(providerId && modelId
      ? { servingModel: `${providerId}/${modelId}` }
      : {}),
    ...tokenField(payload, "outcome"),
    ...tokenField(payload, "failureClass"),
    ...tokenField(payload, "fallbackReason"),
    ...booleanField(payload, "visibleOutputProduced"),
    ...tokenField(payload, "sideEffectState"),
    ...integerField(payload, "durationMs"),
    ...shaField(payload, "contentSha256"),
  };
}

export function modelRouteEventTraceSummary(
  event: RunEvent,
): string | undefined {
  const view = modelRouteEventTraceView(event);
  if (!view) return undefined;
  return [
    `route / ${view.action}`,
    ...(view.role ? [`role ${view.role}`] : []),
    ...(view.candidateCount !== undefined
      ? [`candidates ${String(view.candidateCount)}`]
      : []),
    ...(view.attempt !== undefined ? [`attempt ${String(view.attempt)}`] : []),
    ...(view.stepAttempt !== undefined
      ? [`step-attempt ${String(view.stepAttempt)}`]
      : []),
    ...(view.servingModel ? [`serving ${view.servingModel}`] : []),
    ...(view.outcome ? [`outcome ${view.outcome}`] : []),
    ...(view.failureClass ? [`failure ${view.failureClass}`] : []),
    ...(view.fallbackReason ? [`fallback ${view.fallbackReason}`] : []),
    ...(view.visibleOutputProduced !== undefined
      ? [`visible-output ${String(view.visibleOutputProduced)}`]
      : []),
    ...(view.sideEffectState
      ? [`side-effects ${view.sideEffectState}`]
      : []),
    ...(view.durationMs !== undefined
      ? [`duration-ms ${String(view.durationMs)}`]
      : []),
    ...(view.contentSha256
      ? [`content ${view.contentSha256.slice(0, 12)}`]
      : []),
  ].join(" / ");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function tokenField(
  payload: Record<string, unknown>,
  key: keyof ModelRouteEventTraceView,
): Partial<ModelRouteEventTraceView> {
  const value = token(payload[key]);
  return value ? { [key]: value } : {};
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,200}$/u.test(value)
    ? value
    : undefined;
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ModelRouteEventTraceView,
): Partial<ModelRouteEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ModelRouteEventTraceView,
): Partial<ModelRouteEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ModelRouteEventTraceView,
): Partial<ModelRouteEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && SHA256.test(value)
    ? { [key]: value }
    : {};
}

import type { RunEvent } from "@napier/contracts";

export interface ModelRouteEventTraceView {
  action: "plan.created" | "attempt.started" | "attempt.ended";
  role?: string;
  path?: string;
  resolutionSource?: string;
  candidateCount?: number;
  candidateChain?: string;
  attempt?: number;
  stepAttempt?: number;
  servingModel?: string;
  sourceModelId?: string;
  endpointProfileId?: string;
  endpointKind?: string;
  dialect?: string;
  credentialPoolId?: string;
  credentialSlotId?: string;
  credentialHealth?: string;
  cooldownUntil?: string;
  outcome?: string;
  failureClass?: string;
  fallbackReason?: string;
  visibleOutputProduced?: boolean;
  sideEffectState?: string;
  durationMs?: number;
  providerHint?: string;
  retryAfterMs?: number;
  backoffMs?: number;
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
  const candidateChain = candidates
    ?.map(candidateLabel)
    .filter((candidate): candidate is string => Boolean(candidate))
    .join(" > ");
  return {
    action,
    ...tokenField(payload, "role"),
    ...tokenField(payload, "path"),
    ...tokenField(payload, "resolutionSource"),
    ...(candidates ? { candidateCount: candidates.length } : {}),
    ...(candidateChain ? { candidateChain } : {}),
    ...integerField(payload, "attempt"),
    ...integerField(payload, "stepAttempt"),
    ...(providerId && modelId
      ? { servingModel: `${providerId}/${modelId}` }
      : {}),
    ...tokenField(payload, "sourceModelId"),
    ...tokenField(payload, "endpointProfileId"),
    ...tokenField(payload, "endpointKind"),
    ...tokenField(payload, "dialect"),
    ...tokenField(payload, "credentialPoolId"),
    ...tokenField(payload, "credentialSlotId"),
    ...tokenField(payload, "credentialHealth"),
    ...tokenField(payload, "cooldownUntil"),
    ...tokenField(payload, "outcome"),
    ...tokenField(payload, "failureClass"),
    ...tokenField(payload, "fallbackReason"),
    ...booleanField(payload, "visibleOutputProduced"),
    ...tokenField(payload, "sideEffectState"),
    ...integerField(payload, "durationMs"),
    ...safeTextField(payload, "providerHint"),
    ...integerField(payload, "retryAfterMs"),
    ...integerField(payload, "backoffMs"),
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
    summaryPart("role", view.role),
    summaryPart("path", view.path),
    summaryPart("source", view.resolutionSource),
    summaryPart("candidates", view.candidateCount),
    summaryPart("chain", view.candidateChain),
    summaryPart("attempt", view.attempt),
    summaryPart("step-attempt", view.stepAttempt),
    summaryPart("serving", view.servingModel),
    summaryPart("source-model", view.sourceModelId),
    summaryPart("endpoint", view.endpointProfileId),
    summaryPart("endpoint-kind", view.endpointKind),
    summaryPart("dialect", view.dialect),
    summaryPart("pool", view.credentialPoolId),
    summaryPart("slot", view.credentialSlotId),
    summaryPart("health", view.credentialHealth),
    summaryPart("cooldown-until", view.cooldownUntil),
    summaryPart("outcome", view.outcome),
    summaryPart("failure", view.failureClass),
    summaryPart("fallback", view.fallbackReason),
    summaryPart("visible-output", view.visibleOutputProduced),
    summaryPart("side-effects", view.sideEffectState),
    summaryPart("duration-ms", view.durationMs),
    summaryPart("provider-hint", view.providerHint),
    summaryPart("retry-after-ms", view.retryAfterMs),
    summaryPart("backoff-ms", view.backoffMs),
    summaryPart("content", view.contentSha256?.slice(0, 12)),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function summaryPart(
  label: string,
  value: string | number | boolean | undefined,
): string | undefined {
  return value === undefined ? undefined : `${label} ${String(value)}`;
}

function candidateLabel(value: unknown): string | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const providerId = token(candidate["providerId"]);
  const modelId = token(candidate["modelId"]);
  return providerId && modelId ? `${providerId}/${modelId}` : undefined;
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

function safeTextField(
  payload: Record<string, unknown>,
  key: keyof ModelRouteEventTraceView,
): Partial<ModelRouteEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && /^[A-Za-z0-9._:/ -]{1,120}$/u.test(value)
    ? { [key]: value }
    : {};
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

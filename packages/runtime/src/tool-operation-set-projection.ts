import type { JsonValue, RunEvent } from "@napier/contracts";

import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";

export interface ProjectedToolOperation {
  operationId: string;
  ordinal: number;
  descriptorSha256: string;
  proposed?: string;
  admitted?: string;
  started?: string;
  settled?: string;
  outcome?: string;
  stateSha256?: string;
  effectSha256?: string;
}

export function projectToolOperationSet(
  events: readonly RunEvent[],
  parentCallId: string,
): ProjectedToolOperation[] {
  const operations = new Map<string, ProjectedToolOperation>();
  const authorityOperationIds = toolExecutionAuthorityOperationIds(events);
  for (const event of [...events].sort(compareEvents)) {
    ingestSetEvent(operations, authorityOperationIds, parentCallId, event);
  }
  return [...operations.values()].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      left.operationId.localeCompare(right.operationId),
  );
}

function ingestSetEvent(
  operations: Map<string, ProjectedToolOperation>,
  authorityOperationIds: ReadonlySet<string>,
  parentCallId: string,
  event: RunEvent,
): void {
  const payload = object(event.payload);
  if (!payload || payload["parentCallId"] !== parentCallId) return;
  // The outer durable execution lease is infrastructure, not one of the
  // domain/provider operations summarized as the tool's operation set.
  if (payload["role"] === "execution_authority") return;
  const operationId = text(payload["operationId"]);
  if (operationId && authorityOperationIds.has(operationId)) return;
  const descriptorSha256 = hash(payload["descriptorSha256"]);
  const phaseStateSha256 = hash(payload["phaseStateSha256"]);
  const ordinal = positiveInteger(payload["ordinal"]);
  if (!operationId || !descriptorSha256 || !phaseStateSha256 || !ordinal) {
    return;
  }
  const existing = operations.get(operationId);
  if (
    existing &&
    (existing.ordinal !== ordinal ||
      existing.descriptorSha256 !== descriptorSha256)
  ) {
    return;
  }
  const operation = existing ?? { operationId, ordinal, descriptorSha256 };
  operations.set(operationId, operation);
  applyPhase(operation, event.type, phaseStateSha256, payload);
}

function applyPhase(
  operation: ProjectedToolOperation,
  eventType: string,
  phaseStateSha256: string,
  payload: Record<string, JsonValue>,
): void {
  if (eventType === "tool.operation.proposed") {
    operation.proposed ??= phaseStateSha256;
  } else if (eventType === "tool.operation.admitted") {
    operation.admitted ??= phaseStateSha256;
  } else if (eventType === "tool.operation.started") {
    operation.started ??= phaseStateSha256;
  } else if (eventType === "tool.operation.settled") {
    operation.settled ??= phaseStateSha256;
    const outcome = text(payload["outcome"]);
    const stateSha256 = hash(payload["stateSha256"]);
    const effectSha256 = hash(payload["effectSha256"]);
    if (outcome && operation.outcome === undefined) operation.outcome = outcome;
    if (stateSha256 && operation.stateSha256 === undefined) {
      operation.stateSha256 = stateSha256;
    }
    if (effectSha256 && operation.effectSha256 === undefined) {
      operation.effectSha256 = effectSha256;
    }
  }
}

function compareEvents(left: RunEvent, right: RunEvent): number {
  return left.seq - right.seq || left.id.localeCompare(right.id);
}

function object(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

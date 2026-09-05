import type { RunEvent } from "@napier/contracts";

import { TOOL_OPERATION_EVENT_TYPES } from "./tool-operation-model.js";
import {
  validToolOperationEventPayload,
  type ToolOperationEventType,
} from "./tool-operation-event-validation.js";

export interface ToolExecutionEventAttribution {
  operationId?: string;
  callIds: readonly string[];
}

const TOOL_EXECUTION_OUTCOME_EVENTS = new Set([
  "tool.blocked",
  "tool.completed",
  "tool.failed",
  "tool.result_reused",
]);

export function assertToolOperationEventIntegrity(
  events: readonly RunEvent[],
): void {
  for (const event of events) {
    if (!event.type.startsWith("tool.operation.")) continue;
    if (
      !isToolOperationEventType(event.type) ||
      !validToolOperationEventPayload(event.type, event.payload)
    ) {
      throw new Error(`Invalid durable tool operation event: ${event.type}`);
    }
  }
}

export function toolExecutionEventAttribution(
  event: RunEvent,
): ToolExecutionEventAttribution {
  const payload = record(event.payload);
  const operationId = text(payload?.["operationId"]);
  const callIds = new Set(
    ["callId", "parentCallId", "targetCallId"].flatMap((field) => {
      const value = text(payload?.[field]);
      return value ? [value] : [];
    }),
  );
  return {
    ...(operationId ? { operationId } : {}),
    callIds: [...callIds],
  };
}

export function publishesToolExecutionOutcome(event: RunEvent): boolean {
  const payload = record(event.payload);
  return (
    TOOL_EXECUTION_OUTCOME_EVENTS.has(event.type) ||
    payload?.["status"] === "completed" ||
    payload?.["status"] === "failed" ||
    payload?.["status"] === "blocked" ||
    payload?.["resultReused"] === true
  );
}

function isToolOperationEventType(
  value: string,
): value is ToolOperationEventType {
  return (TOOL_OPERATION_EVENT_TYPES as readonly string[]).includes(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

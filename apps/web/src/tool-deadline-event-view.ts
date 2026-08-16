import type { RunEvent } from "@napier/contracts";

interface ToolDeadlineEventView {
  action: "deadline.exceeded" | "cancellation.settled";
  toolName: string;
  reason: string;
  effect: string;
  state: string;
  timeoutMs: number;
  graceMs: number;
  callSha256: string;
  contentSha256: string;
}

const TOOL = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;
const TOKEN = /^[A-Za-z0-9_.:-]{1,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export function toolDeadlineEventTraceSummary(
  event: RunEvent,
): string | undefined {
  const view = toolDeadlineEventView(event);
  if (!view)
    return event.type === "tool.deadline.exceeded" ||
      event.type === "tool.cancellation.settled"
      ? "tool receipt"
      : undefined;
  return [
    `tool / ${view.toolName} / ${view.action}`,
    `reason ${view.reason}`,
    `effect ${view.effect}`,
    `state ${view.state}`,
    `timeout-ms ${view.timeoutMs}`,
    `grace-ms ${view.graceMs}`,
    `call ${view.callSha256.slice(0, 12)}`,
    `content ${view.contentSha256.slice(0, 12)}`,
  ].join(" / ");
}

function toolDeadlineEventView(
  event: RunEvent,
): ToolDeadlineEventView | undefined {
  const action =
    event.type === "tool.deadline.exceeded"
      ? "deadline.exceeded"
      : event.type === "tool.cancellation.settled"
        ? "cancellation.settled"
        : undefined;
  const payload = record(event.payload);
  const toolName = tool(payload?.["toolName"]);
  const reason = token(payload?.["reason"]);
  const effect = token(payload?.["effect"]);
  const state = token(payload?.["state"]);
  const timeoutMs = integer(payload?.["timeoutMs"]);
  const graceMs = integer(payload?.["graceMs"]);
  const callSha256 = hash(payload?.["callSha256"]);
  const contentSha256 = hash(payload?.["contentSha256"]);
  return action &&
    payload &&
    toolName &&
    reason &&
    effect &&
    state &&
    timeoutMs !== undefined &&
    graceMs !== undefined &&
    callSha256 &&
    contentSha256
    ? {
        action,
        toolName,
        reason,
        effect,
        state,
        timeoutMs,
        graceMs,
        callSha256,
        contentSha256,
      }
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function tool(value: unknown): string | undefined {
  return typeof value === "string" && TOOL.test(value) ? value : undefined;
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

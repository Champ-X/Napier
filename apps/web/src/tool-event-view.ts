import type { RunEvent } from "@napier/contracts";

export interface ToolEventTraceView {
  toolName: string;
  status: string;
  effect?: "read" | "write";
  inputSha256?: string;
  loopGuardTriggerSha256?: string;
}

const TOOL_EVENT_PATTERN = /^tool\.(started|completed|failed|blocked)$/u;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,160}$/u;
const STATUS = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_RECEIPT_SUMMARY = "tool receipt";

export function toolEventTraceView(
  event: RunEvent,
): ToolEventTraceView | undefined {
  if (
    !TOOL_EVENT_PATTERN.test(event.type) ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const toolName = safeToolName(event.payload["toolName"]);
  const status = safeStatus(event.payload["status"]) ?? statusFromEvent(event);
  if (!toolName || !status) return undefined;
  const effect = safeEffect(event.payload["effect"]);
  const inputSha256 = sha256(event.payload["inputSha256"]);
  const loopGuardTriggerSha256 = sha256(
    event.payload["loopGuardTriggerSha256"],
  );
  return {
    toolName,
    status,
    ...(effect ? { effect } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(loopGuardTriggerSha256 ? { loopGuardTriggerSha256 } : {}),
  };
}

export function toolEventTraceSummary(event: RunEvent): string | undefined {
  if (!TOOL_EVENT_PATTERN.test(event.type)) return undefined;
  const view = toolEventTraceView(event);
  if (!view) return TOOL_RECEIPT_SUMMARY;
  return [
    `tool / ${view.toolName}`,
    view.status,
    ...(view.effect ? [`effect ${view.effect}`] : []),
    ...(view.inputSha256 ? [`input ${view.inputSha256.slice(0, 12)}`] : []),
    ...(view.loopGuardTriggerSha256
      ? [`loop ${view.loopGuardTriggerSha256.slice(0, 12)}`]
      : []),
  ].join(" / ");
}

function statusFromEvent(event: RunEvent): string | undefined {
  if (event.type === "tool.started") return "started";
  if (event.type === "tool.completed") return "completed";
  if (event.type === "tool.failed") return "failed";
  if (event.type === "tool.blocked") return "blocked";
  return undefined;
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME.test(value) ? value : undefined;
}

function safeStatus(value: unknown): string | undefined {
  return typeof value === "string" && STATUS.test(value) ? value : undefined;
}

function safeEffect(value: unknown): "read" | "write" | undefined {
  return value === "read" || value === "write" ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

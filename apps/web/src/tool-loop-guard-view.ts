import type { RunEvent } from "@napier/contracts";

export interface ToolLoopGuardTriggerView {
  eventSeq: number;
  runId: string;
  toolName: string;
  attemptCount: number;
  fromSeq: number;
  toSeq: number;
  callSha256: string;
  resultSha256: string;
  contentSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;

export function toolLoopGuardTriggerViews(
  events: readonly RunEvent[],
): ToolLoopGuardTriggerView[] {
  return events.flatMap((event): ToolLoopGuardTriggerView[] => {
    if (
      event.type !== "model.tool_loop.detected" ||
      !event.payload ||
      Array.isArray(event.payload) ||
      typeof event.payload !== "object"
    ) {
      return [];
    }
    const payload = event.payload;
    const toolName = payload["toolName"];
    const attemptCount = positiveInteger(payload["attemptCount"]);
    const fromSeq = positiveInteger(payload["fromSeq"]);
    const toSeq = positiveInteger(payload["toSeq"]);
    const callSha256 = hash(payload["callSha256"]);
    const resultSha256 = hash(payload["resultSha256"]);
    const contentSha256 = hash(payload["contentSha256"]);
    if (
      typeof toolName !== "string" ||
      !TOOL_NAME.test(toolName) ||
      attemptCount === undefined ||
      fromSeq === undefined ||
      toSeq === undefined ||
      fromSeq > toSeq ||
      !callSha256 ||
      !resultSha256 ||
      !contentSha256
    ) {
      return [];
    }
    return [
      {
        eventSeq: event.seq,
        runId: event.runId,
        toolName,
        attemptCount,
        fromSeq,
        toSeq,
        callSha256,
        resultSha256,
        contentSha256,
      },
    ];
  });
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

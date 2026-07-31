import type {
  RunEvent,
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentObservation,
  ToolInvocationExperimentStatus,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export function observeSourceToolInvocation(input: {
  sourceThreadId: string;
  sourceRunId: string;
  toolName: string;
  startedEvent: RunEvent;
  terminalEvent: RunEvent;
}): ToolInvocationExperimentObservation {
  const payload = eventPayload(input.terminalEvent);
  if (
    input.terminalEvent.type !== "tool.completed" ||
    payload["toolName"] !== input.toolName ||
    payload["status"] !== "completed" ||
    !hash(payload["outputTextSha256"]) ||
    !nonNegativeInteger(payload["outputTextBytes"])
  ) {
    throw new Error(
      "Tool invocation experiment requires a completed source call",
    );
  }
  return {
    threadId: input.sourceThreadId,
    runId: input.sourceRunId,
    status: "completed",
    toolName: input.toolName,
    durationMs: durationBetween(
      input.startedEvent.createdAt,
      input.terminalEvent.createdAt,
    ),
    outputSha256: payload["outputTextSha256"],
    outputBytes: payload["outputTextBytes"],
  };
}

export function candidateToolInvocationObservation(input: {
  threadId: string;
  runId: string;
  toolName: string;
  status: ToolInvocationExperimentStatus;
  output: string;
  startedAtMs: number;
  finishedAtMs: number;
}): ToolInvocationExperimentObservation {
  return {
    threadId: input.threadId,
    runId: input.runId,
    status: input.status,
    toolName: input.toolName,
    durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
    outputSha256: sha256(input.output),
    outputBytes: Buffer.byteLength(input.output, "utf8"),
  };
}

export function createToolInvocationExperimentComparison(
  source: ToolInvocationExperimentObservation,
  target: ToolInvocationExperimentObservation,
): ToolInvocationExperimentComparison {
  const content = {
    kind: "napier.tool-invocation-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source: structuredClone(source),
    target: structuredClone(target),
    durationMsDelta: target.durationMs - source.durationMs,
    outputChanged: target.outputSha256 !== source.outputSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function toolResultText(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return String(result ?? "");
  }
  return result.content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(
        item &&
        typeof item === "object" &&
        item.type === "text" &&
        typeof item.text === "string",
      ),
    )
    .map((item) => item.text)
    .join("\n");
}

function eventPayload(event: RunEvent): Record<string, unknown> {
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new Error("Tool invocation event payload is invalid");
  }
  return event.payload;
}

function durationBetween(startedAt: string, finishedAt: string): number {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

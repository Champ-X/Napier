import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ModelInvocationExperimentComparison,
  ModelInvocationExperimentObservation,
  ModelInvocationExperimentStatus,
  ModelInvocationPurpose,
  ModelRef,
  RunEvent,
  Usage,
} from "@napier/contracts";

import { agentToolCallArgumentsLedgerProjection } from "./agent-tool-ledger.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export interface ModelInvocationSourceObservationInput {
  sourceThreadId: string;
  sourceRunId: string;
  purpose: ModelInvocationPurpose;
  capsuleEvent: RunEvent;
  responseEvent: RunEvent;
  events: readonly RunEvent[];
}

export interface ModelInvocationCandidateProjection {
  observation: ModelInvocationExperimentObservation;
  assistantText?: string;
  toolCallNames: string[];
  responsePayload: Record<string, unknown>;
}

export function observeSourceModelInvocation(
  input: ModelInvocationSourceObservationInput,
): ModelInvocationExperimentObservation {
  const payload = responsePayload(input.responseEvent);
  const output = outputProjectionFromPayload(payload);
  const model = modelRef(payload["model"]);
  const usage = sourceUsage(
    input.purpose,
    input.responseEvent,
    input.events,
    payload,
  );
  return {
    threadId: input.sourceThreadId,
    runId: input.sourceRunId,
    status: statusFromStopReason(output.stopReason),
    model,
    stopReason: output.stopReason,
    durationMs: durationBetween(
      input.capsuleEvent.createdAt,
      input.responseEvent.createdAt,
    ),
    usage,
    textSha256: output.textSha256,
    outputSha256: output.outputSha256,
    toolCallCount: output.toolCalls.length,
    toolNames: canonicalNames(output.toolCalls.map((call) => call.name)),
  };
}

export function projectCandidateModelInvocation(input: {
  threadId: string;
  runId: string;
  model: ModelRef;
  message: AssistantMessage;
  startedAtMs: number;
  finishedAtMs: number;
}): ModelInvocationCandidateProjection {
  const assistantText = contentText(input.message.content);
  const reasoning = input.message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n");
  const toolCalls = input.message.content
    .filter((block) => block.type === "toolCall")
    .map((block) => ({
      name: block.name,
      argumentsSha256: sha256(
        canonicalJson(
          agentToolCallArgumentsLedgerProjection(block.name, block.arguments),
        ),
      ),
    }));
  const output = createOutputProjection({
    textSha256: sha256(assistantText),
    reasoningSha256: sha256(reasoning),
    stopReason: input.message.stopReason,
    toolCalls,
  });
  const usage = {
    inputTokens: input.message.usage.input,
    outputTokens: input.message.usage.output,
    cacheReadTokens: input.message.usage.cacheRead,
    cacheWriteTokens: input.message.usage.cacheWrite,
    costUsd: input.message.usage.cost.total,
  };
  const toolCallNames = canonicalNames(toolCalls.map((call) => call.name));
  return {
    observation: {
      threadId: input.threadId,
      runId: input.runId,
      status: statusFromStopReason(input.message.stopReason),
      model: structuredClone(input.model),
      stopReason: input.message.stopReason,
      durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
      usage,
      textSha256: output.textSha256,
      outputSha256: output.outputSha256,
      toolCallCount: toolCalls.length,
      toolNames: toolCallNames,
    },
    ...(assistantText ? { assistantText } : {}),
    toolCallNames,
    responsePayload: {
      textSha256: output.textSha256,
      textBytes: Buffer.byteLength(assistantText, "utf8"),
      reasoningSha256: output.reasoningSha256,
      reasoningBytes: Buffer.byteLength(reasoning, "utf8"),
      contentRedacted: true,
      model: `${input.model.provider}/${input.model.id}`,
      stopReason: input.message.stopReason,
      usage,
      toolCalls: toolCalls.map((call, index) => ({
        ordinal: index,
        name: call.name,
        argumentsSha256: call.argumentsSha256,
      })),
      modelInvocationOutputSha256: output.outputSha256,
    },
  };
}

export function createModelInvocationExperimentComparison(
  source: ModelInvocationExperimentObservation,
  target: ModelInvocationExperimentObservation,
): ModelInvocationExperimentComparison {
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  const content = {
    kind: "napier.model-invocation-experiment-comparison" as const,
    schemaVersion: 1 as const,
    source: structuredClone(source),
    target: structuredClone(target),
    metricDelta: {
      durationMs: target.durationMs - source.durationMs,
      inputTokens: target.usage.inputTokens - source.usage.inputTokens,
      outputTokens: target.usage.outputTokens - source.usage.outputTokens,
      cacheReadTokens:
        target.usage.cacheReadTokens - source.usage.cacheReadTokens,
      cacheWriteTokens:
        target.usage.cacheWriteTokens - source.usage.cacheWriteTokens,
      costUsd: target.usage.costUsd - source.usage.costUsd,
      toolCallCount: target.toolCallCount - source.toolCallCount,
    },
    outputChanged: target.outputSha256 !== source.outputSha256,
    textChanged: target.textSha256 !== source.textSha256,
    addedToolNames: target.toolNames.filter((name) => !sourceTools.has(name)),
    removedToolNames: source.toolNames.filter((name) => !targetTools.has(name)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function statusFromStopReason(
  stopReason: string,
): ModelInvocationExperimentStatus {
  if (stopReason === "error") return "failed";
  if (stopReason === "aborted") return "cancelled";
  return "completed";
}

function outputProjectionFromPayload(payload: Record<string, unknown>) {
  const textSha256 = textDigest(payload, "text", "textSha256");
  const reasoningSha256 = textDigest(payload, "reasoning", "reasoningSha256");
  const stopReason =
    typeof payload["stopReason"] === "string" ? payload["stopReason"] : "stop";
  const toolCalls = Array.isArray(payload["toolCalls"])
    ? payload["toolCalls"].map((call) => {
        const value = record(call, "Model invocation tool call");
        const name =
          typeof value["name"] === "string"
            ? value["name"]
            : typeof value["toolName"] === "string"
              ? value["toolName"]
              : "";
        if (!name) throw new Error("Model invocation tool call is invalid");
        return {
          name,
          argumentsSha256:
            typeof value["argumentsSha256"] === "string" &&
            /^[a-f0-9]{64}$/u.test(value["argumentsSha256"])
              ? value["argumentsSha256"]
              : sha256(
                  canonicalJson(
                    value["arguments"] === undefined
                      ? null
                      : value["arguments"],
                  ),
                ),
        };
      })
    : [];
  return createOutputProjection({
    textSha256,
    reasoningSha256,
    stopReason,
    toolCalls,
  });
}

function createOutputProjection(input: {
  textSha256: string;
  reasoningSha256: string;
  stopReason: string;
  toolCalls: Array<{ name: string; argumentsSha256: string }>;
}) {
  const projection = {
    textSha256: input.textSha256,
    reasoningSha256: input.reasoningSha256,
    stopReason: input.stopReason,
    toolCalls: input.toolCalls,
  };
  return {
    ...projection,
    outputSha256: sha256(canonicalJson(projection)),
  };
}

function sourceUsage(
  purpose: ModelInvocationPurpose,
  responseEvent: RunEvent,
  events: readonly RunEvent[],
  response: Record<string, unknown>,
): Usage {
  const direct = usage(response["usage"]);
  if (direct) return direct;
  const companionType = {
    agent_turn: undefined,
    context_compaction: "context.compaction.completed",
    goal_evaluation: "goal.evaluated",
    memory_extraction: "memory.extraction.completed",
  }[purpose];
  if (!companionType) return emptyUsage();
  const nextInvocationSeq = events.find(
    (event) =>
      event.runId === responseEvent.runId &&
      event.seq > responseEvent.seq &&
      event.type === "context.model_invocation",
  )?.seq;
  const companion = events.find(
    (event) =>
      event.runId === responseEvent.runId &&
      event.seq > responseEvent.seq &&
      (nextInvocationSeq === undefined || event.seq < nextInvocationSeq) &&
      event.type === companionType,
  );
  return (
    usage(companion && recordOrUndefined(companion.payload)?.["usage"]) ??
    emptyUsage()
  );
}

function responsePayload(event: RunEvent): Record<string, unknown> {
  if (event.type !== "model.response") {
    throw new Error("Model invocation response event is invalid");
  }
  return record(event.payload, "Model invocation response");
}

function usage(input: unknown): Usage | undefined {
  const value = recordOrUndefined(input);
  if (!value) return undefined;
  const fields = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
  ] as const;
  if (
    fields.some(
      (field) =>
        typeof value[field] !== "number" ||
        !Number.isFinite(value[field]) ||
        Number(value[field]) < 0,
    )
  ) {
    return undefined;
  }
  return {
    inputTokens: Number(value["inputTokens"]),
    outputTokens: Number(value["outputTokens"]),
    cacheReadTokens: Number(value["cacheReadTokens"]),
    cacheWriteTokens: Number(value["cacheWriteTokens"]),
    costUsd: Number(value["costUsd"]),
  };
}

function textDigest(
  payload: Record<string, unknown>,
  textField: string,
  hashField: string,
): string {
  if (
    typeof payload[hashField] === "string" &&
    /^[a-f0-9]{64}$/u.test(payload[hashField])
  ) {
    return payload[hashField];
  }
  return sha256(
    typeof payload[textField] === "string" ? payload[textField] : "",
  );
}

function modelRef(input: unknown): ModelRef {
  if (typeof input !== "string") {
    throw new Error("Model invocation response model is invalid");
  }
  const separator = input.indexOf("/");
  if (separator < 1 || separator === input.length - 1) {
    throw new Error("Model invocation response model is invalid");
  }
  return {
    provider: input.slice(0, separator),
    id: input.slice(separator + 1),
  };
}

function canonicalNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function durationBetween(startedAt: string, finishedAt: string): number {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  const result = recordOrUndefined(value);
  if (!result) throw new Error(`${label} must be an object`);
  return result;
}

function recordOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  measureModelContext,
  type ModelContextTokenMeasurement,
} from "./model-context-token-meter.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";

export interface ModelContextTokenPressureReceipt {
  kind: "napier.model-context-token-pressure";
  schemaVersion: 1;
  status: "within_budget" | "projected" | "unavailable";
  provider: string;
  model: string;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
  meterVersion: string;
  estimateMethod: string;
  calibrationId: string;
  calibrationBytesPerTokenMilli: number;
  contextWindowTokens: number;
  systemPromptEstimatedTokens: number;
  toolDefinitionEstimatedTokens: number;
  originalMessageEstimatedTokens: number;
  activeMessageEstimatedTokens: number;
  outputReserveTokens: number;
  reasoningReserveTokens: number;
  safetyReserveTokens: number;
  originalEstimatedTotalTokens: number;
  activeEstimatedTotalTokens: number;
  originalMessageCount: number;
  activeMessageCount: number;
  removedMessageCount: number;
  removedUnitCount: number;
  protectedSuffixMessageCount: number;
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  originalMessageSetSha256: string;
  activeMessageSetSha256: string;
  projection: "none" | "oldest_complete_units_removed";
  failureReason?:
    | "protected_context_exceeds_window"
    | "provider_overflow_without_removable_history";
  contentSha256: string;
}

export interface ModelContextTokenPressureProjection {
  context: Context;
  receipt: ModelContextTokenPressureReceipt;
}

export class ModelContextWindowBudgetError extends Error {
  constructor(readonly receipt: ModelContextTokenPressureReceipt) {
    super(
      `Model context window limit exceeded by protected content (${String(receipt.contextWindowTokens)} tokens)`,
    );
    this.name = "ModelContextWindowBudgetError";
  }
}

export function projectModelContextTokenPressure(input: {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  compiledPrompt: CompiledPromptArtifact;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
}): ModelContextTokenPressureProjection {
  const original = measureModelContext(input);
  if (
    input.recoveryAttempt === 0 &&
    original.estimatedTotalTokens <= original.contextWindowTokens
  ) {
    return {
      context: input.context,
      receipt: receipt(input, original, original, 0, 0, "within_budget"),
    };
  }
  const units = completeMessageUnits(input.context.messages);
  const protectedUnitIndex = latestUserUnitIndex(units);
  let removedUnitCount = 0;
  let removedMessageCount = 0;
  let active = original;
  while (
    (active.estimatedTotalTokens > active.contextWindowTokens ||
      (input.recoveryAttempt === 1 && removedUnitCount === 0)) &&
    removedUnitCount < protectedUnitIndex
  ) {
    removedMessageCount += units[removedUnitCount]!.length;
    removedUnitCount += 1;
    active = measureModelContext({
      ...input,
      context: {
        ...input.context,
        messages: input.context.messages.slice(removedMessageCount),
      },
    });
  }
  const stricterRecovery = input.recoveryAttempt === 0 || removedUnitCount > 0;
  const status =
    active.estimatedTotalTokens <= active.contextWindowTokens &&
    stricterRecovery
      ? "projected"
      : "unavailable";
  const projectedContext =
    removedMessageCount > 0
      ? {
          ...input.context,
          messages: input.context.messages.slice(removedMessageCount),
        }
      : input.context;
  return {
    context: projectedContext,
    receipt: receipt(
      input,
      original,
      active,
      removedUnitCount,
      removedMessageCount,
      status,
    ),
  };
}

function receipt(
  input: { model: Model<Api>; modelAttempt: number; recoveryAttempt: 0 | 1 },
  original: ModelContextTokenMeasurement,
  active: ModelContextTokenMeasurement,
  removedUnitCount: number,
  removedMessageCount: number,
  status: ModelContextTokenPressureReceipt["status"],
): ModelContextTokenPressureReceipt {
  const content = {
    kind: "napier.model-context-token-pressure" as const,
    schemaVersion: 1 as const,
    status,
    provider: input.model.provider,
    model: input.model.id,
    modelAttempt: input.modelAttempt,
    recoveryAttempt: input.recoveryAttempt,
    meterVersion: original.meterVersion,
    estimateMethod: original.estimateMethod,
    calibrationId: original.calibration.id,
    calibrationBytesPerTokenMilli: original.calibration.bytesPerTokenMilli,
    contextWindowTokens: original.contextWindowTokens,
    systemPromptEstimatedTokens: original.systemPrompt.estimatedTokens,
    toolDefinitionEstimatedTokens: original.tools.estimatedTokens,
    originalMessageEstimatedTokens: original.messages.estimatedTokens,
    activeMessageEstimatedTokens: active.messages.estimatedTokens,
    outputReserveTokens: original.outputReserveTokens,
    reasoningReserveTokens: original.reasoningReserveTokens,
    safetyReserveTokens: original.safetyReserveTokens,
    originalEstimatedTotalTokens: original.estimatedTotalTokens,
    activeEstimatedTotalTokens: active.estimatedTotalTokens,
    originalMessageCount: original.messages.count,
    activeMessageCount: active.messages.count,
    removedMessageCount,
    removedUnitCount,
    protectedSuffixMessageCount: active.messages.count,
    systemPromptSha256: original.systemPrompt.contentSha256,
    toolDefinitionSetSha256: original.tools.setSha256,
    originalMessageSetSha256: original.messages.setSha256,
    activeMessageSetSha256: active.messages.setSha256,
    projection:
      removedMessageCount === 0
        ? ("none" as const)
        : ("oldest_complete_units_removed" as const),
    ...(status === "unavailable"
      ? {
          failureReason:
            active.estimatedTotalTokens > active.contextWindowTokens
              ? ("protected_context_exceeds_window" as const)
              : ("provider_overflow_without_removable_history" as const),
        }
      : {}),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function completeMessageUnits(messages: readonly Message[]): Message[][] {
  const units: Message[][] = [];
  let unit: Message[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "toolResult") {
      throw new Error("Model context contains an orphan tool result");
    }
    if (message.role === "user") {
      if (unit.length > 0) units.push(unit);
      unit = [message];
      continue;
    }
    const calls = message.content.filter((item) => item.type === "toolCall");
    if (calls.length === 0) {
      unit.push(message);
      continue;
    }
    unit.push(message);
    for (const call of calls) {
      const result = messages[index + 1];
      if (
        result?.role !== "toolResult" ||
        result.toolCallId !== call.id ||
        result.toolName !== call.name
      ) {
        throw new Error("Model context tool exchange is incomplete");
      }
      unit.push(result);
      index += 1;
    }
  }
  if (unit.length > 0) units.push(unit);
  return units;
}

function latestUserUnitIndex(units: readonly Message[][]): number {
  for (let index = units.length - 1; index >= 0; index -= 1) {
    if (units[index]!.some((message) => message.role === "user")) return index;
  }
  return Math.max(0, units.length - 1);
}

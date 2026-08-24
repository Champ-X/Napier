import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import {
  modelContextContentClass,
  modelContextMessageSetSha256,
  modelContextToolDefinitionSetSha256,
  tokenMeterToolProjection,
  visualSafeSerialized,
} from "./token-meter-content.js";
import {
  TOKEN_METER_FALLBACK_PROVIDER_ID,
  type TokenMeterBatchMeasurement,
  type TokenMeterContentClass,
  type TokenMeterProviderInput,
  type TokenMeterRegistry,
  type TokenMeterVisualItem,
} from "./token-meter-provider.js";

export const MODEL_CONTEXT_TOKEN_METER_VERSION =
  "napier.context-token-meter.v2" as const;
export const MODEL_CONTEXT_TOKEN_ESTIMATE_METHOD =
  "calibrated_utf8_bytes_plus_framing_v1" as const;
export const MODEL_CONTEXT_VISUAL_FALLBACK_TOKENS = 4_096 as const;

export interface ModelContextTokenCalibration {
  id: string;
  bytesPerTokenMilli: number;
  messageFramingTokens: number;
  toolFramingTokens: number;
}

export interface TokenMeasuredItem {
  bytes: number;
  estimatedTokens: number;
  contentSha256: string;
  visualItemCount: number;
}

export interface ModelContextTokenMeasurement {
  meterVersion: typeof MODEL_CONTEXT_TOKEN_METER_VERSION;
  estimateMethod: string;
  meterProviderId: string;
  contentClass: TokenMeterContentClass;
  calibration: ModelContextTokenCalibration;
  calibrationSampleCount: number;
  calibrationSafetyFactorPpm: number;
  calibrationP95UnderestimateRatio: number;
  fallbackApplied: boolean;
  contextWindowTokens: number;
  systemPrompt: TokenMeasuredItem;
  tools: TokenMeasuredItem & { count: number; setSha256: string };
  messages: TokenMeasuredItem & {
    count: number;
    setSha256: string;
    items: TokenMeasuredItem[];
  };
  outputReserveTokens: number;
  reasoningReserveTokens: number;
  safetyReserveTokens: number;
  baseEstimatedInputTokens: number;
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
}

interface PreparedTokenItem {
  measured: TokenMeasuredItem;
  providerInput: TokenMeterProviderInput;
}

interface PreparedModelContext {
  contentClass: TokenMeterContentClass;
  systemPrompt: PreparedTokenItem;
  tools: PreparedTokenItem[];
  messages: PreparedTokenItem[];
}

export function measureModelContext(input: {
  model: Model<Api>;
  compiledPrompt: CompiledPromptArtifact;
  context: Context;
  options: SimpleStreamOptions;
  recoveryAttempt: 0 | 1;
}): ModelContextTokenMeasurement {
  const calibration = modelContextTokenCalibration(input.model);
  const prepared = prepareModelContext(input, calibration);
  return createMeasurement(
    input,
    calibration,
    prepared,
    fallbackBatch(prepared),
  );
}

export async function measureModelContextWithProvider(
  input: {
    model: Model<Api>;
    compiledPrompt: CompiledPromptArtifact;
    context: Context;
    options: SimpleStreamOptions;
    recoveryAttempt: 0 | 1;
  },
  registry: TokenMeterRegistry,
): Promise<ModelContextTokenMeasurement> {
  const calibration = modelContextTokenCalibration(input.model);
  const prepared = prepareModelContext(input, calibration);
  const items = [
    prepared.systemPrompt.providerInput,
    ...prepared.tools.map((item) => item.providerInput),
    ...prepared.messages.map((item) => item.providerInput),
  ];
  const batch = await registry.measure(
    {
      provider: input.model.provider,
      model: input.model.id,
      contentClass: prepared.contentClass,
    },
    items,
  );
  return createMeasurement(input, calibration, prepared, batch);
}

export function estimateModelTextTokens(
  model: Pick<Model<Api>, "api" | "id" | "provider">,
  text: string,
): number {
  return fallbackTextTokens(text, modelContextTokenCalibration(model), 0);
}

export function contextHistoryTokenBudget(model: Model<Api>): number {
  const output = modelAdapterReceipt(model).streamOptionMaxTokens;
  const reserved =
    output + reasoningReserve(model) + safetyReserve(model.contextWindow, 0);
  return Math.max(1_024, Math.floor((model.contextWindow - reserved) * 0.6));
}

export function contextHistoryCharacterBudget(model: Model<Api>): number {
  // Compaction's legacy planner counts UTF-16 characters. Treat every
  // character as at least one token so multi-byte text cannot defer pressure.
  return contextHistoryTokenBudget(model);
}

export function modelContextTokenCalibration(
  model: Pick<Model<Api>, "api" | "id" | "provider">,
): ModelContextTokenCalibration {
  const identity = `${model.provider}/${model.id}`.toLowerCase();
  if (model.api === "anthropic-messages" || /claude/u.test(identity)) {
    return calibration("anthropic_claude.v1", 3_200, 5, 12);
  }
  if (/gemini/u.test(identity) || model.api.startsWith("google-")) {
    return calibration("google_gemini.v1", 3_000, 5, 12);
  }
  if (
    /(?:gpt|openai|\bo[1345](?:[-_]|$))/u.test(identity) ||
    model.api.startsWith("openai-") ||
    model.api === "azure-openai-responses"
  ) {
    return calibration("openai_family.v1", 3_000, 5, 12);
  }
  if (/deepseek/u.test(identity)) {
    return calibration("deepseek.v1", 3_000, 5, 12);
  }
  return calibration("conservative_generic.v1", 2_800, 6, 14);
}

function prepareModelContext(
  input: {
    model: Model<Api>;
    compiledPrompt: CompiledPromptArtifact;
    context: Context;
  },
  calibration: ModelContextTokenCalibration,
): PreparedModelContext {
  const contentClass = modelContextContentClass(input.context);
  return {
    contentClass,
    systemPrompt: prepareText(
      input.model,
      input.compiledPrompt.systemPrompt,
      contentClass,
      "system_prompt",
      calibration,
      0,
    ),
    tools: (input.context.tools ?? []).map((tool) =>
      prepareSerialized(
        input.model,
        tokenMeterToolProjection(tool),
        contentClass,
        "tool_definition",
        calibration,
        calibration.toolFramingTokens,
      ),
    ),
    messages: input.context.messages.map((message) =>
      prepareSerialized(
        input.model,
        message,
        contentClass,
        "message",
        calibration,
        calibration.messageFramingTokens,
      ),
    ),
  };
}

function prepareText(
  model: Pick<Model<Api>, "api" | "id" | "provider">,
  text: string,
  contentClass: TokenMeterContentClass,
  itemKind: TokenMeterProviderInput["itemKind"],
  calibration: ModelContextTokenCalibration,
  framingTokens: number,
  visualItems: readonly TokenMeterVisualItem[] = [],
  contentSha256 = sha256(text),
): PreparedTokenItem {
  const bytes = Buffer.byteLength(text, "utf8");
  const conservativeFallbackTokens =
    fallbackTextTokens(text, calibration, framingTokens) +
    visualItems.length * MODEL_CONTEXT_VISUAL_FALLBACK_TOKENS;
  return {
    measured: {
      bytes,
      estimatedTokens: conservativeFallbackTokens,
      contentSha256,
      visualItemCount: visualItems.length,
    },
    providerInput: {
      model,
      contentClass,
      itemKind,
      text,
      visualItems,
      conservativeFallbackTokens,
    },
  };
}

function prepareSerialized(
  model: Pick<Model<Api>, "api" | "id" | "provider">,
  value: unknown,
  contentClass: TokenMeterContentClass,
  itemKind: TokenMeterProviderInput["itemKind"],
  calibration: ModelContextTokenCalibration,
  framingTokens: number,
): PreparedTokenItem {
  const { text, contentSha256, visualItems } = visualSafeSerialized(value);
  return prepareText(
    model,
    text,
    contentClass,
    itemKind,
    calibration,
    framingTokens,
    visualItems,
    contentSha256,
  );
}

function createMeasurement(
  input: {
    model: Model<Api>;
    context: Context;
    options: SimpleStreamOptions;
    recoveryAttempt: 0 | 1;
  },
  calibration: ModelContextTokenCalibration,
  prepared: PreparedModelContext,
  batch: TokenMeterBatchMeasurement,
): ModelContextTokenMeasurement {
  const measuredItems = applyBatch(prepared, batch.estimatedTokens);
  const baseEstimatedInputTokens = batch.baseEstimatedTokens.reduce(
    (total, tokens) => total + tokens,
    0,
  );
  const systemPrompt = measuredItems[0]!;
  const toolItems = measuredItems.slice(1, 1 + prepared.tools.length);
  const messageItems = measuredItems.slice(1 + prepared.tools.length);
  const tools = measuredSet(
    toolItems,
    modelContextToolDefinitionSetSha256(input.context.tools ?? []),
  );
  const messages = measuredSet(
    messageItems,
    modelContextMessageSetSha256(input.context.messages),
  );
  const outputReserveTokens = modelAdapterReceipt(
    input.model,
    input.options,
  ).streamOptionMaxTokens;
  const reasoningReserveTokens = reasoningReserve(input.model);
  const safetyReserveTokens = safetyReserve(
    input.model.contextWindow,
    input.recoveryAttempt,
  );
  const estimatedInputTokens =
    systemPrompt.estimatedTokens +
    tools.estimatedTokens +
    messages.estimatedTokens;
  return {
    meterVersion: MODEL_CONTEXT_TOKEN_METER_VERSION,
    estimateMethod: batch.method,
    meterProviderId: batch.providerId,
    contentClass: batch.contentClass,
    calibration,
    calibrationSampleCount: batch.calibration.sampleCount,
    calibrationSafetyFactorPpm: batch.calibration.safetyFactorPpm,
    calibrationP95UnderestimateRatio: batch.calibration.p95UnderestimateRatio,
    fallbackApplied: batch.fallbackApplied,
    contextWindowTokens: input.model.contextWindow,
    systemPrompt,
    tools: { ...tools, count: toolItems.length },
    messages: { ...messages, count: messageItems.length, items: messageItems },
    outputReserveTokens,
    reasoningReserveTokens,
    safetyReserveTokens,
    baseEstimatedInputTokens,
    estimatedInputTokens,
    estimatedTotalTokens:
      estimatedInputTokens +
      outputReserveTokens +
      reasoningReserveTokens +
      safetyReserveTokens,
  };
}

function fallbackBatch(
  prepared: PreparedModelContext,
): TokenMeterBatchMeasurement {
  const baseEstimatedTokens = preparedItems(prepared).map(
    (item) => item.providerInput.conservativeFallbackTokens,
  );
  return {
    providerId: TOKEN_METER_FALLBACK_PROVIDER_ID,
    method: MODEL_CONTEXT_TOKEN_ESTIMATE_METHOD,
    contentClass: prepared.contentClass,
    baseEstimatedTokens,
    estimatedTokens: baseEstimatedTokens,
    calibration: {
      provider: prepared.systemPrompt.providerInput.model.provider,
      model: prepared.systemPrompt.providerInput.model.id,
      contentClass: prepared.contentClass,
      sampleCount: 0,
      safetyFactorPpm: 1_000_000,
      p95UnderestimateRatio: 0,
    },
    fallbackApplied: true,
  };
}

function applyBatch(
  prepared: PreparedModelContext,
  tokens: readonly number[],
): TokenMeasuredItem[] {
  const items = preparedItems(prepared);
  if (items.length !== tokens.length) {
    throw new Error("Token meter provider returned an invalid batch");
  }
  return items.map((item, index) => ({
    ...item.measured,
    estimatedTokens: tokens[index]!,
  }));
}

function preparedItems(prepared: PreparedModelContext): PreparedTokenItem[] {
  return [prepared.systemPrompt, ...prepared.tools, ...prepared.messages];
}

function fallbackTextTokens(
  text: string,
  calibration: ModelContextTokenCalibration,
  framingTokens: number,
): number {
  return (
    Math.ceil(
      (Buffer.byteLength(text, "utf8") * 1_000) /
        calibration.bytesPerTokenMilli,
    ) + framingTokens
  );
}

function calibration(
  id: string,
  bytesPerTokenMilli: number,
  messageFramingTokens: number,
  toolFramingTokens: number,
): ModelContextTokenCalibration {
  return { id, bytesPerTokenMilli, messageFramingTokens, toolFramingTokens };
}

function measuredSet(
  items: readonly TokenMeasuredItem[],
  setSha256: string,
): TokenMeasuredItem & {
  setSha256: string;
} {
  return {
    bytes: items.reduce((total, item) => total + item.bytes, 0),
    estimatedTokens: items.reduce(
      (total, item) => total + item.estimatedTokens,
      0,
    ),
    visualItemCount: items.reduce(
      (total, item) => total + item.visualItemCount,
      0,
    ),
    contentSha256: sha256(canonicalJson(items)),
    setSha256,
  };
}

function reasoningReserve(
  model: Pick<Model<Api>, "contextWindow" | "reasoning">,
): number {
  return model.reasoning
    ? Math.min(4_096, Math.max(512, Math.floor(model.contextWindow * 0.04)))
    : 0;
}

function safetyReserve(contextWindow: number, recoveryAttempt: 0 | 1): number {
  return recoveryAttempt === 0
    ? Math.max(256, Math.ceil(contextWindow * 0.02))
    : Math.max(1_024, Math.ceil(contextWindow * 0.08));
}

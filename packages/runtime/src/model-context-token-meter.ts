import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import { modelAdapterReceipt } from "./model-adapters.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";

export const MODEL_CONTEXT_TOKEN_METER_VERSION =
  "napier.context-token-meter.v1" as const;
export const MODEL_CONTEXT_TOKEN_ESTIMATE_METHOD =
  "calibrated_utf8_bytes_plus_framing_v1" as const;

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
}

export interface ModelContextTokenMeasurement {
  meterVersion: typeof MODEL_CONTEXT_TOKEN_METER_VERSION;
  estimateMethod: typeof MODEL_CONTEXT_TOKEN_ESTIMATE_METHOD;
  calibration: ModelContextTokenCalibration;
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
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
}

export function measureModelContext(input: {
  model: Model<Api>;
  compiledPrompt: CompiledPromptArtifact;
  context: Context;
  options: SimpleStreamOptions;
  recoveryAttempt: 0 | 1;
}): ModelContextTokenMeasurement {
  const calibration = modelContextTokenCalibration(input.model);
  const systemPrompt = measureText(
    input.compiledPrompt.systemPrompt,
    calibration,
    0,
  );
  const toolItems = (input.context.tools ?? []).map((tool) =>
    measureSerialized(
      toolProjection(tool),
      calibration,
      calibration.toolFramingTokens,
    ),
  );
  const messageItems = input.context.messages.map((message) =>
    measureSerialized(message, calibration, calibration.messageFramingTokens),
  );
  const tools = measuredSet(toolItems);
  const messages = measuredSet(messageItems);
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
    estimateMethod: MODEL_CONTEXT_TOKEN_ESTIMATE_METHOD,
    calibration,
    contextWindowTokens: input.model.contextWindow,
    systemPrompt,
    tools: { ...tools, count: toolItems.length },
    messages: { ...messages, count: messageItems.length, items: messageItems },
    outputReserveTokens,
    reasoningReserveTokens,
    safetyReserveTokens,
    estimatedInputTokens,
    estimatedTotalTokens:
      estimatedInputTokens +
      outputReserveTokens +
      reasoningReserveTokens +
      safetyReserveTokens,
  };
}

export function estimateModelTextTokens(
  model: Pick<Model<Api>, "api" | "id" | "provider">,
  text: string,
): number {
  return measureText(text, modelContextTokenCalibration(model), 0)
    .estimatedTokens;
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

function calibration(
  id: string,
  bytesPerTokenMilli: number,
  messageFramingTokens: number,
  toolFramingTokens: number,
): ModelContextTokenCalibration {
  return { id, bytesPerTokenMilli, messageFramingTokens, toolFramingTokens };
}

function measureText(
  text: string,
  calibration: ModelContextTokenCalibration,
  framingTokens: number,
): TokenMeasuredItem {
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    bytes,
    estimatedTokens:
      Math.ceil((bytes * 1_000) / calibration.bytesPerTokenMilli) +
      framingTokens,
    contentSha256: sha256(text),
  };
}

function measureSerialized(
  value: unknown,
  calibration: ModelContextTokenCalibration,
  framingTokens: number,
): TokenMeasuredItem {
  return measureText(canonicalJson(value), calibration, framingTokens);
}

function measuredSet(items: readonly TokenMeasuredItem[]): TokenMeasuredItem & {
  setSha256: string;
} {
  return {
    bytes: items.reduce((total, item) => total + item.bytes, 0),
    estimatedTokens: items.reduce(
      (total, item) => total + item.estimatedTokens,
      0,
    ),
    contentSha256: sha256(canonicalJson(items)),
    setSha256: sha256(canonicalJson(items.map((item) => item.contentSha256))),
  };
}

function toolProjection(tool: Tool): unknown {
  return {
    name: tool.name,
    description: tool.description ?? null,
    parameters: tool.parameters ?? null,
    constrainedSampling: tool.constrainedSampling ?? null,
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

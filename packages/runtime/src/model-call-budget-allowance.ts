import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { FrozenModelAccountingBasisV1, ModelCallAttributionV1, ModelCallCaptureBinding } from "@napier/contracts/model-accounting";
import { canonicalJson } from "./ed25519.js";

type ModelInputAllowanceV1 = NonNullable<ModelCallCaptureBinding["inputAllowance"]>;
type ModelCallBudgetAllowanceV1 = NonNullable<ModelCallAttributionV1["budgetAllowance"]>;

const TEXT_APIS = new Set(["openai-responses", "openai-completions", "openai-codex-responses",
  "azure-openai-responses", "anthropic-messages", "google-generative-ai", "google-vertex",
  "bedrock-converse-stream", "mistral-conversations", "pi-messages"]);

/** A deterministic nominal reservation, not a tokenizer or provider invoice guarantee.
 * Count the admitted text/schema bytes and framing rather than the entire model window.
 * Unsupported representations retain the explicit model-window fallback. */
export function modelInputAllowance(model: Model<Api>, context: Context): ModelInputAllowanceV1 {
  const contextTokens = counter(model.contextWindow);
  if (!TEXT_APIS.has(model.api) && !model.api.startsWith("faux:"))
    return fallbackInputAllowance(contextTokens, "unsupported_api");
  if (context.messages.some((message) => !["user", "assistant", "toolResult"].includes(message.role) ||
    (typeof message.content !== "string" && message.content.some((block) => !["text", "thinking", "toolCall"].includes(block.type)))))
    return fallbackInputAllowance(contextTokens, "non_text_input");
  const framedBytes = Buffer.byteLength(canonicalJson(context), "utf8") + 256 +
    32 * context.messages.length + 128 * (context.tools?.length ?? 0);
  return { schemaVersion: 1, policy: "request_utf8_nominal_v1", inputTokens: Math.min(contextTokens, counter(framedBytes)) };
}

export function fallbackInputAllowance(inputTokens: number, reason: ModelInputAllowanceV1["reason"]): ModelInputAllowanceV1 {
  return { schemaVersion: 1, policy: "model_context_fallback_v1", inputTokens: counter(inputTokens), reason: reason! };
}

export function freezeModelCallBudgetAllowance(model: Model<Api>, capture: ModelCallCaptureBinding,
  basis: FrozenModelAccountingBasisV1): ModelCallBudgetAllowanceV1 {
  const input = capture.inputAllowance ?? fallbackInputAllowance(model.contextWindow, "legacy_capture");
  validateModelInputAllowance(input);
  if (input.inputTokens > counter(model.contextWindow)) throw new Error("Model input allowance exceeds admitted model context");
  const outputTokens = counter(capture.adapter.streamOptionMaxTokens);
  if (outputTokens > counter(model.maxTokens)) throw new Error("Model output allowance exceeds admitted model cap");
  const budgetTokens = counter(Math.ceil(input.inputTokens * Math.max(basis.runTokenWeights.input,
    basis.runTokenWeights.cacheRead, basis.runTokenWeights.cacheWrite) + outputTokens * basis.runTokenWeights.output), 0);
  const prices: number[] = [];
  const provider = basis.providerPriceTable;
  if (provider) for (const tier of [provider, ...(provider.tiers ?? [])]) {
    prices.push((input.inputTokens * (tier.input + tier.cacheRead + Math.max(tier.cacheWrite, 2 * tier.input)) +
      outputTokens * tier.output) / 1_000_000);
  }
  const run = basis.runPriceTable;
  if (run) prices.push((input.inputTokens * (run.inputUsdPerMillion + run.cacheReadUsdPerMillion + run.cacheWriteUsdPerMillion) +
    outputTokens * run.outputUsdPerMillion) / 1_000_000);
  const maximum = Math.max(0, ...prices);
  const budgetCostUsd = basis.declaredZeroCost ? 0 : maximum > 0 ? Math.ceil(maximum * 1e9) / 1e9 : null;
  const value = { schemaVersion: 1 as const, input: structuredClone(input), outputTokens, budgetTokens, budgetCostUsd };
  validateModelCallBudgetAllowance(value);
  return value;
}

export function validateModelInputAllowance(value: ModelInputAllowanceV1): void {
  exactKeys(value, ["schemaVersion", "policy", "inputTokens"], ["reason"]);
  if (value.schemaVersion !== 1 || !["request_utf8_nominal_v1", "model_context_fallback_v1"].includes(value.policy)) fail();
  counter(value.inputTokens);
  if (value.policy === "request_utf8_nominal_v1" ? value.reason !== undefined :
    !["legacy_capture", "unsupported_api", "non_text_input"].includes(value.reason ?? "")) fail();
}
export function validateModelCallBudgetAllowance(value: ModelCallBudgetAllowanceV1): void {
  exactKeys(value, ["schemaVersion", "input", "outputTokens", "budgetTokens", "budgetCostUsd"]);
  if (value.schemaVersion !== 1) fail();
  validateModelInputAllowance(value.input); counter(value.outputTokens); counter(value.budgetTokens, 0);
  if (value.budgetCostUsd !== null && (!Number.isFinite(value.budgetCostUsd) || value.budgetCostUsd < 0 ||
    !Number.isSafeInteger(Math.ceil(value.budgetCostUsd * 1e9)))) fail();
}
export function validateCapturedBudgetAllowance(capture: ModelCallCaptureBinding, value: ModelCallBudgetAllowanceV1): void {
  validateModelCallBudgetAllowance(value);
  if (value.outputTokens !== capture.adapter.streamOptionMaxTokens || (capture.inputAllowance
    ? canonicalJson(value.input) !== canonicalJson(capture.inputAllowance) : value.input.reason !== "legacy_capture")) fail();
}
function counter(value: number, minimum = 1): number { if (!Number.isSafeInteger(value) || value < minimum) fail(); return value; }
function exactKeys(value: object, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== "object" || required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) fail();
}
function fail(): never { throw new Error("Model budget allowance is invalid or unavailable"); }

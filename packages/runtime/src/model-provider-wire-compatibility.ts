import type { Api, Model } from "@earendil-works/pi-ai";

/** DeepSeek documents max_tokens; the SDK's OpenAI default emits
 * max_completion_tokens. Bind the native field at the provider boundary for
 * every invocation, including auxiliary calls and nonthinking retries. */
export function applyProviderWireCompatibility(model: Model<Api>): Model<Api> {
  if (model.api !== "openai-completions") return model;
  let officialDeepSeek = false;
  try {
    officialDeepSeek = new URL(model.baseUrl).origin === "https://api.deepseek.com";
  } catch {
    return model;
  }
  if (!officialDeepSeek ||
      (model.compat && "maxTokensField" in model.compat && model.compat.maxTokensField === "max_tokens")) return model;
  return { ...model, compat: { ...model.compat, maxTokensField: "max_tokens" } };
}

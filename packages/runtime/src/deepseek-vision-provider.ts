import type { Api, Model, Provider } from "@earendil-works/pi-ai";

export const DEEPSEEK_VISION_MODEL_ID = "deepseek-v4-flash-vision-exp" as const;
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com" as const;

/**
 * Extends the pinned DeepSeek provider with the official experimental vision
 * model while retaining the provider's existing auth and OpenAI-compatible
 * Chat Completions transport.
 */
export function withDeepSeekVisionModel(
  provider: Provider<Api>,
): Provider<Api> {
  if (provider.id !== "deepseek") return provider;
  const models = provider.getModels();
  const baseline = models.find((model) => model.id === "deepseek-v4-flash");
  if (!baseline) {
    throw new Error("DeepSeek V4 Flash baseline model is unavailable");
  }
  const vision = createDeepSeekVisionModel(baseline);
  return {
    ...provider,
    baseUrl: DEEPSEEK_API_BASE_URL,
    getModels: () => [
      vision,
      ...models.filter((model) => model.id !== DEEPSEEK_VISION_MODEL_ID),
    ],
    stream: provider.stream.bind(provider),
    streamSimple: provider.streamSimple.bind(provider),
  };
}

function createDeepSeekVisionModel(baseline: Model<Api>): Model<Api> {
  const { thinkingLevelMap: _thinkingLevelMap, ...shared } = baseline;
  return Object.freeze({
    ...shared,
    id: DEEPSEEK_VISION_MODEL_ID,
    name: "DeepSeek V4 Flash Vision Experimental",
    baseUrl: DEEPSEEK_API_BASE_URL,
    reasoning: false,
    input: ["text", "image"] as Model<Api>["input"],
  });
}

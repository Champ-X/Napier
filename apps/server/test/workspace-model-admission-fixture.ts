import { fauxAssistantMessage, type Api, type Model } from "@earendil-works/pi-ai";

export const admissionModel: Model<Api> = {
  id: "local-model", provider: "fixture", api: "openai-completions", name: "Local fixture",
  baseUrl: "http://127.0.0.1:1/never-dispatched", reasoning: false, input: ["text"],
  contextWindow: 100, maxTokens: 20,
  cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25 },
};
export const workspaceA = `workspace_${"a".repeat(64)}`;
export const workspaceB = `workspace_${"b".repeat(64)}`;

export function measuredMessage() {
  return {
    ...fauxAssistantMessage("Measured local response"),
    usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14,
      cost: { input: 0.00001, output: 0.000008, cacheRead: 0, cacheWrite: 0, total: 0.000018 } },
  };
}

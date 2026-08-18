import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type { ModelRef, Usage } from "@napier/contracts";
import { boundToolFailureContext } from "./agent-tool-failure-context.js";

export function modelRefFromModel(model: Model<Api>): ModelRef {
  return {
    provider: model.provider,
    id: model.id,
  };
}

export function mapModelUsage(usage: PiUsage): Usage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
}

export function isProviderMessage(message: AgentMessage): message is Message {
  return (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "toolResult"
  );
}

export function providerMessages(messages: AgentMessage[]): Message[] {
  return boundToolFailureContext(messages).filter(isProviderMessage);
}

export function contextHistoryCharacterBudget(model: Model<Api>): number {
  return Math.max(
    16_000,
    Math.min(96_000, Math.floor(model.contextWindow * 1.5)),
  );
}

export function extractAssistantReasoning(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n");
}

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";

import type {
  AgentStepLifecycleContext,
  ComposableLifecycleExtensionPipeline,
} from "./lifecycle-extension-pipeline.js";

type TerminalAssistantEvent = Extract<
  AssistantMessageEvent,
  { type: "done" | "error" }
>;

/**
 * Keeps prepare/around active for the complete provider stream and withholds
 * the terminal event until lifecycle finalizers have completed. Non-terminal
 * deltas continue to stream without buffering.
 */
export function runAgentStepLifecycleStream(input: {
  model: Model<Api>;
  context: AgentStepLifecycleContext;
  pipeline: ComposableLifecycleExtensionPipeline<AgentStepLifecycleContext>;
  invoke: () =>
    | AssistantMessageEventStream
    | Promise<AssistantMessageEventStream>;
}): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  void input.pipeline
    .execute(input.context, async () => {
      const source = await input.invoke();
      let terminal: TerminalAssistantEvent | undefined;
      for await (const event of source) {
        if (event.type === "done" || event.type === "error") terminal = event;
        else output.push(event);
      }
      return terminal ?? terminalEvent(await source.result());
    })
    .then((terminal) => output.push(terminal))
    .catch((error: unknown) => {
      output.push({
        type: "error",
        reason: "error",
        error: lifecycleErrorMessage(input.model, error),
      });
    });
  return output;
}

function terminalEvent(message: AssistantMessage): TerminalAssistantEvent {
  return message.stopReason === "error" || message.stopReason === "aborted"
    ? { type: "error", reason: message.stopReason, error: message }
    : { type: "done", reason: message.stopReason, message };
}

function lifecycleErrorMessage(
  model: Model<Api>,
  error: unknown,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

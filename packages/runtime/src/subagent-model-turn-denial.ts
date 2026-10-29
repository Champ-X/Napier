import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";

const undispatchedMessages = new WeakSet<AssistantMessage>();

export class SubagentModelTurnDeniedError extends Error {
  override readonly name = "SubagentModelTurnDeniedError";

  constructor(maxTurns: number) {
    super(`Subagent turn budget exhausted (${maxTurns})`);
  }
}

/** Return a trusted terminal only for a host denial before route/capture/dispatch.
 * Throwing from streamFn would let the SDK manufacture an unidentifiable turn. */
export function subagentModelTurnDeniedStream(
  model: Model<Api>,
  error: unknown,
): AssistantMessageEventStream | undefined {
  if (!(error instanceof SubagentModelTurnDeniedError)) return undefined;
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: error.message,
    timestamp: Date.now(),
  };
  Object.freeze(message.content);
  Object.freeze(message.usage.cost);
  Object.freeze(message.usage);
  Object.freeze(message);
  undispatchedMessages.add(message);
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "error", reason: "error", error: message });
  return stream;
}

/** Provider-controlled fields or matching error text cannot attest host denial. */
export function isUndispatchedSubagentModelTurn(message: AssistantMessage): boolean {
  return undispatchedMessages.has(message);
}

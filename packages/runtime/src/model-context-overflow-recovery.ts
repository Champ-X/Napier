import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";

export function isModelContextOverflowMessage(
  diagnostic: string | undefined,
): boolean {
  const normalized = diagnostic?.toLowerCase() ?? "";
  return /context_length_exceeded|maximum context|context.{0,32}(?:length|limit|window).{0,24}(?:exceed|too (?:large|long)|maximum)|too many (?:input )?tokens|prompt (?:is )?too long|input token count.{0,20}exceed|request too large.{0,40}(?:context|token)/u.test(
    normalized,
  );
}

export function recoverModelContextOverflow(input: {
  source: AssistantMessageEventStream;
  signal: AbortSignal;
  recover(error: AssistantMessage): Promise<AssistantMessageEventStream>;
}): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let resolveTerminal: (message: AssistantMessage) => void = () => undefined;
  const terminal = new Promise<AssistantMessage>((resolve) => {
    resolveTerminal = resolve;
  });
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    resolveTerminal(message);
  };

  output[Symbol.asyncIterator] = async function* () {
    let source = input.source;
    let recoveryAttempted = false;
    let visibleOutput = false;
    try {
      while (true) {
        iterator = source[Symbol.asyncIterator]();
        let replaced = false;
        const pending: AssistantMessageEvent[] = [];
        while (true) {
          const step = await iterator.next();
          if (step.done) {
            const message = await source.result();
            if (
              canRecover(
                input.signal,
                message,
                recoveryAttempted,
                visibleOutput,
              )
            ) {
              recoveryAttempted = true;
              source = await input.recover(message);
              replaced = true;
              break;
            }
            settle(message);
            for (const buffered of pending) yield buffered;
            yield terminalEvent(message);
            return;
          }
          const event = step.value;
          if (
            event.type === "error" &&
            canRecover(
              input.signal,
              event.error,
              recoveryAttempted,
              visibleOutput,
            )
          ) {
            recoveryAttempted = true;
            source = await input.recover(event.error);
            replaced = true;
            break;
          }
          if (!visibleOutput && !isVisibleOutput(event) && !isTerminal(event)) {
            pending.push(event);
            continue;
          }
          if (!visibleOutput) {
            for (const buffered of pending) yield buffered;
            pending.length = 0;
          }
          visibleOutput ||= isVisibleOutput(event);
          if (event.type === "done" || event.type === "error") {
            settle(event.type === "done" ? event.message : event.error);
          }
          yield event;
          if (settled) return;
        }
        await Promise.resolve(iterator.return?.()).catch(() => undefined);
        iterator = undefined;
        if (!replaced) return;
      }
    } finally {
      await Promise.resolve(iterator?.return?.()).catch(() => undefined);
      iterator = undefined;
    }
  };
  output.result = () => terminal;
  return output;
}

function isTerminal(event: AssistantMessageEvent): boolean {
  return event.type === "done" || event.type === "error";
}

function canRecover(
  signal: AbortSignal,
  message: AssistantMessage,
  attempted: boolean,
  visibleOutput: boolean,
): boolean {
  return (
    !attempted &&
    !visibleOutput &&
    !signal.aborted &&
    message.stopReason === "error" &&
    isModelContextOverflowMessage(message.errorMessage)
  );
}

function isVisibleOutput(event: AssistantMessageEvent): boolean {
  return (
    (event.type === "text_delta" && event.delta.length > 0) ||
    (event.type === "thinking_delta" && event.delta.length > 0) ||
    (event.type === "toolcall_delta" && event.delta.length > 0) ||
    (event.type === "text_end" && event.content.length > 0) ||
    (event.type === "thinking_end" && event.content.length > 0) ||
    event.type === "toolcall_end"
  );
}

function terminalEvent(
  message: AssistantMessage,
): Extract<AssistantMessageEvent, { type: "done" | "error" }> {
  return message.stopReason === "error" || message.stopReason === "aborted"
    ? { type: "error", reason: message.stopReason, error: message }
    : { type: "done", reason: message.stopReason, message };
}

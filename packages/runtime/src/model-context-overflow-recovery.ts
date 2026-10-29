import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { awaitModelCallRecovery, type ModelCallRecoveryHandle, type ModelRecoveryReadiness } from "./model-call-recovery.js";
import { MODEL_STREAM_CANCELLATION_GRACE_MS } from "./model-stream-cancellation-policy.js";
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

export interface ModelContextOverflowDecision {
  action: "retry" | "finalize";
  readiness: ModelRecoveryReadiness | "retry_exhausted";
}

const finalizedOverflows = new WeakSet<AssistantMessage>();
/** Process-local stop disposition; diagnostic text cannot authorize route replay. */
export function isFinalizedModelContextOverflow(value: unknown): boolean {
  return typeof value === "object" && value !== null && finalizedOverflows.has(value as AssistantMessage);
}

export function recoverModelContextOverflow(input: {
  source: AssistantMessageEventStream;
  signal: AbortSignal;
  nativeAccounting: boolean;
  remainingMs?(): number;
  recovery?(): { handle?: ModelCallRecoveryHandle; attribution?: ModelCallAttributionV1 };
  claimRetry?(): boolean;
  onOverflow?(error: AssistantMessage, decision: ModelContextOverflowDecision): Promise<void | false>;
  onRecoveryStopped?(readiness: "cancelled" | "pending_timeout"): Promise<void>;
  recover(error: AssistantMessage): Promise<AssistantMessageEventStream>;
}): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let resolveTerminal: (message: AssistantMessage) => void = () => undefined;
  let rejectTerminal: (error: unknown) => void = () => undefined;
  const terminal = new Promise<AssistantMessage>((resolve, reject) => { resolveTerminal = resolve; rejectTerminal = reject; });
  void terminal.catch(() => undefined);
  const deadlineAt = Date.now() + Math.max(0, input.remainingMs?.() ?? Infinity);
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  let settled = false;
  const settle = (message: AssistantMessage): void => {
    if (settled) return;
    if (message.stopReason === "error" && isModelContextOverflowMessage(message.errorMessage)) finalizedOverflows.add(message);
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
              canRecover(message, recoveryAttempted, visibleOutput) && await admitRecovery(message)
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
            canRecover(event.error, recoveryAttempted, visibleOutput) && await admitRecovery(event.error)
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
    } catch (error) {
      if (!settled) { settled = true; rejectTerminal(error); }
      throw error;
    } finally {
      await Promise.resolve(iterator?.return?.()).catch(() => undefined);
      iterator = undefined;
    }
  };
  output.result = () => terminal;
  return output;

  async function admitRecovery(error: AssistantMessage): Promise<boolean> {
    const recoveryDeadlineAt = input.nativeAccounting
      ? Math.min(deadlineAt, Date.now() + MODEL_STREAM_CANCELLATION_GRACE_MS) : deadlineAt;
    let readiness: ModelContextOverflowDecision["readiness"] = input.signal.aborted ? "cancelled"
      : Date.now() >= recoveryDeadlineAt ? "pending_timeout" : "legacy_unaccounted";
    if (input.nativeAccounting && readiness === "legacy_unaccounted") {
      const attempt = input.recovery?.();
      readiness = await awaitModelCallRecovery({ handle: attempt?.handle, attribution: attempt?.attribution,
        signal: input.signal, deadlineAt: recoveryDeadlineAt });
    }
    if (input.signal.aborted) readiness = "cancelled";
    else if (Date.now() >= recoveryDeadlineAt) readiness = "pending_timeout";
    let retry = readiness === "legacy_unaccounted" || readiness === "known" || readiness === "undispatched";
    if (retry && input.claimRetry && !input.claimRetry()) { retry = false; readiness = "retry_exhausted"; }
    const observed = await input.onOverflow?.(error, { action: retry ? "retry" : "finalize", readiness });
    if (observed === false) return false;
    if (retry && (input.signal.aborted || Date.now() >= recoveryDeadlineAt)) {
      await input.onRecoveryStopped?.(input.signal.aborted ? "cancelled" : "pending_timeout");
      return false;
    }
    return retry;
  }
}

function isTerminal(event: AssistantMessageEvent): boolean {
  return event.type === "done" || event.type === "error";
}

function canRecover(
  message: AssistantMessage,
  attempted: boolean,
  visibleOutput: boolean,
): boolean {
  return (
    !attempted &&
    !visibleOutput &&
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

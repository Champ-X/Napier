import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

/**
 * Hidden reasoning remains replayable until this many UTF-8 bytes have been
 * forwarded. Keep routing and thinking-loop recovery on the same boundary so
 * a provider disconnect cannot turn an uncommitted preamble into visible work.
 */
export const MAX_UNCOMMITTED_THINKING_BYTES = 32 * 1024;

export function thinkingDeltaBytes(event: AssistantMessageEvent): number {
  return event.type === "thinking_delta"
    ? Buffer.byteLength(event.delta, "utf8")
    : 0;
}

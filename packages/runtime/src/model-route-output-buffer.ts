import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
} from "@earendil-works/pi-ai";

import { routeVisibleOutput, terminalEvent } from "./model-route-evidence.js";
import {
  MAX_UNCOMMITTED_THINKING_BYTES,
  thinkingDeltaBytes,
} from "./model-output-commit-policy.js";

export interface ModelRouteOutputProgress {
  visibleOutputProduced: boolean;
  bufferedThinkingBytes: number;
}

export interface ConsumedModelRouteStream extends ModelRouteOutputProgress {
  finalMessage?: AssistantMessage;
  failure?: unknown;
  pending: AssistantMessageEvent[];
}

export async function* consumeModelRouteSource(
  source: AssistantMessageEventStream,
  iterator: AsyncIterator<AssistantMessageEvent>,
  progress: ModelRouteOutputProgress,
): AsyncGenerator<AssistantMessageEvent, ConsumedModelRouteStream> {
  const pending: AssistantMessageEvent[] = [];
  let visibleOutputProduced = false;
  let bufferedThinkingBytes = 0;
  try {
    while (true) {
      const step = await iterator.next();
      if (step.done) {
        return {
          finalMessage: await source.result(),
          visibleOutputProduced,
          bufferedThinkingBytes,
          pending,
        };
      }
      const event = step.value;
      bufferedThinkingBytes += thinkingDeltaBytes(event);
      visibleOutputProduced ||=
        routeVisibleOutput(event) ||
        bufferedThinkingBytes >= MAX_UNCOMMITTED_THINKING_BYTES;
      progress.visibleOutputProduced = visibleOutputProduced;
      progress.bufferedThinkingBytes = bufferedThinkingBytes;
      if (!visibleOutputProduced && !terminalEvent(event)) {
        pending.push(event);
        continue;
      }
      if (event.type === "done" || event.type === "error") {
        return {
          finalMessage: event.type === "done" ? event.message : event.error,
          visibleOutputProduced,
          bufferedThinkingBytes,
          pending,
        };
      }
      if (pending.length > 0) {
        for (const buffered of pending) yield buffered;
        pending.length = 0;
      }
      yield event;
    }
  } catch (failure) {
    return { failure, visibleOutputProduced, bufferedThinkingBytes, pending };
  }
}

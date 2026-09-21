import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { AgentModelInvocation } from "./agent-model-stream-lifecycle.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { canonicalJson, sha256 } from "./ed25519.js";

type ContentKind = "text" | "thinking" | "toolcall";
type Timing = {
  firstContentMs: number | null;
  firstContentKind: ContentKind | null;
  firstTextMs: number | null;
  elapsedMs: number;
  terminal: "done" | "error" | "exception" | "closed";
};

/** Observe consumption of SDK deltas without prefetching, transforming events,
 * changing result(), or owning cancellation. No token text is retained. */
export function observeModelStreamTiming(
  next: () => AssistantMessageEventStream,
  record: (timing: Timing) => Promise<unknown>,
  now: () => number = () => performance.now(),
): AssistantMessageEventStream {
  const started = now();
  const source = next();
  const output = createAssistantMessageEventStream();
  output.result = source.result.bind(source);
  const timing: Timing = {
    firstContentMs: null,
    firstContentKind: null,
    firstTextMs: null,
    elapsedMs: 0,
    terminal: "closed",
  };
  let recorded = false;
  const elapsed = () =>
    Math.max(0, Math.round((now() - started) * 1000) / 1000);
  output[Symbol.asyncIterator] = async function* () {
    try {
      for await (const event of source) {
        const kind = contentKind(event);
        if (kind && timing.firstContentMs === null) {
          timing.firstContentMs = elapsed();
          timing.firstContentKind = kind;
        }
        if (kind === "text" && timing.firstTextMs === null)
          timing.firstTextMs = elapsed();
        if (event.type === "done" || event.type === "error") {
          timing.terminal = event.type;
          timing.elapsedMs = elapsed();
        }
        yield event;
      }
    } catch (error) {
      timing.terminal = "exception";
      throw error;
    } finally {
      if (timing.terminal === "closed" || timing.terminal === "exception")
        timing.elapsedMs = elapsed();
      if (!recorded) {
        recorded = true;
        try {
          await record({ ...timing });
        } catch {
          // Optional observation failure cannot replace provider/caller results.
        }
      }
    }
  };
  return output;
}

export function observeHarnessModelStream(
  call: Readonly<AgentModelInvocation>,
  next: () => AssistantMessageEventStream,
  recordEvent: (input: AppendEventInput) => Promise<unknown>,
) {
  return observeModelStreamTiming(next, async (timing) => {
    const content = {
      kind: "napier.model-stream-timing",
      schemaVersion: 1,
      measurement: "harness_dispatch_to_observed_sdk_delta",
      clock: "monotonic_performance_now",
      purpose: "agent_turn",
      turnIndex: call.envelope.turnIndex,
      contextEnvelopeSha256: call.envelope.contentSha256,
      provider: call.model.provider,
      model: call.model.id,
      api: call.model.api,
      attempt: call.attempt,
      ...timing,
    };
    await recordEvent({
      threadId: call.run.threadId,
      runId: call.run.id,
      type: "model.stream.timing",
      category: "model",
      visibility: "debug",
      payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
    });
  });
}

function contentKind(event: AssistantMessageEvent): ContentKind | undefined {
  if (
    (event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_delta") &&
    event.delta.length > 0
  )
    return event.type === "text_delta"
      ? "text"
      : event.type === "thinking_delta"
        ? "thinking"
        : "toolcall";
  return undefined;
}

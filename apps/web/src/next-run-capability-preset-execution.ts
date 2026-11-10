import type {
  ModelRef,
  PromptImageInput,
  StreamFrame,
} from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { HarnessPolicyPresetId } from "@napier/contracts/harness-experiments";

import { streamPrompt } from "./api";

export interface NextRunPromptInput {
  threadId: string;
  text: string;
  images?: PromptImageInput[];
  model: ModelRef;
  capabilityPreset?: AgentCapabilityPresetId;
  harnessPolicyPreset?: HarnessPolicyPresetId;
  /** Durable admission identity; retries of the same send reuse this value. */
  requestId?: string;
  /** Aborts the client SSE reader without cancelling the durable Run by itself. */
  signal?: AbortSignal;
  onStart: () => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  restoreInput: (text: string) => void;
  restoreImages?: () => void;
  /** Called after stream settlement. `accepted` is true once a Run was proven. */
  onFinish: (accepted: boolean) => void;
  onFrame: (frame: StreamFrame) => void;
}

export async function executeNextRunPrompt(
  input: NextRunPromptInput,
  stream = streamPrompt,
): Promise<void> {
  input.onStart();
  let runAccepted = false;
  const requestId = input.requestId ?? crypto.randomUUID();
  try {
    await stream(
      input.threadId,
      {
        text: input.text,
        requestId,
        ...(input.images ? { images: input.images } : {}),
        model: input.model,
        ...(input.harnessPolicyPreset
          ? { harnessPolicyPreset: input.harnessPolicyPreset }
          : {}),
        ...(input.capabilityPreset
          ? { capabilityPreset: input.capabilityPreset }
          : {}),
      },
      (frame) => {
        if (isAcceptedPromptRunFrame(frame, input.threadId)) runAccepted = true;
        input.onFrame(frame);
      },
      input.signal,
    );
    await input.onRefresh();
  } catch (error) {
    if (!runAccepted) {
      input.restoreInput(input.text);
      input.restoreImages?.();
    }
    if (isAbortError(error)) {
      await input.onRefresh().catch(() => undefined);
    } else {
      input.onError(error);
    }
  } finally {
    input.onFinish(runAccepted);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Only called with frames already accepted by the stream protocol verifier.
 * A verified terminal snapshot/done also proves Run creation if live events
 * were absent; a subsequent refresh failure must not restore a duplicate prompt. */
export function isAcceptedPromptRunFrame(frame: StreamFrame, threadId: string) {
  return frame.type === "done"
    ? frame.threadId === threadId
    : frame.type === "event" &&
        frame.event.type === "run.started" &&
        frame.event.threadId === threadId;
}

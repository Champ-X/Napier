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
  onStart: () => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  restoreInput: (text: string) => void;
  restoreImages?: () => void;
  onFinish: () => void;
  onFrame: (frame: StreamFrame) => void;
}

export async function executeNextRunPrompt(
  input: NextRunPromptInput,
  stream = streamPrompt,
): Promise<void> {
  input.onStart();
  let runAccepted = false;
  try {
    await stream(
      input.threadId,
      {
        text: input.text,
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
    );
    await input.onRefresh();
  } catch (error) {
    if (!runAccepted) {
      input.restoreInput(input.text);
      input.restoreImages?.();
    }
    input.onError(error);
  } finally {
    input.onFinish();
  }
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

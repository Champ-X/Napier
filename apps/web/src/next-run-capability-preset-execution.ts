import type { ModelRef, StreamFrame } from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import { streamPrompt } from "./api";

export interface NextRunPromptInput {
  threadId: string;
  text: string;
  model: ModelRef;
  capabilityPreset?: AgentCapabilityPresetId;
  onStart: () => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  restoreInput: (text: string) => void;
  onFinish: () => void;
  onFrame: (frame: StreamFrame) => void;
}

export async function executeNextRunPrompt(
  input: NextRunPromptInput,
  stream = streamPrompt,
): Promise<void> {
  input.onStart();
  let runStarted = false;
  try {
    await stream(
      input.threadId,
      {
        text: input.text,
        model: input.model,
        ...(input.capabilityPreset
          ? { capabilityPreset: input.capabilityPreset }
          : {}),
      },
      (frame) => {
        const started =
          frame.type === "event" && frame.event.type === "run.started";
        if (started) runStarted = true;
        input.onFrame(frame);
      },
    );
    await input.onRefresh();
  } catch (error) {
    if (!runStarted) input.restoreInput(input.text);
    input.onError(error);
  } finally {
    input.onFinish();
  }
}

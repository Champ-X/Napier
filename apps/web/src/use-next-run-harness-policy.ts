import { useCallback, useState } from "react";
import type { HarnessPolicyPresetId } from "@napier/contracts/harness-experiments";
import {
  executeNextRunPrompt,
  isAcceptedPromptRunFrame,
  type NextRunPromptInput,
} from "./next-run-capability-preset-execution";

export function useNextRunHarnessPolicy(threadId: string | undefined) {
  const [selection, setSelection] = useState<{
    threadId: string | undefined;
    preset: HarnessPolicyPresetId | undefined;
  }>();
  // A selection belongs to its thread. Switching threads never sends it elsewhere.
  const preset =
    selection?.threadId === threadId ? selection?.preset : undefined;
  const setPreset = useCallback(
    (preset: HarnessPolicyPresetId | undefined) =>
      setSelection({ threadId, preset }),
    [threadId],
  );
  const execute = useCallback(
    async (input: NextRunPromptInput) => {
      await executeNextRunPrompt({
        ...input,
        ...(input.threadId === threadId && preset
          ? { harnessPolicyPreset: preset }
          : {}),
        onFrame(frame) {
          if (isAcceptedPromptRunFrame(frame, input.threadId)) {
            // A late response must not clear a newer selection.
            setSelection((current) =>
              current === selection ? undefined : current,
            );
          }
          input.onFrame(frame);
        },
      });
    },
    [preset, selection, threadId],
  );
  return { preset, setPreset, execute };
}

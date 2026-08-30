import { useState } from "react";

import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { NextRunPromptInput } from "./next-run-capability-preset-execution";

export const DEFAULT_COMPOSER_PERMISSION_PRESET = "full_access" as const;

export function useNextRunCapabilityPreset(_threadId: string | undefined) {
  const [preset, setPreset] = useState<AgentCapabilityPresetId>(
    DEFAULT_COMPOSER_PERMISSION_PRESET,
  );
  return { preset, setPreset };
}

export async function executeLoadedNextRunPrompt(
  input: NextRunPromptInput,
): Promise<void> {
  try {
    const { executeNextRunPrompt } =
      await import("./next-run-capability-preset-execution");
    await executeNextRunPrompt(input);
  } catch (error) {
    input.restoreInput(input.text);
    input.onError(error);
  }
}

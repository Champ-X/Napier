import { useState } from "react";

import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import {
  executeNextRunPrompt,
  type NextRunPromptInput,
} from "./next-run-capability-preset-execution";

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
  await executeNextRunPrompt(input);
}

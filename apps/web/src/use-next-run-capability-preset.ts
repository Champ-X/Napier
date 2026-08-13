import { useEffect, useState } from "react";

import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { NextRunPromptInput } from "./next-run-capability-preset-execution";

export function useNextRunCapabilityPreset(threadId: string | undefined) {
  const [preset, setPreset] = useState<AgentCapabilityPresetId>();
  useEffect(() => setPreset(undefined), [threadId]);
  const consumePreset = (consumed: AgentCapabilityPresetId): void =>
    setPreset((current) => (current === consumed ? undefined : current));
  return { preset, setPreset, consumePreset };
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

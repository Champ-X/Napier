import { useState } from "react";
import { useThreadComposer } from "./use-thread-composer";

import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import { useNextRunHarnessPolicy } from "./use-next-run-harness-policy";

export const DEFAULT_COMPOSER_PERMISSION_PRESET = "full_access" as const;

export function useNextRunOptions(
  threadId: string | undefined,
  workspaceKey?: string,
) {
  const composerDraft = useThreadComposer(workspaceKey, threadId);
  const harnessPolicy = useNextRunHarnessPolicy(threadId);
  const [preset, setPreset] = useState<AgentCapabilityPresetId>(
    DEFAULT_COMPOSER_PERMISSION_PRESET,
  );
  return { preset, setPreset, harnessPolicy, composerDraft };
}

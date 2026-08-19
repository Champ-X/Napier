import type { RunExecutionMode, ToolPolicyMode } from "@napier/contracts";

import { formatEffectiveCapabilitiesPrompt } from "./effective-capabilities-prompt.js";
import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import {
  formatModelHarnessPrompt,
  resolveModelHarnessProfile,
} from "./model-harness-profile.js";

export interface EffectiveCapabilitiesPromptBuilderInput {
  requestedTools: readonly string[];
  toolPolicy: ToolPolicyMode;
  sandboxId: string;
  restrictedReadOnlyExecution: boolean;
  executionMode: RunExecutionMode;
  advisorCorrection: boolean;
  browserInteractionConfirmationAvailable: boolean;
}

export function createEffectiveCapabilitiesPromptBuilder(
  input: EffectiveCapabilitiesPromptBuilderInput,
): (activeTools: readonly string[], adapter: ModelAdapterReceiptV2) => string {
  return (activeTools, adapter) =>
    [
      formatEffectiveCapabilitiesPrompt({ ...input, activeTools }),
      formatModelHarnessPrompt(
        resolveModelHarnessProfile({ api: adapter.modelApi }),
      ),
    ].join("\n\n");
}

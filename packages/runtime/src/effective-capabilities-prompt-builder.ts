import type { RunExecutionMode, ToolPolicyMode } from "@napier/contracts";
import type { Api, Message, Model } from "@earendil-works/pi-ai";

import { formatEffectiveCapabilitiesPrompt } from "./effective-capabilities-prompt.js";
import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import {
  formatModelHarnessPrompt,
  resolveModelHarnessResolution,
} from "./model-harness-resolution.js";

export interface EffectiveCapabilitiesPromptBuilderInput {
  requestedTools: readonly string[];
  toolPolicy: ToolPolicyMode;
  sandboxId: string;
  restrictedReadOnlyExecution: boolean;
  executionMode: RunExecutionMode;
  advisorCorrection: boolean;
  browserInteractionConfirmationAvailable: boolean;
  model: Pick<Model<Api>, "api" | "provider" | "id">;
  messages: readonly Message[];
}

export function createEffectiveCapabilitiesPromptBuilder(
  input: EffectiveCapabilitiesPromptBuilderInput,
): (
  activeTools: readonly string[],
  adapter: ModelAdapterReceiptV2,
  messages?: readonly Message[],
) => string {
  return (activeTools, adapter, messages = input.messages) => {
    if (adapter.modelApi !== input.model.api) {
      throw new Error("Model Harness Prompt model identity is inconsistent");
    }
    return [
      formatEffectiveCapabilitiesPrompt({ ...input, activeTools }),
      formatModelHarnessPrompt(
        resolveModelHarnessResolution({
          model: input.model,
          messages,
          tools: activeTools.map((name) => ({ name })),
        }),
      ),
    ].join("\n\n");
  };
}

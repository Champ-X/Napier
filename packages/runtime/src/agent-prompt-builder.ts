import type { DelegationLedgerProjection } from "@napier/contracts";
import type { Message } from "@earendil-works/pi-ai";

import {
  createAgentPromptCompilerLayers,
  type AgentPromptLayerSources,
} from "./agent-prompt-layers.js";
import {
  formatAgentMilestoneContextProjection,
  type AgentMilestoneContextProjection,
} from "./agent-milestones.js";
import { formatDelegationLedgerProjection } from "./delegation-ledger.js";
import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import {
  STABLE_PROMPT_COMPILER_ASSEMBLY,
  type CompiledPromptArtifact,
} from "./prompt-compiler.js";
import { compileRuntimeContextPrompt } from "./runtime-context-delivery.js";
import {
  formatToolLoopGuardContext,
  type ActiveToolLoopGuard,
} from "./tool-loop-guard.js";

type StableAgentPromptSources = Omit<
  AgentPromptLayerSources,
  "delegation" | "milestones" | "toolLoopGuard"
>;

export function createAgentPromptBuilder(
  sources: StableAgentPromptSources,
  effectiveCapabilitiesForTools?: (
    activeTools: readonly string[],
    adapter: ModelAdapterReceiptV2,
    messages?: readonly Message[],
  ) => string,
) {
  return (
    adapter: ModelAdapterReceiptV2,
    delegation: DelegationLedgerProjection,
    milestones: AgentMilestoneContextProjection,
    toolLoopGuard: ActiveToolLoopGuard | undefined,
    activeTools?: readonly string[],
    messages?: readonly Message[],
  ): CompiledPromptArtifact =>
    compileRuntimeContextPrompt(
      {
        purpose: "agent_turn",
        ...(sources.promptPolicy === "stable-v1"
          ? { assembly: STABLE_PROMPT_COMPILER_ASSEMBLY }
          : {}),
        adapter,
        layers: createAgentPromptCompilerLayers({
          ...sources,
          ...(effectiveCapabilitiesForTools && activeTools
            ? {
                effectiveCapabilities: effectiveCapabilitiesForTools(
                  activeTools,
                  adapter,
                  messages,
                ),
              }
            : {}),
          delegation: formatDelegationLedgerProjection(delegation),
          milestones: formatAgentMilestoneContextProjection(milestones),
          toolLoopGuard: formatToolLoopGuardContext(toolLoopGuard),
        }),
      },
      sources.contextDelivery,
    );
}

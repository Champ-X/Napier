import type { DelegationLedgerProjection } from "@napier/contracts";

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
  compilePrompt,
  type CompiledPromptArtifact,
} from "./prompt-compiler.js";
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
  ) => string,
) {
  return (
    adapter: ModelAdapterReceiptV2,
    delegation: DelegationLedgerProjection,
    milestones: AgentMilestoneContextProjection,
    toolLoopGuard: ActiveToolLoopGuard | undefined,
    activeTools?: readonly string[],
  ): CompiledPromptArtifact =>
    compilePrompt({
      purpose: "agent_turn",
      adapter,
      layers: createAgentPromptCompilerLayers({
        ...sources,
        ...(effectiveCapabilitiesForTools && activeTools
          ? {
              effectiveCapabilities: effectiveCapabilitiesForTools(
                activeTools,
                adapter,
              ),
            }
          : {}),
        delegation: formatDelegationLedgerProjection(delegation),
        milestones: formatAgentMilestoneContextProjection(milestones),
        toolLoopGuard: formatToolLoopGuardContext(toolLoopGuard),
      }),
    });
}

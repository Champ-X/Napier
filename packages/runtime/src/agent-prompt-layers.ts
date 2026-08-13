import type { ModelInvocationPurpose } from "@napier/contracts";

import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import {
  compilePrompt,
  type CompiledPromptArtifact,
  type PromptCompilerLayerInput,
} from "./prompt-compiler.js";
import { PROMPT_INVARIANT_CORE } from "./prompt-invariant-core.js";

export interface AgentPromptLayerSources {
  resolvedSystemPrompt: string;
  skillCatalog: string;
  effectiveCapabilities: string;
  workspaceToolGuidance: string;
  planToolGuidance: string;
  sourceContinuityGuidance: string;
  importedLedgerBoundary: string;
  checkpoint: string;
  memory: string;
  delegation: string;
  milestones: string;
  toolLoopGuard: string;
}

export function createAgentPromptCompilerLayers(
  sources: AgentPromptLayerSources,
): PromptCompilerLayerInput[] {
  return [
    {
      id: "invariant_core",
      priority: 1_000,
      budgetBytes: 1_024,
      sources: [
        requiredSource("runtime.invariant_core", PROMPT_INVARIANT_CORE, 1_000),
      ],
    },
    {
      id: "effective_capabilities",
      priority: 800,
      budgetBytes: 256 * 1_024,
      sources: [
        requiredSource(
          "capabilities.effective_run",
          sources.effectiveCapabilities,
          1_100,
        ),
        requiredSource(
          "capabilities.workspace_tools",
          sources.workspaceToolGuidance,
          1_000,
        ),
        requiredSource(
          "capabilities.plan_tools",
          sources.planToolGuidance,
          900,
        ),
        optionalSource(
          "capabilities.source_continuity",
          sources.sourceContinuityGuidance,
          700,
        ),
      ],
    },
    {
      id: "task_skill_overlay",
      priority: 700,
      budgetBytes: 384 * 1_024,
      sources: [
        requiredSource(
          "task.agent_profile",
          sources.resolvedSystemPrompt,
          1_000,
        ),
        optionalSource("task.skill_catalog", sources.skillCatalog, 800),
      ],
    },
    {
      id: "workspace_context",
      priority: 600,
      budgetBytes: 256 * 1_024,
      sources: [
        optionalSource(
          "workspace.import_boundary",
          sources.importedLedgerBoundary,
          1_000,
        ),
        optionalSource("workspace.checkpoint", sources.checkpoint, 950),
        optionalSource("workspace.memory", sources.memory, 900),
        optionalSource("workspace.delegation", sources.delegation, 850),
        optionalSource("workspace.milestones", sources.milestones, 800),
        optionalSource(
          "workspace.tool_loop_guard",
          sources.toolLoopGuard,
          1_000,
        ),
      ],
    },
  ];
}

export function compileAuxiliaryPrompt(input: {
  purpose: Exclude<ModelInvocationPurpose, "agent_turn">;
  sourceId: string;
  systemPrompt: string;
  adapter: ModelAdapterReceiptV2;
}): CompiledPromptArtifact {
  return compilePrompt({
    purpose: input.purpose,
    adapter: input.adapter,
    layers: [
      emptyLayer("invariant_core", 1_000),
      emptyLayer("effective_capabilities", 800),
      {
        id: "task_skill_overlay",
        priority: 700,
        budgetBytes: 256 * 1_024,
        sources: [requiredSource(input.sourceId, input.systemPrompt, 1_000)],
      },
      emptyLayer("workspace_context", 600),
    ],
  });
}

function requiredSource(sourceId: string, content: string, priority: number) {
  return { sourceId, content, priority, required: true };
}

function optionalSource(sourceId: string, content: string, priority: number) {
  return { sourceId, content, priority };
}

function emptyLayer(
  id: "invariant_core" | "effective_capabilities" | "workspace_context",
  priority: number,
): PromptCompilerLayerInput {
  return { id, priority, budgetBytes: 1, sources: [] };
}

import type { Tool } from "@earendil-works/pi-ai";
import type { AgentProfile, RunRecord, SubagentRole } from "@napier/contracts";
import { createSubagentInvocationContextPreparer } from "./subagent-invocation-context.js";
import { createAgentMilestoneContextProjection } from "./agent-milestones.js";
import { createRuntimeCompiledPromptBuilder } from "./agent-runtime-step-lifecycle.js";
import type { AgentTurnPipeline } from "./agent-turn-pipeline.js";
import { createDelegationLedgerProjection } from "./delegation-ledger.js";
import type { AgentTurnModelCallPipeline } from "./kernel-model-call-pipeline.js";
import type { ModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";

/** Inject the runtime's configured compiler/extensions, then bind them to the
 * authorized child profile and actual tool objects after restoration checks. */
export function createSubagentModelCallServices(input: {
  store: Parameters<typeof createSubagentInvocationContextPreparer>[0];
  pipeline: AgentTurnModelCallPipeline;
  turnPipeline: AgentTurnPipeline;
  sandboxId: string;
  harnessExperimentProfile?: ModelHarnessExperimentProfile | undefined;
}) {
  return {
    createScope(owner: { run: RunRecord; profile: AgentProfile; role: SubagentRole; tools: readonly Tool[] }) {
      return {
        lifecycle: input.pipeline.createInvocationLifecycle(),
        prepareInvocationContext: createSubagentInvocationContextPreparer(input.store, owner.run),
        harnessExperimentProfile: input.harnessExperimentProfile,
        buildCompiledPrompt: createRuntimeCompiledPromptBuilder({
          turnPipeline: input.turnPipeline, profile: owner.profile, run: owner.run,
          sandboxId: input.sandboxId,
          restrictedReadOnlyExecution: owner.role !== "coder",
          environmentDegradedExecution: false, advisorCorrection: false,
          browserInteractionConfirmationAvailable: false,
          resolvedSystemPrompt: owner.profile.systemPrompt, skillCatalog: "",
          availableToolNames: owner.tools.map((tool) => tool.name),
          sourceContinuityGuidance: "", importedLedgerBoundary: "", checkpoint: "", memory: "",
          delegation: () => createDelegationLedgerProjection(owner.run.threadId, []),
          milestones: () => createAgentMilestoneContextProjection(owner.run.threadId, []),
          toolLoopGuard: () => undefined,
          harnessExperimentProfile: input.harnessExperimentProfile,
        }),
      };
    },
  };
}

export type SubagentModelCallServices = ReturnType<typeof createSubagentModelCallServices>;
export type SubagentModelCallScope = ReturnType<SubagentModelCallServices["createScope"]>;

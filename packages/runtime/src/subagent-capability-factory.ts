import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile, RunEvent } from "@napier/contracts";
import type { AppendEventInput } from "./store-event-service.js";
import type { SkillSnapshot } from "./standard-skill-snapshot.js";
import type { ResearchSourceCapsuleReceipt } from "./research-source-capsule-model.js";
import type { WebFetchStateCapsuleReceipt } from "./web-fetch-capsule-model.js";
import { recordNetworkSourceContinuityContexts } from "./research-source-recovery-context.js";
import { assertSubagentToolContext, type SubagentExecutionBindingStore, type SubagentExecutionContext } from "./subagent-execution-context.js";
export type { SubagentExecutionContext } from "./subagent-execution-context.js";

export interface AgentCapabilityOwner {
  threadId: string;
  runId: string;
}

export interface SubagentCapabilityFactoryOptions {
  projectSkillSnapshot?: SkillSnapshot;
  skillLoadAllowed?: boolean;
}
interface CapabilityFactoryPort {
  createTools(options: SubagentCapabilityFactoryOptions & AgentCapabilityOwner & {
    profile: AgentProfile; browserInteractionConfirmationAllowed: boolean;
  }): AgentTool[];
  prepareNetworkSourceRecovery(
    owner: AgentCapabilityOwner,
    enabled: { researchSource: boolean; webFetch: boolean },
    parentRunId: string,
  ): Promise<{ research: ResearchSourceCapsuleReceipt | undefined; webFetch: WebFetchStateCapsuleReceipt | undefined }>;
}

export async function createSubagentCapabilityTools(
  store: SubagentExecutionBindingStore & { appendEvent(input: AppendEventInput): Promise<RunEvent> },
  capabilities: CapabilityFactoryPort,
  context: SubagentExecutionContext,
  options: SubagentCapabilityFactoryOptions,
): Promise<AgentTool[]> {
  assertSubagentToolContext(store, context);
  const owner = { threadId: context.executionRun.threadId, runId: context.executionRun.id };
  const enabled = context.childProfile.enabledTools;
  // Copy bounded immutable sources, never live browser/process ownership.
  await recordNetworkSourceContinuityContexts({
    ...owner, enabled: true,
    prepare: () => capabilities.prepareNetworkSourceRecovery(owner, {
      researchSource: enabled.includes("research_source"), webFetch: enabled.includes("web_fetch"),
    }, context.authorityOriginRun.id),
    record: (event) => store.appendEvent(event),
  });
  assertSubagentToolContext(store, context);
  return capabilities.createTools({
    ...owner, ...options, profile: structuredClone(context.childProfile),
    browserInteractionConfirmationAllowed: false,
  });
}

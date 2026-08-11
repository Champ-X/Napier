import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { LocalAgentRuntimeServices } from "@napier/runtime";
import { PROCESS_RUN_READINESS_MESSAGE } from "@napier/runtime/process-run-readiness";

type ThreadRunReadinessStore = Pick<
  LocalAgentRuntimeServices["store"],
  "getThread"
>;
type ThreadRunReadinessCapabilities = Pick<
  LocalAgentRuntimeServices["agentCapabilities"],
  "blockedRunReadinessProjection"
>;

export type ThreadPromptReadiness =
  | { ready: true }
  | {
      ready: false;
      code: "sandbox_unavailable";
      message: string;
      projectionSha256: string;
    };

export async function inspectThreadPromptReadiness(input: {
  store: ThreadRunReadinessStore;
  agentCapabilities: ThreadRunReadinessCapabilities;
  threadId: string;
  capabilityPreset?: AgentCapabilityPresetId;
}): Promise<ThreadPromptReadiness> {
  const thread = input.store.getThread(input.threadId);
  const projection =
    await input.agentCapabilities.blockedRunReadinessProjection(
      thread.agentId,
      input.capabilityPreset,
    );
  if (!projection) return { ready: true };
  return {
    ready: false,
    code: "sandbox_unavailable",
    message: PROCESS_RUN_READINESS_MESSAGE,
    projectionSha256: projection.projectionSha256,
  };
}

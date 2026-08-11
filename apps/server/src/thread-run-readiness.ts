import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import type { LocalAgentRuntimeServices } from "@napier/runtime";
import { processRunReadinessMessage } from "@napier/runtime/process-run-readiness";

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
  const sandbox = projection.readiness.find((record) =>
    record.id.startsWith("sandbox:"),
  );
  return {
    ready: false,
    code: "sandbox_unavailable",
    message: processRunReadinessMessage(sandbox),
    projectionSha256: projection.projectionSha256,
  };
}

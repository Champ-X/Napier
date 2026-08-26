import type {
  AgentProfile,
  JsonObject,
  ModelRef,
  RunInvocationSource,
  RunLimits,
  RunRecord,
} from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";
import { assertRunIntent, createRunIntentId } from "./run-intents.js";

export function createAgentRunStartedPayload(input: {
  agent: Pick<AgentProfile, "id" | "revision">;
  model: ModelRef;
  source: RunInvocationSource;
  run: Pick<RunRecord, "id" | "agentRevision" | "configuration">;
  limits: RunLimits;
  triggerId: string | undefined;
  capabilityPreset: AgentCapabilityPresetId | undefined;
  parentRunId: string | undefined;
  sourceContinuityRunId: string | undefined;
  recovery:
    | {
        mode: "manual" | "automatic";
        intentId?: string;
        attemptId?: string;
        assessmentSha256?: string;
      }
    | undefined;
}): JsonObject {
  const intentId = input.recovery?.intentId ?? createRunIntentId(input.run.id);
  assertRunIntent(intentId);
  return JSON.parse(
    JSON.stringify({
      agentId: input.agent.id,
      model: `${input.model.provider}/${input.model.id}`,
      source: input.source,
      intentId,
      agentRevision: input.run.agentRevision ?? input.agent.revision,
      limits: input.limits,
      ...(input.run.configuration
        ? { configurationSha256: input.run.configuration.contentSha256 }
        : {}),
      ...(input.triggerId ? { triggerId: input.triggerId } : {}),
      ...(input.capabilityPreset
        ? { capabilityPreset: input.capabilityPreset }
        : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.sourceContinuityRunId
        ? { sourceContinuityRunId: input.sourceContinuityRunId }
        : {}),
      ...(input.recovery
        ? {
            recoveryMode: input.recovery.mode,
            ...(input.recovery.attemptId
              ? { recoveryAttemptId: input.recovery.attemptId }
              : {}),
            ...(input.recovery.assessmentSha256
              ? {
                  recoveryAssessmentSha256: input.recovery.assessmentSha256,
                }
              : {}),
          }
        : {}),
    }),
  ) as JsonObject;
}

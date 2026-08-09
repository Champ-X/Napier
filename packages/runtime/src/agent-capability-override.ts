import type {
  AgentProfile,
  AgentProfileRevision,
  ModelRef,
  RunConfigurationFingerprint,
  RunEvent,
  RunInvocationSource,
  RunRecord,
} from "@napier/contracts";
import {
  AGENT_CAPABILITY_PRESET_IDS,
  agentCapabilityPresetUpdate,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";

export function applyAgentCapabilityPresetOverride(
  profile: AgentProfile,
  presetId: AgentCapabilityPresetId | undefined,
  source: RunInvocationSource,
): AgentProfile {
  if (!presetId) return structuredClone(profile);
  if (source !== "user") {
    throw new Error(
      "Temporary Agent capability presets are available only for user Runs",
    );
  }
  return {
    ...structuredClone(profile),
    ...agentCapabilityPresetUpdate(presetId),
  };
}

export function resolveAgentCapabilityProfile(input: {
  agents: readonly AgentProfile[];
  revisions: readonly AgentProfileRevision[];
  agentId: string;
  agentRevision?: number;
  presetId?: AgentCapabilityPresetId;
  source: RunInvocationSource;
}): AgentProfile {
  const agent = input.agents.find(
    (candidate) => candidate.id === input.agentId,
  );
  if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
  const profile =
    input.agentRevision === undefined
      ? agent
      : input.revisions.find(
          (revision) =>
            revision.agentId === input.agentId &&
            revision.revision === input.agentRevision,
        )?.profile;
  if (!profile) {
    throw new Error(
      `Agent revision not found: ${input.agentId}@${String(input.agentRevision)}`,
    );
  }
  return applyAgentCapabilityPresetOverride(
    profile,
    input.presetId,
    input.source,
  );
}

export function resolveAgentCapabilityProfileFromStore(
  store: {
    getAgent(agentId: string): AgentProfile;
    getAgentRevision(agentId: string, revision: number): AgentProfileRevision;
  },
  agentId: string,
  agentRevision: number | undefined,
  presetId: AgentCapabilityPresetId | undefined,
  source: RunInvocationSource,
): AgentProfile {
  const profile =
    agentRevision === undefined
      ? store.getAgent(agentId)
      : store.getAgentRevision(agentId, agentRevision).profile;
  return applyAgentCapabilityPresetOverride(profile, presetId, source);
}

export function capabilityPresetForOriginRun(
  events: readonly RunEvent[],
  runId: string,
): AgentCapabilityPresetId | undefined {
  const event = events.find(
    (candidate) =>
      candidate.runId === runId && candidate.type === "run.started",
  );
  const presetId =
    event?.payload &&
    !Array.isArray(event.payload) &&
    typeof event.payload === "object"
      ? event.payload["capabilityPreset"]
      : undefined;
  if (presetId === undefined) return undefined;
  if (
    typeof presetId !== "string" ||
    !AGENT_CAPABILITY_PRESET_IDS.includes(presetId as AgentCapabilityPresetId)
  ) {
    throw new Error("Origin Run capability preset evidence is invalid");
  }
  return presetId as AgentCapabilityPresetId;
}

export async function resolveOperatorDecisionCapabilityContinuation(
  store: {
    listEvents(threadId: string): Promise<RunEvent[]>;
    listRuns(threadId: string): RunRecord[];
  },
  threadId: string,
  runId: string,
): Promise<{
  originRun: RunRecord;
  runOptions: {
    model?: ModelRef;
    agentRevision?: number;
    capabilityPreset?: AgentCapabilityPresetId;
  };
}> {
  const originRun = store
    .listRuns(threadId)
    .find((candidate) => candidate.id === runId);
  if (!originRun) {
    throw new Error(`Operator decision origin Run not found: ${runId}`);
  }
  if (
    originRun.source === "workflow" ||
    originRun.source === "workflow_reuse" ||
    originRun.source === "workflow_simulation"
  ) {
    throw new Error(
      "Workflow operator decisions must continue through their Workflow Plan",
    );
  }
  const capabilityPreset = capabilityPresetForOriginRun(
    await store.listEvents(threadId),
    originRun.id,
  );
  return {
    originRun,
    runOptions: {
      ...(originRun.configuration
        ? { model: originRun.configuration.model }
        : {}),
      ...(originRun.agentRevision !== undefined
        ? { agentRevision: originRun.agentRevision }
        : {}),
      ...(capabilityPreset ? { capabilityPreset } : {}),
    },
  };
}

export function assertOperatorDecisionCapabilityContinuation(
  profile: AgentProfile,
  originRun: Pick<RunRecord, "agentRevision" | "configuration">,
  model: ModelRef | undefined,
): void {
  if (!originRun.configuration) {
    throw new Error(
      "Operator decision origin Run configuration is unavailable",
    );
  }
  if (profile.revision !== originRun.agentRevision) {
    throw new Error(
      "Operator decision continuation must reuse the origin Agent revision",
    );
  }
  const configuration: RunConfigurationFingerprint = originRun.configuration;
  if (
    profile.toolPolicy !== configuration.toolPolicy ||
    !sameSet(profile.enabledTools, configuration.enabledTools) ||
    !sameSet(profile.enabledSkills, configuration.enabledSkills) ||
    !sameSet(profile.enabledSubagents ?? [], configuration.enabledSubagents)
  ) {
    throw new Error(
      "Operator decision continuation must reuse the origin Agent capabilities",
    );
  }
  const continuationModel = model ?? profile.model;
  if (
    continuationModel.provider !== configuration.model.provider ||
    continuationModel.id !== configuration.model.id
  ) {
    throw new Error(
      "Operator decision continuation must reuse the origin model",
    );
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    JSON.stringify([...new Set(left)].sort()) ===
    JSON.stringify([...new Set(right)].sort())
  );
}

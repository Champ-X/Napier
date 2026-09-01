import type {
  AgentProfile,
  AgentProfileRevision,
  RunEvent,
  RunInvocationSource,
  RunRecord,
} from "@napier/contracts";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import {
  applyAgentCapabilityPresetOverride,
  capabilityPresetForOriginRun,
  resolveAgentCapabilityProfile,
  resolveAgentCapabilityProfileFromStore,
} from "./agent-capability-override.js";
import type { RunPromptOptions } from "./agent-runtime-options.js";
import type { OsSandboxAdapter } from "./sandbox.js";

const INTERNAL_CAPABILITY_PRESET_RECOVERY_AUTHORIZATION = Symbol(
  "internal-capability-preset-recovery-authorization",
);

type InternallyAuthorizedCapabilityPresetRecovery = {
  [INTERNAL_CAPABILITY_PRESET_RECOVERY_AUTHORIZATION]: true;
};

export function authorizeInternalCapabilityPresetRecovery<T extends object>(
  value: T,
): T & InternallyAuthorizedCapabilityPresetRecovery {
  return {
    ...value,
    [INTERNAL_CAPABILITY_PRESET_RECOVERY_AUTHORIZATION]: true,
  };
}

export function authorizeInternalCapabilityPresetRecoveryIf<T extends object>(
  value: T,
  authorized: boolean,
): T | (T & InternallyAuthorizedCapabilityPresetRecovery) {
  if (!authorized) return value;
  return authorizeInternalCapabilityPresetRecovery(value);
}

export function hasInternalCapabilityPresetRecoveryAuthorization(
  value: object,
): value is object & InternallyAuthorizedCapabilityPresetRecovery {
  return (
    (value as InternallyAuthorizedCapabilityPresetRecovery)[
      INTERNAL_CAPABILITY_PRESET_RECOVERY_AUTHORIZATION
    ] === true
  );
}

export async function resolvePromptCapabilityProfile(
  store: {
    workspaceRoot: string;
    getAgent(agentId: string): AgentProfile;
    getAgentRevision(agentId: string, revision: number): AgentProfileRevision;
  },
  _sandbox: OsSandboxAdapter,
  agentId: string,
  options: RunPromptOptions,
  source: RunInvocationSource,
): Promise<{
  profile: AgentProfile;
  internalCapabilityPresetRecovery: boolean;
}> {
  const internalCapabilityPresetRecovery =
    hasInternalCapabilityPresetRecoveryAuthorization(options);
  if (
    internalCapabilityPresetRecovery &&
    (source !== "recovery" ||
      !options.capabilityPreset ||
      !options.parentRunId ||
      !options.recovery)
  ) {
    throw new Error(
      "Internal capability preset recovery authorization is invalid",
    );
  }
  const base = resolveAgentCapabilityProfileFromStore(
    store,
    agentId,
    options.agentRevision,
    internalCapabilityPresetRecovery ? undefined : options.capabilityPreset,
    source,
  );
  const profile = internalCapabilityPresetRecovery
    ? applyAgentCapabilityPresetOverride(base, options.capabilityPreset, "user")
    : base;
  return {
    internalCapabilityPresetRecovery,
    profile,
  };
}

export function resolveStoredRunCapabilityProfile(input: {
  agents: readonly AgentProfile[];
  revisions: readonly AgentProfileRevision[];
  runs: readonly RunRecord[];
  events: readonly RunEvent[];
  threadId: string;
  agentId: string;
  agentRevision: number | undefined;
  capabilityPreset: AgentCapabilityPresetId | undefined;
  parentRunId: string | undefined;
  source: RunInvocationSource;
  authorizationCarrier: object;
}): AgentProfile {
  const authorized = hasInternalCapabilityPresetRecoveryAuthorization(
    input.authorizationCarrier,
  );
  if (authorized) {
    const parent = input.parentRunId
      ? input.runs.find(
          (run) =>
            run.id === input.parentRunId && run.threadId === input.threadId,
        )
      : undefined;
    if (
      input.source !== "recovery" ||
      !input.capabilityPreset ||
      !parent ||
      capabilityPresetForOriginRun(input.events, parent.id) !==
        input.capabilityPreset
    ) {
      throw new Error(
        "Internal capability preset recovery authorization is invalid",
      );
    }
  }
  const base = resolveAgentCapabilityProfile({
    agents: input.agents,
    revisions: input.revisions,
    agentId: input.agentId,
    ...(input.agentRevision === undefined
      ? {}
      : { agentRevision: input.agentRevision }),
    ...(input.capabilityPreset && !authorized
      ? { presetId: input.capabilityPreset }
      : {}),
    source: input.source,
  });
  return authorized
    ? applyAgentCapabilityPresetOverride(base, input.capabilityPreset, "user")
    : base;
}

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
import { sharedProcessRunReadinessGate } from "./process-run-readiness.js";
import type { OsSandboxAdapter } from "./sandbox.js";

const INTERNAL_RESEARCH_RECOVERY_AUTHORIZATION = Symbol(
  "internal-research-recovery-authorization",
);

type InternallyAuthorizedResearchRecovery = {
  [INTERNAL_RESEARCH_RECOVERY_AUTHORIZATION]: true;
};

export function authorizeInternalResearchRecovery<T extends object>(
  value: T,
): T & InternallyAuthorizedResearchRecovery {
  return {
    ...value,
    [INTERNAL_RESEARCH_RECOVERY_AUTHORIZATION]: true,
  };
}

export function authorizeInternalResearchRecoveryIf<T extends object>(
  value: T,
  authorized: boolean,
): T | (T & InternallyAuthorizedResearchRecovery) {
  if (!authorized) return value;
  return authorizeInternalResearchRecovery(value);
}

export function hasInternalResearchRecoveryAuthorization(
  value: object,
): value is object & InternallyAuthorizedResearchRecovery {
  return (
    (value as InternallyAuthorizedResearchRecovery)[
      INTERNAL_RESEARCH_RECOVERY_AUTHORIZATION
    ] === true
  );
}

export async function resolvePromptCapabilityProfile(
  store: {
    workspaceRoot: string;
    getAgent(agentId: string): AgentProfile;
    getAgentRevision(agentId: string, revision: number): AgentProfileRevision;
  },
  sandbox: OsSandboxAdapter,
  agentId: string,
  options: RunPromptOptions,
  source: RunInvocationSource,
): Promise<{ profile: AgentProfile; internalResearchRecovery: boolean }> {
  const internalResearchRecovery =
    hasInternalResearchRecoveryAuthorization(options);
  if (
    internalResearchRecovery &&
    (source !== "recovery" ||
      options.capabilityPreset !== "research" ||
      !options.parentRunId ||
      !options.recovery)
  ) {
    throw new Error("Internal Research recovery authorization is invalid");
  }
  const base = resolveAgentCapabilityProfileFromStore(
    store,
    agentId,
    options.agentRevision,
    internalResearchRecovery ? undefined : options.capabilityPreset,
    source,
  );
  const profile = internalResearchRecovery
    ? applyAgentCapabilityPresetOverride(base, "research", "user")
    : base;
  const requiresProcessReadiness =
    sandbox.readinessVersion !== undefined &&
    (options.capabilityPreset !== undefined ||
      source === "schedule" ||
      source === "channel");
  if (
    requiresProcessReadiness &&
    (!options.executionMode || options.executionMode === "standard")
  ) {
    await sharedProcessRunReadinessGate(
      sandbox,
      store.workspaceRoot,
    ).assertProfile(profile, options.signal);
  }
  return {
    internalResearchRecovery,
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
  const authorized = hasInternalResearchRecoveryAuthorization(
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
      input.capabilityPreset !== "research" ||
      !parent ||
      capabilityPresetForOriginRun(input.events, parent.id) !== "research"
    ) {
      throw new Error("Internal Research recovery authorization is invalid");
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
    ? applyAgentCapabilityPresetOverride(base, "research", "user")
    : base;
}

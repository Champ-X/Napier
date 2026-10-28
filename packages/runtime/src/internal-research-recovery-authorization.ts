import { canonicalJson } from "./ed25519.js";
import {
  planWorkspacePatchRecovery,
  type PatchRecoveryPlan,
} from "./workspace-patch-recovery-plan.js";
export type { PatchRecoveryPlan } from "./workspace-patch-recovery-plan.js";
export { VERIFIED_PATCH_RECOVERY } from "./workspace-patch-recovery-plan.js";
import { VERIFIED_PATCH_RECOVERY } from "./workspace-patch-recovery-plan.js";
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

export function assertWorkspacePatchRecoveryGrant(input: {
  source?: string | undefined;
  executionMode: string;
  latestRunId?: string | undefined;
  operatorDecisionId?: string | undefined;
  parent: RunRecord | undefined;
  agentId: string;
  agentRevision: number;
  threadId: string;
  carrier: { [VERIFIED_PATCH_RECOVERY]?: PatchRecoveryPlan };
  events: RunEvent[];
}): PatchRecoveryPlan | undefined {
  if (input.source === "recovery" && input.parent && !input.operatorDecisionId &&
      input.latestRunId !== undefined && input.latestRunId !== input.parent.id)
    throw new Error("Recovery checkpoint superseded by a later Run");
  if (
    input.executionMode === "safe_read_only_recovery" &&
    (input.source !== "recovery" ||
      !input.parent ||
      !(input.parent.status === "interrupted" ||
        (input.parent.status === "failed" &&
         (input.parent.outcome === "partial" || input.parent.outcome === "paused_budget"))) ||
      input.parent.threadId !== input.threadId ||
      input.parent.agentId !== input.agentId)
  )
    throw new Error(
      "Safe read-only recovery requires an interrupted or partial parent Run",
    );
  const grant = input.carrier[VERIFIED_PATCH_RECOVERY];
  if (input.executionMode !== "verified_patch_recovery") {
    if (grant)
      throw new Error(
        "Patch recovery grant requires its bounded execution mode",
      );
    return undefined;
  }
  const parent = input.parent;
  if (
    !grant ||
    input.source !== "recovery" ||
    !parent ||
    parent.threadId !== input.threadId ||
    parent.agentId !== input.agentId ||
    parent.agentRevision !== input.agentRevision ||
    canonicalJson(planWorkspacePatchRecovery(parent, input.events)) !==
      canonicalJson(grant)
  )
    throw new Error(
      "Verified patch recovery requires its current internal operation grant",
    );
  return grant;
}

export function patchRecoveryRunInput(carrier: {
  [VERIFIED_PATCH_RECOVERY]?: PatchRecoveryPlan;
}) {
  const grant = carrier[VERIFIED_PATCH_RECOVERY];
  return grant ? { [VERIFIED_PATCH_RECOVERY]: grant } : {};
}

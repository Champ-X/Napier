import { access } from "node:fs/promises";
import path from "node:path";

import { AGENT_TOOL_NAMES, type AgentProfile } from "@napier/contracts";
import type {
  CapabilityDriftState,
  CapabilityReadinessRecord,
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesRequestV1,
  RestoreRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import {
  bindingMatchesProfile,
  type CapabilityBindingLookup,
} from "./agent-capability-bindings.js";
import {
  capabilitySha256,
  compareCanonicalText,
  createCapabilityRestorePreview,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
} from "./default-agent-capability-contract.js";
import { probeMacOsSandboxAvailability } from "./macos-sandbox-availability.js";
import {
  buildProjectSkillSnapshot,
  type ProjectSkillSnapshot,
} from "./project-skill-snapshot.js";
import { resolveContainerExecutable } from "./sandbox-container.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { LocalStore } from "./store.js";

const KNOWN_TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);

export class AgentCapabilityService {
  private sandboxReadiness: Promise<CapabilityReadinessRecord> | undefined;

  constructor(
    private readonly store: LocalStore,
    private readonly sandbox: OsSandboxAdapter,
    private readonly capabilityRuntime: AgentCapabilityRuntime,
  ) {}

  async project(
    agentId: string,
  ): Promise<EffectiveAgentCapabilityProjectionV1> {
    const profile = this.store.getAgent(agentId);
    const bindingLookup = this.store.getAgentCapabilityBinding(
      agentId,
      profile.revision,
    );
    return this.projectSnapshot(profile, bindingLookup);
  }

  private async projectSnapshot(
    profile: AgentProfile,
    bindingLookup: CapabilityBindingLookup,
  ): Promise<EffectiveAgentCapabilityProjectionV1> {
    const binding =
      bindingLookup.status === "valid" ? bindingLookup.binding : undefined;
    const restorePreview = createCapabilityRestorePreview(profile);
    const skillInspection = await inspectSkillReadiness(
      this.store.workspaceRoot,
      profile.enabledSkills,
      profile.enabledTools.includes("skill_load"),
    );
    const runtimeExposedTools = this.capabilityRuntime
      .createTools({
        profile,
        threadId: `capability_projection_${profile.id}`,
        runId: `capability_projection_${String(profile.revision)}`,
        ...(skillInspection.snapshot
          ? { projectSkillSnapshot: skillInspection.snapshot }
          : {}),
        skillLoadAllowed: Boolean(skillInspection.snapshot),
        browserInteractionConfirmationAllowed: false,
      })
      .map((tool) => tool.name)
      .sort(compareCanonicalText);
    const readiness = [
      ...toolReadiness(profile.enabledTools, runtimeExposedTools),
      ...skillInspection.readiness,
      await this.getSandboxReadiness(),
    ].sort((left, right) => compareCanonicalText(left.id, right.id));
    const driftState = capabilityDriftState(bindingLookup, profile);
    const projection = {
      kind: "napier.effective-agent-capabilities" as const,
      schemaVersion: 1 as const,
      agentId: profile.id,
      agentRevision: profile.revision,
      contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
      contractVersion: DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
      recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
      driftState,
      ownership: binding?.ownership ?? ("unmanaged" as const),
      explicitOverrideFields: binding
        ? [...binding.explicitOverrideFields]
        : [],
      ...(binding?.legacySignatureSha256
        ? { legacySignatureSha256: binding.legacySignatureSha256 }
        : {}),
      toolPolicy: profile.toolPolicy,
      configuredTools: sortedUnique(profile.enabledTools),
      runtimeExposedTools: sortedUnique(runtimeExposedTools),
      configuredSkills: sortedUnique(profile.enabledSkills),
      configuredSubagents: sortedUnique(profile.enabledSubagents ?? []),
      readiness,
      restorePreview,
    };
    return {
      ...projection,
      projectionSha256: capabilitySha256(projectionHashPayload(projection)),
    };
  }

  async restore(
    agentId: string,
    request: RestoreRecommendedCapabilitiesRequestV1,
  ): Promise<RestoreRecommendedCapabilitiesResultV1> {
    const commit = await this.store.restoreRecommendedAgentCapabilities(
      agentId,
      request,
    );
    return {
      schemaVersion: 1,
      previousRevision: commit.previousRevision,
      projection: await this.projectSnapshot(commit.agent, {
        status: "valid",
        binding: commit.binding,
      }),
    };
  }

  private getSandboxReadiness(): Promise<CapabilityReadinessRecord> {
    this.sandboxReadiness ??= inspectSandboxReadiness(this.sandbox);
    return this.sandboxReadiness;
  }
}

function capabilityDriftState(
  lookup: CapabilityBindingLookup,
  profile: Parameters<typeof bindingMatchesProfile>[1],
): CapabilityDriftState {
  if (lookup.status === "broken") return "broken";
  if (lookup.status === "missing") return "custom_unmanaged";
  if (!bindingMatchesProfile(lookup.binding, profile)) return "broken";
  return lookup.binding.ownership === "unknown_legacy" ||
    lookup.binding.contractVersion !==
      DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION ||
    lookup.binding.recommendationSha256 !==
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256
    ? "stale"
    : "current";
}

function toolReadiness(
  configuredTools: readonly string[],
  runtimeExposedTools: readonly string[],
): CapabilityReadinessRecord[] {
  const exposed = new Set(runtimeExposedTools);
  return sortedUnique(configuredTools).map((name) => {
    if (!KNOWN_TOOL_NAMES.has(name)) {
      return {
        id: `tool:${name}`,
        status: "unknown_configured" as const,
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "Unknown configured tool is preserved but never exposed",
      };
    }
    if (!exposed.has(name)) {
      if (name === "skill_load") {
        return {
          id: `tool:${name}`,
          status: "unavailable" as const,
          configured: true,
          allowedByPolicy: true,
          exposed: false,
          detail:
            "Skill loader is policy-allowed but no safe Project Skill snapshot is available",
        };
      }
      return {
        id: `tool:${name}`,
        status: "blocked_by_policy" as const,
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "Configured tool is blocked by the effective policy",
      };
    }
    const externallyVerified = ![
      "web_search",
      "web_fetch",
      "browser",
      "research_source",
    ].includes(name);
    return {
      id: `tool:${name}`,
      status: externallyVerified
        ? ("ready" as const)
        : ("available_unverified" as const),
      configured: true,
      allowedByPolicy: true,
      exposed: true,
      detail: externallyVerified
        ? "Tool is constructed and exposed by the current Runtime"
        : "Tool is exposed; external dependency health is not claimed",
    };
  });
}

interface SkillReadinessInspection {
  snapshot?: ProjectSkillSnapshot;
  readiness: CapabilityReadinessRecord[];
}

async function inspectSkillReadiness(
  workspaceRoot: string,
  skills: readonly string[],
  firstClassLoaderConfigured: boolean,
): Promise<SkillReadinessInspection> {
  if (!firstClassLoaderConfigured) {
    return {
      readiness: await legacySkillReadiness(workspaceRoot, skills),
    };
  }
  let snapshot: ProjectSkillSnapshot;
  try {
    snapshot = await buildProjectSkillSnapshot(workspaceRoot, skills);
  } catch {
    return {
      readiness: await Promise.all(
        sortedUnique(skills).map(async (name) => ({
          id: `skill:${name}`,
          status: (await skillFileExists(workspaceRoot, name))
            ? ("unavailable" as const)
            : ("missing" as const),
          configured: true,
          allowedByPolicy: true,
          exposed: false,
          detail: (await skillFileExists(workspaceRoot, name))
            ? "Project Skill snapshot could not be safely constructed"
            : "Configured Skill content is missing",
        })),
      ),
    };
  }
  const requests = new Map(
    snapshot.binding.configuredSkillRequests
      .filter((request) => request.canonicalName)
      .map((request) => [request.canonicalName!, request]),
  );
  const failures = new Map(
    snapshot.binding.unavailableSkills.map((failure) => [
      failure.contentSha256,
      failure,
    ]),
  );
  return {
    snapshot,
    readiness: sortedUnique(skills).map((name) => {
      const request = requests.get(name);
      const failure =
        request?.state === "unavailable"
          ? failures.get(request.failureContentSha256)
          : undefined;
      const ready =
        request?.state === "loadable" && Boolean(snapshot.entry(name));
      return {
        id: `skill:${name}`,
        status: ready ? ("ready" as const) : ("unavailable" as const),
        configured: true,
        allowedByPolicy: true,
        exposed: ready,
        detail: ready
          ? "Skill is snapshot-bound and loadable through the production Runtime"
          : `Skill is unavailable${failure ? ` (${failure.failureCode})` : ""}`,
      };
    }),
  };
}

async function legacySkillReadiness(
  workspaceRoot: string,
  skills: readonly string[],
): Promise<CapabilityReadinessRecord[]> {
  return Promise.all(
    sortedUnique(skills).map(async (name) => {
      const exists = await skillFileExists(workspaceRoot, name);
      return {
        id: `skill:${name}`,
        status: exists ? ("catalog_only" as const) : ("missing" as const),
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: exists
          ? "Skill is catalogued; no first-class Runtime loader is available"
          : "Configured Skill content is missing",
      };
    }),
  );
}

function skillFileExists(
  workspaceRoot: string,
  name: string,
): Promise<boolean> {
  return access(path.join(workspaceRoot, "skills", name, "SKILL.md")).then(
    () => true,
    () => false,
  );
}

export async function inspectSandboxReadiness(
  sandbox: OsSandboxAdapter,
  availability: (
    sandbox: OsSandboxAdapter,
  ) => Promise<boolean> = sandboxAvailable,
): Promise<CapabilityReadinessRecord> {
  const available = await availability(sandbox);
  return {
    id: `sandbox:${sandbox.id}`,
    status: available ? "available_unverified" : "unavailable",
    configured: true,
    allowedByPolicy: false,
    exposed: false,
    detail: available
      ? "Sandbox provider is available; effective process access remains policy-blocked until a tool is exposed"
      : "Sandbox provider is unavailable; process capabilities fail closed",
  };
}

async function sandboxAvailable(sandbox: OsSandboxAdapter): Promise<boolean> {
  try {
    if (sandbox.id === "unsupported") return false;
    if (sandbox.id === "macos-sandbox-exec") {
      await probeMacOsSandboxAvailability();
      return true;
    }
    if (sandbox.id === "linux-bubblewrap") {
      await access("/usr/bin/bwrap");
      return true;
    }
    if (sandbox.id === "oci-container") {
      return (await resolveContainerExecutable()) !== undefined;
    }
    if (sandbox.id === "host-direct") return true;
    return false;
  } catch {
    return false;
  }
}

function projectionHashPayload(
  projection: Omit<EffectiveAgentCapabilityProjectionV1, "projectionSha256">,
): unknown {
  return {
    schemaVersion: projection.schemaVersion,
    agentId: projection.agentId,
    agentRevision: projection.agentRevision,
    contractId: projection.contractId,
    contractVersion: projection.contractVersion,
    recommendationSha256: projection.recommendationSha256,
    driftState: projection.driftState,
    ownership: projection.ownership,
    explicitOverrideFields: projection.explicitOverrideFields,
    legacySignatureSha256: projection.legacySignatureSha256 ?? "",
    toolPolicy: projection.toolPolicy,
    configuredTools: projection.configuredTools,
    runtimeExposedTools: projection.runtimeExposedTools,
    configuredSkills: projection.configuredSkills,
    configuredSubagents: projection.configuredSubagents,
    readiness: projection.readiness,
  };
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

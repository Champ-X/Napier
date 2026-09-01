import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentProfile } from "@napier/contracts";
import {
  agentCapabilityPresetUpdate,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type {
  CapabilityDriftState,
  CapabilityReadinessRecord,
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesRequestV1,
  RestoreRecommendedCapabilitiesResultV1,
  UpgradeRecommendedCapabilitiesRequestV1,
  UpgradeRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";

import type { AgentCapabilityRuntime } from "./agent-capability-runtime.js";
import { projectAgentToolReadiness } from "./agent-tool-readiness.js";
import {
  bindingMatchesProfile,
  type CapabilityBindingLookup,
} from "./agent-capability-bindings.js";
import { createCapabilityUpgradeModel } from "./agent-capability-upgrade.js";
import {
  capabilitySha256,
  compareCanonicalText,
  createCapabilityRestorePreview,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
} from "./default-agent-capability-contract.js";
import {
  buildStandardSkillSnapshot,
  defaultBundledSkillRoot,
  type SkillSnapshot,
} from "./standard-skill-snapshot.js";
import {
  ProcessRunReadinessError,
  inspectProcessSandboxReadiness,
  sharedProcessRunReadinessGate,
} from "./process-run-readiness.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import { projectEnvironmentToolSurface } from "./environment-capability-projection.js";

export class AgentCapabilityService {
  constructor(
    private readonly store: LocalStore,
    private readonly sandbox: OsSandboxAdapter,
    private readonly capabilityRuntime: AgentCapabilityRuntime,
  ) {}

  async project(
    agentId: string,
    presetId?: AgentCapabilityPresetId,
  ): Promise<EffectiveAgentCapabilityProjectionV1> {
    const profile = this.store.getAgent(agentId);
    const bindingLookup = this.store.getAgentCapabilityBinding(
      agentId,
      profile.revision,
    );
    return this.projectSnapshot(
      profile,
      bindingLookup,
      presetId
        ? {
            ...profile,
            ...agentCapabilityPresetUpdate(presetId),
          }
        : profile,
      presetId,
    );
  }

  async assertRunReadiness(
    agentId: string,
    presetId?: AgentCapabilityPresetId,
    signal?: AbortSignal,
  ): Promise<void> {
    const profile = this.store.getAgent(agentId);
    await sharedProcessRunReadinessGate(
      this.sandbox,
      this.store.workspaceRoot,
    ).assertProfile(
      presetId
        ? { ...profile, ...agentCapabilityPresetUpdate(presetId) }
        : profile,
      signal,
    );
  }

  async blockedRunReadinessProjection(
    agentId: string,
    presetId?: AgentCapabilityPresetId,
  ): Promise<EffectiveAgentCapabilityProjectionV1 | undefined> {
    try {
      await this.assertRunReadiness(agentId, presetId);
      return undefined;
    } catch (error) {
      if (!(error instanceof ProcessRunReadinessError)) throw error;
      return this.project(agentId, presetId);
    }
  }

  private async projectSnapshot(
    persistedProfile: AgentProfile,
    bindingLookup: CapabilityBindingLookup,
    profile: AgentProfile = persistedProfile,
    presetId?: AgentCapabilityPresetId,
  ): Promise<EffectiveAgentCapabilityProjectionV1> {
    const binding =
      bindingLookup.status === "valid" ? bindingLookup.binding : undefined;
    const restorePreview = createCapabilityRestorePreview(persistedProfile);
    const skillInspection = await inspectSkillReadiness(
      this.store.workspaceRoot,
      profile.enabledSkills,
      profile.enabledTools.includes("skill_load"),
    );
    const constructedTools = this.capabilityRuntime
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
      .map((tool) => tool.name);
    const sandboxReadiness = await sharedProcessRunReadinessGate(
      this.sandbox,
      this.store.workspaceRoot,
    ).record();
    const { environmentDegraded, runtimeExposedTools } =
      projectEnvironmentToolSurface({
        profile,
        constructedTools,
        sandboxReadiness,
      });
    runtimeExposedTools.sort(compareCanonicalText);
    const readiness = [
      ...projectAgentToolReadiness(
        profile.enabledTools,
        runtimeExposedTools,
        environmentDegraded,
      ),
      ...derivedSkillToolReadiness(profile.enabledTools, runtimeExposedTools),
      ...skillInspection.readiness,
      sandboxReadiness,
    ].sort((left, right) => compareCanonicalText(left.id, right.id));
    const driftState = capabilityDriftState(bindingLookup, persistedProfile);
    const upgradePreview = binding
      ? createCapabilityUpgradeModel(persistedProfile, binding)?.preview
      : undefined;
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
      ...(presetId ? { capabilityPreset: presetId } : {}),
      readiness,
      ...(upgradePreview ? { upgradePreview } : {}),
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

  async upgrade(
    agentId: string,
    request: UpgradeRecommendedCapabilitiesRequestV1,
  ): Promise<UpgradeRecommendedCapabilitiesResultV1> {
    const commit = await this.store.restoreRecommendedAgentCapabilities(
      agentId,
      request,
      "upgrade",
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
}

function derivedSkillToolReadiness(
  configuredTools: readonly string[],
  runtimeExposedTools: readonly string[],
): CapabilityReadinessRecord[] {
  if (!configuredTools.includes("skill_load")) return [];
  const exposed = runtimeExposedTools.includes("skill_resource");
  return [
    {
      id: "tool:skill_resource",
      status: exposed ? ("ready" as const) : ("unavailable" as const),
      configured: false,
      allowedByPolicy: true,
      exposed,
      detail: exposed
        ? "Derived read-only resource loader is exposed with skill_load; no Profile mutation is required"
        : "Derived Skill resource loader is unavailable because no safe Skill snapshot is active",
    },
  ];
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

interface SkillReadinessInspection {
  snapshot?: SkillSnapshot;
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
  let snapshot: SkillSnapshot;
  try {
    snapshot = await buildStandardSkillSnapshot(workspaceRoot, skills);
  } catch {
    return {
      readiness: await Promise.all(
        sortedUnique(skills).map(async (name) => ({
          id: `skill:${name}`,
          status: (await standardSkillFileExists(workspaceRoot, name))
            ? ("unavailable" as const)
            : ("missing" as const),
          configured: true,
          allowedByPolicy: true,
          exposed: false,
          detail: (await standardSkillFileExists(workspaceRoot, name))
            ? "Skill snapshot could not be safely constructed"
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
      const missing = failure?.failureCode === "skill_not_found";
      const origin =
        request?.state === "loadable" &&
        "source" in request &&
        "rootKind" in request
          ? ` from ${request.source} root ${request.rootKind}`
          : "";
      const candidates =
        failure &&
        "candidateRootKinds" in failure &&
        failure.candidateRootKinds.length > 0
          ? `; candidates: ${failure.candidateRootKinds.join(", ")}`
          : "";
      return {
        id: `skill:${name}`,
        status: ready
          ? ("ready" as const)
          : missing
            ? ("missing" as const)
            : ("unavailable" as const),
        configured: true,
        allowedByPolicy: true,
        exposed: ready,
        detail: ready
          ? `Skill is snapshot-bound${origin} and loadable through the production Runtime`
          : missing
            ? "Configured Skill content is missing"
            : `Skill is unavailable${failure ? ` (${failure.failureCode}${candidates})` : ""}`,
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

async function standardSkillFileExists(
  workspaceRoot: string,
  name: string,
): Promise<boolean> {
  const locations = [
    path.join(workspaceRoot, "skills", name, "SKILL.md"),
    path.join(workspaceRoot, ".agents", "skills", name, "SKILL.md"),
    path.join(homedir(), ".agents", "skills", name, "SKILL.md"),
    path.join(defaultBundledSkillRoot(), "skills", name, "SKILL.md"),
  ];
  const results = await Promise.all(
    locations.map((location) =>
      access(location).then(
        () => true,
        () => false,
      ),
    ),
  );
  return results.some(Boolean);
}

export { inspectProcessSandboxReadiness as inspectSandboxReadiness };

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
    ...(projection.capabilityPreset
      ? { capabilityPreset: projection.capabilityPreset }
      : {}),
    readiness: projection.readiness,
    ...(projection.upgradePreview
      ? { upgradePreview: projection.upgradePreview }
      : {}),
  };
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

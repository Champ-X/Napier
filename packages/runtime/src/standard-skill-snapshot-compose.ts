import {
  formatSkillInvocation,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type {
  StandardSkillLoadFailureV2,
  StandardSkillManifestEntryV2,
  StandardSkillRequestRecord,
  StandardSkillRootKind,
} from "@napier/contracts/skill-load-standard";
import {
  isStandardSkillCatalogBindingV2,
  isStandardSkillLoadFailureV2,
  isStandardSkillSnapshotManifestV2,
} from "@napier/contracts/skill-load-standard";
import {
  skillResourceRelativePath,
  skillResourceVirtualPath,
} from "@napier/contracts/skill-resource";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  StandardSkillCandidate,
  StandardSkillResolution,
  StandardSkillRootScan,
  StandardSkillSnapshot,
  StandardSkillSnapshotEntry,
} from "./standard-skill-snapshot-types.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const TRUST_POLICY = {
  roots: ["project_legacy", "project_standard", "user_standard"],
  conflicts: "fail_closed_no_implicit_precedence",
  userRoot: "local_os_user_home_agents_skills",
  rootScanner: "project_skill_snapshot_v1",
  resources: "on_demand_text_only_nofollow_64k",
  shell: "denied",
  writes: "denied",
  maxConfiguredRequests: 64,
  maxAggregateBytes: MAX_TOTAL_BYTES,
} as const;

export function composeStandardSkillSnapshot(
  workspaceRoot: string,
  configuredNames: readonly string[],
  scans: readonly StandardSkillRootScan[],
  candidateByName: ReadonlyMap<string, StandardSkillCandidate[]>,
  signal?: AbortSignal,
): StandardSkillSnapshot {
  check(signal);
  const counts = countNames(configuredNames);
  const resolutions = new Map<number, StandardSkillResolution>();
  let aggregateRawBytes = 0;
  for (const [position, raw] of configuredNames.entries()) {
    if (!validName(raw)) {
      resolutions.set(
        position,
        unavailable("skill_invalid", [], "invalid_name"),
      );
      continue;
    }
    const candidates = candidateByName.get(raw) ?? [];
    if ((counts.get(raw) ?? 0) > 1) {
      resolutions.set(
        position,
        unavailable(
          "skill_ambiguous",
          rootKinds(candidates),
          "duplicate_request",
        ),
      );
      continue;
    }
    if (candidates.length === 0) {
      resolutions.set(
        position,
        unavailable("skill_not_found", [], "not_found"),
      );
      continue;
    }
    if (candidates.length > 1) {
      resolutions.set(
        position,
        unavailable("skill_ambiguous", rootKinds(candidates), "root_conflict"),
      );
      continue;
    }
    const candidate = candidates[0]!;
    if (!candidate.entry || !candidate.skill || !candidate.loadResource) {
      resolutions.set(
        position,
        unavailable(
          candidate.failure ?? "skill_invalid",
          [candidate.root.kind],
          "root_candidate_unavailable",
        ),
      );
      continue;
    }
    if (aggregateRawBytes + candidate.entry.sizeBytes > MAX_TOTAL_BYTES) {
      resolutions.set(
        position,
        unavailable(
          "skill_limit_exceeded",
          [candidate.root.kind],
          "aggregate_bytes",
        ),
      );
      continue;
    }
    aggregateRawBytes += candidate.entry.sizeBytes;
    resolutions.set(position, { state: "loadable", candidate });
  }
  return finalizeComposite(workspaceRoot, configuredNames, scans, resolutions);
}

function finalizeComposite(
  workspaceRoot: string,
  configuredNames: readonly string[],
  scans: readonly StandardSkillRootScan[],
  resolutions: ReadonlyMap<number, StandardSkillResolution>,
): StandardSkillSnapshot {
  const converted = [...resolutions.values()]
    .filter(
      (item): item is Extract<StandardSkillResolution, { state: "loadable" }> =>
        item.state === "loadable",
    )
    .map((item) => convertCandidate(item.candidate));
  converted.sort((left, right) =>
    compare(left.entry.canonicalName, right.entry.canonicalName),
  );
  const entries = converted.map((item) => item.entry);
  const skills = converted.map((item) => item.skill);
  const resourceLoaders = new Map(
    converted.map((item) => [item.entry.canonicalName, item.loadResource]),
  );
  const observedRootKinds = scans.map((scan) => scan.root.kind).sort(compare);
  const rootIdentities = scans.map((scan) => ({
    rootKind: scan.root.kind,
    workspaceIdentitySha256: scan.snapshot.content.workspaceIdentitySha256,
    directoryIdentitySetSha256:
      scan.snapshot.content.directoryIdentitySetSha256,
    directDirectoryCount: scan.snapshot.content.directDirectoryCount,
  }));
  const rootIdentitySetSha256 = sha256(canonicalJson(rootIdentities));
  const directDirectoryCount = scans.reduce(
    (sum, scan) => sum + scan.snapshot.content.directDirectoryCount,
    0,
  );
  const publicEntries = entries.map(publicEntry);
  const catalogSha256 = sha256(
    canonicalJson({
      observedRootKinds,
      rootIdentitySetSha256,
      directDirectoryCount,
      entries: publicEntries,
    }),
  );
  const failures = createFailures(configuredNames, resolutions, catalogSha256);
  const configuredSkillRequests = createRequests(
    configuredNames,
    resolutions,
    failures,
  );
  const unavailableSkills = [
    ...new Map(
      [...failures.values()].map((item) => [item.contentSha256, item]),
    ).values(),
  ].sort((left, right) => compare(left.contentSha256, right.contentSha256));
  const loadableSkillNames = entries.map((entry) => entry.canonicalName);
  const unavailableFailureContentSha256s = unavailableSkills.map(
    (item) => item.contentSha256,
  );
  const availabilitySetSha256 = sha256(
    canonicalJson({
      configuredSkillRequests,
      loadableSkillNames,
      unavailableFailureContentSha256s,
      catalogSha256,
    }),
  );
  return createCompositeObjects({
    workspaceRoot,
    configuredSkillRequests,
    observedRootKinds,
    rootIdentitySetSha256,
    directDirectoryCount,
    catalogSha256,
    availabilitySetSha256,
    entries,
    skills,
    resourceLoaders,
    unavailableSkills,
    unavailableFailureContentSha256s,
  });
}

function createFailures(
  configuredNames: readonly string[],
  resolutions: ReadonlyMap<number, StandardSkillResolution>,
  catalogSha256: string,
) {
  const failures = new Map<number, StandardSkillLoadFailureV2>();
  for (const [position, resolution] of resolutions) {
    if (resolution.state !== "unavailable") continue;
    const raw = configuredNames[position]!;
    const core = {
      kind: "napier.skill-load-failure" as const,
      schemaVersion: 2 as const,
      operation: "skill.load" as const,
      agentToolName: "skill_load" as const,
      source: "composite" as const,
      subject: "skill_request" as const,
      state: "unavailable" as const,
      failureCode: resolution.code,
      requestedNameSha256: sha256(raw),
      ...(validName(raw) ? { canonicalName: raw } : {}),
      candidateRootKinds: resolution.roots,
      catalogSha256,
      diagnosticSha256: sha256(`standard_snapshot:${resolution.diagnostic}`),
    };
    const failure = { ...core, contentSha256: sha256(canonicalJson(core)) };
    if (!isStandardSkillLoadFailureV2(failure)) {
      throw new Error("Standard Skill failure invariant failed");
    }
    failures.set(position, failure);
  }
  return failures;
}

function createRequests(
  configuredNames: readonly string[],
  resolutions: ReadonlyMap<number, StandardSkillResolution>,
  failures: ReadonlyMap<number, StandardSkillLoadFailureV2>,
): StandardSkillRequestRecord[] {
  return configuredNames.map((raw, position) => {
    const failure = failures.get(position);
    if (failure) {
      return {
        position,
        requestedNameSha256: sha256(raw),
        state: "unavailable" as const,
        failureContentSha256: failure.contentSha256,
        ...(validName(raw) ? { canonicalName: raw } : {}),
      };
    }
    const resolution = resolutions.get(position)! as Extract<
      StandardSkillResolution,
      { state: "loadable" }
    >;
    return {
      position,
      requestedNameSha256: sha256(raw),
      state: "loadable" as const,
      canonicalName: raw,
      source: resolution.candidate.root.source,
      rootKind: resolution.candidate.root.kind,
    };
  });
}

function createCompositeObjects(input: {
  workspaceRoot: string;
  configuredSkillRequests: StandardSkillRequestRecord[];
  observedRootKinds: StandardSkillRootKind[];
  rootIdentitySetSha256: string;
  directDirectoryCount: number;
  catalogSha256: string;
  availabilitySetSha256: string;
  entries: StandardSkillSnapshotEntry[];
  skills: Skill[];
  resourceLoaders: ReadonlyMap<
    string,
    NonNullable<StandardSkillCandidate["loadResource"]>
  >;
  unavailableSkills: StandardSkillLoadFailureV2[];
  unavailableFailureContentSha256s: string[];
}): StandardSkillSnapshot {
  const common = {
    workspaceIdentitySha256: sha256(path.resolve(input.workspaceRoot)),
    trustPolicySha256: sha256(canonicalJson(TRUST_POLICY)),
    configuredSkillRequests: input.configuredSkillRequests,
    selectionSha256: sha256(canonicalJson(input.configuredSkillRequests)),
    observedRootKinds: input.observedRootKinds,
    rootIdentitySetSha256: input.rootIdentitySetSha256,
    directDirectoryCount: input.directDirectoryCount,
    catalogSha256: input.catalogSha256,
    availabilitySetSha256: input.availabilitySetSha256,
    entryCount: input.entries.length,
    aggregateRawBytes: input.entries.reduce(
      (sum, item) => sum + item.sizeBytes,
      0,
    ),
  };
  const privateCore = {
    kind: "napier.standard-skill-snapshot" as const,
    schemaVersion: 2 as const,
    storage: "local_only" as const,
    source: "composite" as const,
    ...common,
    entries: input.entries,
    unavailableSkills: input.unavailableSkills,
  };
  const content = {
    ...privateCore,
    snapshotContentSha256: sha256(canonicalJson(privateCore)),
  };
  const manifestCore = {
    kind: "napier.standard-skill-snapshot-manifest" as const,
    schemaVersion: 2 as const,
    source: "composite" as const,
    trustOrigins: [
      "active_user_selected_project",
      "local_user_skill_store",
    ] as const,
    ...common,
    entries: input.entries.map(publicEntry),
    unavailableFailureContentSha256s: input.unavailableFailureContentSha256s,
    snapshotContentSha256: content.snapshotContentSha256,
  };
  const manifest = {
    ...manifestCore,
    snapshotManifestSha256: sha256(canonicalJson(manifestCore)),
  };
  const bindingCore = {
    kind: "napier.skill-catalog-binding" as const,
    schemaVersion: 2 as const,
    operation: "skill.load" as const,
    agentToolName: "skill_load" as const,
    configuredSkillRequests: input.configuredSkillRequests,
    loadableSkillNames: input.entries.map((entry) => entry.canonicalName),
    unavailableSkills: input.unavailableSkills,
    catalogSha256: input.catalogSha256,
    availabilitySetSha256: input.availabilitySetSha256,
    snapshotManifestSha256: manifest.snapshotManifestSha256,
  };
  const binding = {
    ...bindingCore,
    contentSha256: sha256(canonicalJson(bindingCore)),
  };
  if (
    !isStandardSkillSnapshotManifestV2(manifest) ||
    !isStandardSkillCatalogBindingV2(binding)
  ) {
    throw new Error("Standard Skill snapshot invariant failed");
  }
  const byName = new Map(
    input.entries.map((entry) => [entry.canonicalName, entry]),
  );
  return deepFreeze({
    content,
    manifest,
    binding,
    skills: input.skills,
    entry: (skillName: string) => byName.get(skillName),
    loadResource: (skillName, resourcePath, signal, hooks) => {
      const loader = input.resourceLoaders.get(skillName);
      if (!loader) {
        throw new Error("Skill resource request is not snapshot-bound");
      }
      return loader(resourcePath, signal, hooks);
    },
  });
}

function convertCandidate(candidate: StandardSkillCandidate) {
  const source = candidate.root.source;
  const rootKind = candidate.root.kind;
  const original = candidate.entry!;
  const relativePath =
    rootKind === "project_legacy"
      ? `skills/${original.canonicalName}/SKILL.md`
      : `.agents/skills/${original.canonicalName}/SKILL.md`;
  const virtualPath = `${source === "user" ? "/user" : "/project"}/${relativePath}`;
  const skill = { ...candidate.skill!, filePath: virtualPath };
  const formattedInvocation = formatSkillInvocation(skill);
  const entry: StandardSkillSnapshotEntry = {
    ...original,
    source,
    rootKind,
    relativePath,
    virtualPath,
    invocationSha256: sha256(formattedInvocation),
    formattedInvocation,
  };
  const loadResource: NonNullable<
    StandardSkillCandidate["loadResource"]
  > = async (resourcePath, signal, hooks) => {
    const resource = await candidate.loadResource!(resourcePath, signal, hooks);
    return {
      ...resource,
      relativePath: skillResourceRelativePath(
        rootKind,
        original.canonicalName,
        resourcePath,
      ),
      virtualPath: skillResourceVirtualPath(
        rootKind,
        original.canonicalName,
        resourcePath,
      ),
    };
  };
  return { entry, skill, loadResource };
}

function publicEntry(
  entry: StandardSkillSnapshotEntry,
): StandardSkillManifestEntryV2 {
  const {
    rawContentBase64: _raw,
    metadata: _metadata,
    formattedInvocation: _invocation,
    ...value
  } = entry;
  return value;
}

function unavailable(
  code: StandardSkillLoadFailureV2["failureCode"],
  roots: StandardSkillRootKind[],
  diagnostic: string,
): StandardSkillResolution {
  return { state: "unavailable", code, roots, diagnostic };
}
function rootKinds(
  candidates: readonly StandardSkillCandidate[],
): StandardSkillRootKind[] {
  return [...new Set(candidates.map((item) => item.root.kind))].sort(compare);
}
function countNames(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (validName(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && NAME.test(value);
}
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function check(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation aborted", "AbortError");
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

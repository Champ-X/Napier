import type { SkillSummary } from "@napier/contracts";

import {
  buildStandardSkillSnapshot,
  discoverStandardSkillNames,
  type StandardSkillSnapshotOptions,
} from "./standard-skill-snapshot.js";

export async function inspectStandardSkillCatalog(
  workspaceRoot: string,
  options: Pick<StandardSkillSnapshotOptions, "userHome" | "bundledRoot"> = {},
): Promise<SkillSummary[]> {
  const names = await discoverStandardSkillNames(workspaceRoot, options);
  if (names.length === 0) return [];
  const snapshot = await buildStandardSkillSnapshot(
    workspaceRoot,
    names,
    undefined,
    options,
  );
  const skills = new Map(snapshot.skills.map((skill) => [skill.name, skill]));
  const failures = new Map(
    snapshot.binding.unavailableSkills.map((failure) => [
      failure.contentSha256,
      failure,
    ]),
  );
  const summaries: SkillSummary[] = [];
  for (const request of snapshot.binding
    .configuredSkillRequests as readonly CatalogRequest[]) {
    if (!request.canonicalName) continue;
    if (request.state === "loadable") {
      const skill = skills.get(request.canonicalName);
      if (!skill) throw new Error("Standard Skill catalog entry is incomplete");
      summaries.push({
        name: request.canonicalName,
        description: skill.description,
        source: requestSource(request),
        enabled: true,
      });
      continue;
    }
    const failure = failures.get(request.failureContentSha256!);
    summaries.push({
      name: request.canonicalName,
      description: unavailableDescription(failure),
      source: unavailableSource(failure),
      enabled: false,
    });
  }
  return summaries;
}

type CatalogRequest = {
  canonicalName?: string;
  state: "loadable" | "unavailable";
  failureContentSha256?: string;
  source?: "project" | "user" | "bundled";
};

function requestSource(request: {
  source?: "project" | "user" | "bundled";
}): SkillSummary["source"] {
  return request.source === "user"
    ? "user"
    : request.source === "bundled"
      ? "bundled"
      : "workspace";
}

function unavailableSource(failure: unknown): SkillSummary["source"] {
  const roots = candidateRoots(failure);
  return roots?.length === 1 && roots[0] === "user_standard"
    ? "user"
    : roots?.length === 1 && roots[0] === "bundled_standard"
      ? "bundled"
      : "workspace";
}

function unavailableDescription(failure: unknown): string {
  const value = record(failure);
  const candidates = candidateRoots(failure);
  const roots = candidates?.length
    ? `; candidates: ${candidates.join(", ")}`
    : "";
  const code =
    typeof value?.failureCode === "string"
      ? value.failureCode
      : "skill_invalid";
  return `Unavailable (${code}${roots})`;
}

function candidateRoots(value: unknown): string[] | undefined {
  const roots = record(value)?.candidateRootKinds;
  return Array.isArray(roots) && roots.every((root) => typeof root === "string")
    ? roots
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

import type { SkillSummary } from "@napier/contracts";
import {
  isSkillResourcePath,
  skillResourceVirtualPath,
} from "@napier/contracts/skill-resource";
import {
  STANDARD_SKILL_ROOT_KINDS,
  type StandardSkillRootKind,
} from "@napier/contracts/skill-load-standard";

import {
  buildStandardSkillSnapshot,
  discoverStandardSkillNames,
  type StandardSkillSnapshotOptions,
} from "./standard-skill-snapshot.js";
import type { ProjectSkillResourceContent } from "./project-skill-resource.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type StandardSkillResourceInspectionErrorCode =
  | "invalid_reference"
  | "resource_unavailable"
  | "resource_drift";

export class StandardSkillResourceInspectionError extends Error {
  constructor(
    readonly code: StandardSkillResourceInspectionErrorCode,
    readonly diagnostic: string,
  ) {
    super(`Standard Skill resource inspection failed: ${code}`);
    this.name = "StandardSkillResourceInspectionError";
  }
}

export interface StandardSkillResourceReference {
  skillName: string;
  resourcePath: string;
  rootKind: StandardSkillRootKind;
  rawContentSha256: string;
}

/**
 * Reopen one Skill resource through the same precedence, no-follow and size
 * limits used by the agent tool. The receipt-bound virtual path and content
 * hash must still match, so a later Skill override or file drift cannot make a
 * historical conversation link silently display different bytes.
 */
export async function inspectStandardSkillResource(
  workspaceRoot: string,
  reference: StandardSkillResourceReference,
  options: Pick<StandardSkillSnapshotOptions, "userHome" | "bundledRoot"> = {},
  signal?: AbortSignal,
): Promise<ProjectSkillResourceContent> {
  if (
    !SKILL_NAME.test(reference.skillName) ||
    !isSkillResourcePath(reference.resourcePath) ||
    reference.resourcePath === "SKILL.md" ||
    !STANDARD_SKILL_ROOT_KINDS.includes(reference.rootKind) ||
    !SHA256.test(reference.rawContentSha256)
  ) {
    throw new StandardSkillResourceInspectionError(
      "invalid_reference",
      "receipt_fields",
    );
  }

  let resource: ProjectSkillResourceContent;
  try {
    const snapshot = await buildStandardSkillSnapshot(
      workspaceRoot,
      [reference.skillName],
      signal,
      options,
    );
    resource = await snapshot.loadResource(
      reference.skillName,
      reference.resourcePath,
      signal,
    );
  } catch {
    throw new StandardSkillResourceInspectionError(
      "resource_unavailable",
      "snapshot_or_resource_unavailable",
    );
  }

  const expectedVirtualPath = skillResourceVirtualPath(
    reference.rootKind,
    reference.skillName,
    reference.resourcePath,
  );
  if (
    resource.virtualPath !== expectedVirtualPath ||
    resource.rawContentSha256 !== reference.rawContentSha256
  ) {
    throw new StandardSkillResourceInspectionError(
      "resource_drift",
      resource.virtualPath !== expectedVirtualPath
        ? "source_precedence_changed"
        : "resource_content_changed",
    );
  }
  return resource;
}

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

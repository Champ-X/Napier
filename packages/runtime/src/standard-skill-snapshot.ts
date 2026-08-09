import { constants } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";

import { sha256 } from "./ed25519.js";
import {
  buildProjectSkillSnapshot,
  ProjectSkillSnapshotError,
  type ProjectSkillSnapshotHooks,
} from "./project-skill-snapshot.js";
import { composeStandardSkillSnapshot } from "./standard-skill-snapshot-compose.js";
import type {
  SkillSnapshot,
  StandardSkillCandidate,
  StandardSkillRootDescriptor,
  StandardSkillRootScan,
} from "./standard-skill-snapshot-types.js";

export type {
  SkillSnapshot,
  StandardSkillSnapshot,
  StandardSkillSnapshotEntry,
  StandardSkillSnapshotV2,
} from "./standard-skill-snapshot-types.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_REQUESTS = 64;
const MAX_DISCOVERY_ENTRIES = 4096;
const DIRECT_MISSING_DIAGNOSTIC = sha256("snapshot:direct_directory_missing");

export interface StandardSkillSnapshotOptions {
  userHome?: string;
  hooks?: Partial<Record<StandardSkillRootKind, ProjectSkillSnapshotHooks>>;
}

export class StandardSkillSnapshotError extends Error {
  constructor(
    readonly code:
      | "configured_request_limit"
      | "standard_catalog_untrusted"
      | "standard_catalog_overflow",
    readonly rootKind?: StandardSkillRootKind,
  ) {
    super(`Standard Skill snapshot failed: ${code}`);
    this.name = "StandardSkillSnapshotError";
  }
}

export async function buildStandardSkillSnapshot(
  workspaceRoot: string,
  configuredNames: readonly string[],
  signal?: AbortSignal,
  options: StandardSkillSnapshotOptions = {},
): Promise<SkillSnapshot> {
  check(signal);
  if (configuredNames.length > MAX_REQUESTS) {
    throw new StandardSkillSnapshotError("configured_request_limit");
  }
  const roots = descriptors(workspaceRoot, options.userHome ?? homedir());
  const requested = [...new Set(configuredNames.filter(validName))];
  const scans: StandardSkillRootScan[] = [];
  for (const root of roots) {
    if (!(await rootPresent(root))) continue;
    try {
      scans.push({
        root,
        snapshot: await buildProjectSkillSnapshot(
          root.ownerRoot,
          requested,
          signal,
          options.hooks?.[root.kind],
        ),
      });
    } catch (error) {
      throw standardizeRootError(error, root.kind);
    }
  }
  const candidates = candidateMap(scans, requested);
  const relevantRootKinds = new Set(
    [...candidates.values()].flatMap((items) =>
      items.map((item) => item.root.kind),
    ),
  );
  const legacyRelevant = relevantRootKinds.has("project_legacy");
  const nonLegacyRelevant = [...relevantRootKinds].some(
    (kind) => kind !== "project_legacy",
  );
  const legacyPresent = scans.some(
    (scan) => scan.root.kind === "project_legacy",
  );
  if (
    !nonLegacyRelevant &&
    (legacyRelevant || (configuredNames.length === 0 && legacyPresent))
  ) {
    return buildProjectSkillSnapshot(
      workspaceRoot,
      configuredNames,
      signal,
      options.hooks?.project_legacy,
    );
  }
  return composeStandardSkillSnapshot(
    workspaceRoot,
    configuredNames,
    scans.filter((scan) => relevantRootKinds.has(scan.root.kind)),
    candidates,
    signal,
  );
}

export async function discoverStandardSkillNames(
  workspaceRoot: string,
  options: Pick<StandardSkillSnapshotOptions, "userHome"> = {},
): Promise<string[]> {
  const names = new Set<string>();
  for (const root of descriptors(
    workspaceRoot,
    options.userHome ?? homedir(),
  )) {
    if (!(await rootPresent(root))) continue;
    const directory = await opendir(path.join(root.ownerRoot, "skills"));
    let scanned = 0;
    try {
      for await (const entry of directory) {
        scanned += 1;
        if (scanned > MAX_DISCOVERY_ENTRIES) {
          throw new StandardSkillSnapshotError(
            "standard_catalog_untrusted",
            root.kind,
          );
        }
        if (entry.isDirectory() && validName(entry.name)) names.add(entry.name);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  }
  return [...names].sort(compare);
}

function candidateMap(
  scans: readonly StandardSkillRootScan[],
  names: readonly string[],
) {
  const result = new Map<string, StandardSkillCandidate[]>();
  for (const scan of scans) {
    for (const [position, skillName] of names.entries()) {
      const request = scan.snapshot.binding.configuredSkillRequests[position];
      if (!request) throw new Error("Root Skill request binding is incomplete");
      if (request.state === "loadable") {
        const entry = scan.snapshot.entry(skillName);
        const skill = scan.snapshot.skills.find(
          (item) => item.name === skillName,
        );
        if (!entry || !skill) throw new Error("Root Skill entry is incomplete");
        addCandidate(result, skillName, {
          root: scan.root,
          entry: { ...entry },
          skill,
        });
        continue;
      }
      const failure = scan.snapshot.binding.unavailableSkills.find(
        (item) => item.contentSha256 === request.failureContentSha256,
      );
      if (!failure) throw new Error("Root Skill failure is incomplete");
      if (
        failure.failureCode === "skill_not_found" &&
        failure.diagnosticSha256 === DIRECT_MISSING_DIAGNOSTIC
      ) {
        continue;
      }
      addCandidate(result, skillName, {
        root: scan.root,
        failure: failure.failureCode,
      });
    }
  }
  return result;
}

function descriptors(
  workspaceRoot: string,
  userHome: string,
): StandardSkillRootDescriptor[] {
  return [
    { kind: "project_legacy", source: "project", ownerRoot: workspaceRoot },
    {
      kind: "project_standard",
      source: "project",
      ownerRoot: path.join(workspaceRoot, ".agents"),
    },
    {
      kind: "user_standard",
      source: "user",
      ownerRoot: path.join(userHome, ".agents"),
    },
  ];
}

async function rootPresent(
  root: StandardSkillRootDescriptor,
): Promise<boolean> {
  const [owner, skills] = await Promise.all([
    lstat(root.ownerRoot).catch(() => undefined),
    lstat(path.join(root.ownerRoot, "skills")).catch(() => undefined),
  ]);
  if (!skills && (!owner || (owner.isDirectory() && !owner.isSymbolicLink()))) {
    return false;
  }
  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    !owner?.isDirectory() ||
    owner.isSymbolicLink() ||
    !skills?.isDirectory() ||
    skills.isSymbolicLink()
  ) {
    throw new StandardSkillSnapshotError(
      "standard_catalog_untrusted",
      root.kind,
    );
  }
  return true;
}

function standardizeRootError(error: unknown, rootKind: StandardSkillRootKind) {
  if (error instanceof ProjectSkillSnapshotError) {
    return new StandardSkillSnapshotError(
      error.code === "project_catalog_overflow"
        ? "standard_catalog_overflow"
        : "standard_catalog_untrusted",
      rootKind,
    );
  }
  return error;
}

function addCandidate(
  map: Map<string, StandardSkillCandidate[]>,
  name: string,
  candidate: StandardSkillCandidate,
) {
  map.set(name, [...(map.get(name) ?? []), candidate]);
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

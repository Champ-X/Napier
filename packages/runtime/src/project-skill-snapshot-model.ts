import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import type { Skill } from "@earendil-works/pi-agent-core";
import type {
  ProjectSkillSnapshotManifestV1,
  SkillCatalogBindingV1,
  SkillLoadFailureCode,
  SkillLoadFailureV1,
} from "@napier/contracts/skill-load";

import type {
  ProjectSkillResourceContent,
  ProjectSkillResourceHooks,
} from "./project-skill-resource.js";

export const PROJECT_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface ProjectSkillSnapshotEntry {
  canonicalName: string;
  requestedNameSha256: string;
  relativePath: string;
  virtualPath: string;
  directoryKind: "directory";
  fileKind: "regular_file";
  symlinkFree: true;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: string;
  metadataSha256: string;
  invocationSha256: string;
  rawContentBase64: string;
  metadata: {
    name: string;
    description: string;
    disableModelInvocation: false;
  };
  formattedInvocation: string;
}

export interface ProjectSkillSnapshotV1 {
  kind: "napier.project-skill-snapshot";
  schemaVersion: 1;
  storage: "local_only";
  source: "project";
  trustOrigin: "active_user_selected_project";
  workspaceIdentitySha256: string;
  trustPolicySha256: string;
  configuredSkillRequests: SkillCatalogBindingV1["configuredSkillRequests"];
  selectionSha256: string;
  directDirectoryCount: number;
  directoryIdentitySetSha256: string;
  directoryIdentitySha256s: string[];
  catalogSha256: string;
  availabilitySetSha256: string;
  entryCount: number;
  aggregateRawBytes: number;
  entries: ProjectSkillSnapshotEntry[];
  unavailableSkills: SkillLoadFailureV1[];
  snapshotContentSha256: string;
}

export interface ProjectSkillSnapshot {
  readonly content: Readonly<ProjectSkillSnapshotV1>;
  readonly manifest: Readonly<ProjectSkillSnapshotManifestV1>;
  readonly binding: Readonly<SkillCatalogBindingV1>;
  readonly skills: readonly Skill[];
  entry(name: string): Readonly<ProjectSkillSnapshotEntry> | undefined;
  loadResource(
    name: string,
    resourcePath: string,
    signal?: AbortSignal,
    hooks?: ProjectSkillResourceHooks,
  ): Promise<ProjectSkillResourceContent>;
}

export class ProjectSkillSnapshotError extends Error {
  constructor(
    readonly code:
      | "configured_request_limit"
      | "project_catalog_overflow"
      | "workspace_untrusted",
    readonly failure?: SkillLoadFailureV1,
  ) {
    super(`Project Skill snapshot failed: ${code}`);
    this.name = "ProjectSkillSnapshotError";
  }
}

export interface ProjectSkillSnapshotHooks {
  afterRootOpen?(): void | Promise<void>;
  afterDirectoryEntry?(scanned: number): void | Promise<void>;
  afterSkillDirectoryOpen?(skillName: string): void | Promise<void>;
  afterSkillFileOpen?(skillName: string): void | Promise<void>;
  afterSkillFileRead?(skillName: string): void | Promise<void>;
}

export type ProjectSkillFailureDraft = {
  position: number;
  raw: string;
  code: SkillLoadFailureCode;
  diagnostic: string;
};

export type ProjectSkillAcquiredEntry = {
  entry: ProjectSkillSnapshotEntry;
  skill: Skill;
};

export type ProjectSkillAcquisitionFailure = {
  code: SkillLoadFailureCode;
  diagnostic: string;
};

export type ProjectSkillDirectoryState = {
  count: number;
  identityHashes: string[];
  entries: Map<string, "directory" | "symlink" | "other">;
};

export type ProjectSkillTraversalStrategy = "fd_relative" | "darwin_held_path";

export type ProjectSkillHandleTraversalProbe = {
  fdIdentityMatches: boolean;
  directoryOpened: boolean;
  directoryOpenErrorCode?: string;
  childOpened: boolean;
  childOpenErrorCode?: string;
};

export type ProjectSkillRootAnchor = {
  path: string;
  relativePath: string;
  handle: FileHandle;
  identity: Stats;
  workspacePath: string;
  workspaceHandle: FileHandle;
  workspaceIdentity: Stats;
  traversalStrategy: ProjectSkillTraversalStrategy;
};

export function validProjectSkillName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    PROJECT_SKILL_NAME.test(value)
  );
}

export function compareProjectSkillText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function publicProjectSkillEntry(entry: ProjectSkillSnapshotEntry) {
  const {
    rawContentBase64: _raw,
    metadata: _metadata,
    formattedInvocation: _invocation,
    ...value
  } = entry;
  return value;
}

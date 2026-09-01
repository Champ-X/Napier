import type { SkillLoadFailureCode } from "./skill-load.js";

export const STANDARD_SKILL_ROOT_KINDS = [
  "project_legacy",
  "project_standard",
  "user_standard",
  "bundled_standard",
] as const;
export type StandardSkillRootKind = (typeof STANDARD_SKILL_ROOT_KINDS)[number];
export type StandardSkillSource = "project" | "user" | "bundled";
type Sha = string;

export type StandardSkillRequestRecord =
  | {
      position: number;
      requestedNameSha256: Sha;
      state: "loadable";
      canonicalName: string;
      source: StandardSkillSource;
      rootKind: StandardSkillRootKind;
    }
  | {
      position: number;
      requestedNameSha256: Sha;
      state: "unavailable";
      failureContentSha256: Sha;
      canonicalName?: string;
    };

export interface StandardSkillLoadFailureV2 {
  kind: "napier.skill-load-failure";
  schemaVersion: 2;
  operation: "skill.load";
  agentToolName: "skill_load";
  source: "composite";
  subject: "skill_request";
  state: "failed" | "unavailable";
  failureCode: SkillLoadFailureCode;
  requestedNameSha256: Sha;
  canonicalName?: string;
  candidateRootKinds: StandardSkillRootKind[];
  catalogSha256: Sha;
  snapshotManifestSha256?: Sha;
  diagnosticSha256: Sha;
  contentSha256: Sha;
}

export interface StandardSkillCatalogBindingV2 {
  kind: "napier.skill-catalog-binding";
  schemaVersion: 2;
  operation: "skill.load";
  agentToolName: "skill_load";
  configuredSkillRequests: StandardSkillRequestRecord[];
  loadableSkillNames: string[];
  unavailableSkills: StandardSkillLoadFailureV2[];
  catalogSha256: Sha;
  availabilitySetSha256: Sha;
  snapshotManifestSha256: Sha;
  contentSha256: Sha;
}

export interface StandardSkillLoadSelectionV2 {
  kind: "napier.skill-load-selection";
  schemaVersion: 2;
  operation: "skill.load";
  agentToolName: "skill_load";
  state: "selected";
  name: string;
  requestedNameSha256: Sha;
  source: StandardSkillSource;
  rootKind: StandardSkillRootKind;
  catalogSha256: Sha;
  availabilitySetSha256: Sha;
  snapshotManifestSha256: Sha;
  inputSha256: Sha;
  contentSha256: Sha;
}

export interface StandardSkillLoadReceiptV2 {
  kind: "napier.skill-load-receipt";
  schemaVersion: 2;
  operation: "skill.load";
  agentToolName: "skill_load";
  state: "loaded";
  name: string;
  requestedNameSha256: Sha;
  source: StandardSkillSource;
  rootKind: StandardSkillRootKind;
  relativePath: string;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: Sha;
  invocationSha256: Sha;
  catalogSha256: Sha;
  snapshotManifestSha256: Sha;
  contentSha256: Sha;
}

export interface StandardSkillManifestEntryV2 {
  canonicalName: string;
  requestedNameSha256: Sha;
  source: StandardSkillSource;
  rootKind: StandardSkillRootKind;
  relativePath: string;
  virtualPath: string;
  directoryKind: "directory";
  fileKind: "regular_file";
  symlinkFree: true;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: Sha;
  metadataSha256: Sha;
  invocationSha256: Sha;
}

export interface StandardSkillSnapshotManifestV2 {
  kind: "napier.standard-skill-snapshot-manifest";
  schemaVersion: 2;
  source: "composite";
  trustOrigins:
    | ["active_user_selected_project", "local_user_skill_store"]
    | [
        "active_user_selected_project",
        "local_user_skill_store",
        "napier_read_only_bundle",
      ];
  workspaceIdentitySha256: Sha;
  trustPolicySha256: Sha;
  configuredSkillRequests: StandardSkillRequestRecord[];
  selectionSha256: Sha;
  observedRootKinds: StandardSkillRootKind[];
  rootIdentitySetSha256: Sha;
  directDirectoryCount: number;
  catalogSha256: Sha;
  availabilitySetSha256: Sha;
  entryCount: number;
  aggregateRawBytes: number;
  entries: StandardSkillManifestEntryV2[];
  unavailableFailureContentSha256s: Sha[];
  snapshotContentSha256: Sha;
  snapshotManifestSha256: Sha;
}

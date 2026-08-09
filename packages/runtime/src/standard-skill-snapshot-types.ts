import type { Skill } from "@earendil-works/pi-agent-core";
import type {
  StandardSkillCatalogBindingV2,
  StandardSkillLoadFailureV2,
  StandardSkillManifestEntryV2,
  StandardSkillRequestRecord,
  StandardSkillRootKind,
  StandardSkillSnapshotManifestV2,
  StandardSkillSource,
} from "@napier/contracts/skill-load-standard";

import type {
  ProjectSkillSnapshot,
  ProjectSkillSnapshotEntry,
} from "./project-skill-snapshot.js";

export interface StandardSkillSnapshotEntry extends StandardSkillManifestEntryV2 {
  rawContentBase64: string;
  metadata: {
    name: string;
    description: string;
    disableModelInvocation: false;
  };
  formattedInvocation: string;
}

export interface StandardSkillSnapshotV2 {
  kind: "napier.standard-skill-snapshot";
  schemaVersion: 2;
  storage: "local_only";
  source: "composite";
  workspaceIdentitySha256: string;
  trustPolicySha256: string;
  configuredSkillRequests: StandardSkillRequestRecord[];
  selectionSha256: string;
  observedRootKinds: StandardSkillRootKind[];
  rootIdentitySetSha256: string;
  directDirectoryCount: number;
  catalogSha256: string;
  availabilitySetSha256: string;
  entryCount: number;
  aggregateRawBytes: number;
  entries: StandardSkillSnapshotEntry[];
  unavailableSkills: StandardSkillLoadFailureV2[];
  snapshotContentSha256: string;
}

export interface StandardSkillSnapshot {
  readonly content: Readonly<StandardSkillSnapshotV2>;
  readonly manifest: Readonly<StandardSkillSnapshotManifestV2>;
  readonly binding: Readonly<StandardSkillCatalogBindingV2>;
  readonly skills: readonly Skill[];
  entry(name: string): Readonly<StandardSkillSnapshotEntry> | undefined;
}

export type SkillSnapshot = ProjectSkillSnapshot | StandardSkillSnapshot;

export type StandardSkillRootDescriptor = {
  kind: StandardSkillRootKind;
  source: StandardSkillSource;
  ownerRoot: string;
};

export type StandardSkillRootScan = {
  root: StandardSkillRootDescriptor;
  snapshot: ProjectSkillSnapshot;
};

export type StandardSkillCandidate = {
  root: StandardSkillRootDescriptor;
  entry?: ProjectSkillSnapshotEntry;
  skill?: Skill;
  failure?: StandardSkillLoadFailureV2["failureCode"];
};

export type StandardSkillResolution =
  | { state: "loadable"; candidate: StandardSkillCandidate }
  | {
      state: "unavailable";
      code: StandardSkillLoadFailureV2["failureCode"];
      roots: StandardSkillRootKind[];
      diagnostic: string;
    };

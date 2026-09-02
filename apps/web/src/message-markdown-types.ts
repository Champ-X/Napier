import type { ArtifactManifestEntry } from "@napier/contracts";
import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";

export interface MessageWorkspaceLink {
  artifact?: ArtifactManifestEntry;
  path: string;
  planId?: string;
  threadId?: string;
  targetId: string;
}

export interface MessageCitationLink {
  citationId: string;
  targetId: string;
  index: number;
}

export interface MessageSkillResourceLink {
  skillName: string;
  resourcePath: string;
  relativePath: string;
  virtualPath: string;
  rootKind: StandardSkillRootKind;
  rawContentSha256: string;
}

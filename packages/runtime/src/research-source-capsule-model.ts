export interface ResearchSourceCapsuleReceipt {
  kind: "napier.research-source-capsule-receipt";
  schemaVersion: 1;
  sourceRunId: string;
  sourceCount: number;
  citationCount: number;
  sourceSetSha256: string;
  capsuleSha256: string;
  capsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}

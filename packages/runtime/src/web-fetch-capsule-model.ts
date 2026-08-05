export interface WebFetchStateCapsuleReceipt {
  kind: "napier.web-fetch-state-capsule-receipt";
  schemaVersion: 1;
  sourceRunId: string;
  sourceCount: number;
  sourceSetSha256: string;
  manifestCapsuleSha256: string;
  manifestCapsuleBytes: number;
  storage: "local_only";
  contentSha256: string;
}

export type HarnessCorpusPartition = "tuning" | "regression" | "holdout";
export interface HarnessCorpusEvidence {
  id: string;
  kind: "source" | "campaign" | "retained_failure" | "holdout_provenance";
  path: string;
  fileSha256: string;
  jsonPointer: string;
  recordSha256?: string;
  runId?: string;
  taskSha256?: string;
  caseId?: string;
  familyId?: string;
  fixtureSha256?: string;
  promptSha256?: string;
  memorySeedSha256?: string | null;
  outcomeSha256?: string;
  reportSha256?: string;
  sourceIdentitySha256?: string;
  hashEncoding?: "raw_bytes" | "parsed_json";
  /** Exact bounded declaration bytes retained for standalone qualification. */
  artifactUtf8?: string;
}
export interface HarnessCorpusFamily {
  id: string;
  aliases: string[];
  exposure: "development_visible" | "observed_campaign" | "sealed_holdout";
  evidenceIds: string[];
  holdoutProvenance?: {
    custodian: string;
    source: string;
    sealedAt: string;
    exclusionScope: string;
    taskSetSha256: string;
    artifactSha256: string;
    evidenceId: string;
  };
}
export interface HarnessCorpusTask {
  taskSha256: string;
  familyId: string;
  fixtureSha256: string;
  promptSha256: string;
  memorySeedSha256: string | null;
  aliases: Array<{ caseId: string; path: string; inputSha256: string; outcomeSha256: string; manifestSha256: string }>;
}
export interface HarnessCorpusCatalog {
  kind: "napier.harness-corpus-catalog";
  schemaVersion: 1;
  id: string;
  revision: number;
  previousCatalogSha256: string | null;
  tasks: HarnessCorpusTask[];
  families: HarnessCorpusFamily[];
  suites: Array<{ id: string; path: string; fileSha256: string; cases: Array<{
    caseId: string; path: string; taskSha256: string; familyId: string; partition: HarnessCorpusPartition;
  }> }>;
  evidence: HarnessCorpusEvidence[];
  contentSha256: string;
}
export interface HarnessCorpusSelection {
  caseId: string;
  inputSha256: string;
  taskSha256: string;
  familyId: string;
  partition: HarnessCorpusPartition;
}
/** Frozen provenance facts, not proof that an external custodian's declaration is true. */
export interface HarnessCorpusBinding {
  kind: "napier.harness-corpus-binding";
  schemaVersion: 1;
  registeredAt: string;
  baselineCatalogRevision: number;
  baselineCatalogSha256: string;
  catalog: HarnessCorpusCatalog;
  selection: HarnessCorpusSelection[];
  contentSha256: string;
}

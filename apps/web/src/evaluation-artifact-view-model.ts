import type {
  EvaluationCasebookArtifact,
  EvaluationCasebookQualificationReceipt,
  EvaluationSuiteGateReceipt,
} from "@napier/contracts";

export function evaluationSuiteGateReceiptFilename(
  receipt: Pick<EvaluationSuiteGateReceipt, "contentSha256"> & {
    suite: Pick<EvaluationSuiteGateReceipt["suite"], "id" | "revision">;
  },
): string {
  const safeSuiteId = safeFilenameSegment(receipt.suite.id, "suite");
  return `napier-gate-${safeSuiteId}-r${receipt.suite.revision}-${receipt.contentSha256.slice(0, 12)}.json`;
}

export function evaluationCasebookArtifactFilename(
  artifact: Pick<EvaluationCasebookArtifact, "contentSha256"> & {
    casebook: Pick<
      EvaluationCasebookArtifact["casebook"],
      "id" | "currentRevision"
    >;
  },
): string {
  const safeCasebookId = safeFilenameSegment(artifact.casebook.id, "casebook");
  return `napier-casebook-${safeCasebookId}-r${artifact.casebook.currentRevision}-${artifact.contentSha256.slice(0, 12)}.json`;
}

export function evaluationCasebookQualificationReceiptFilename(
  receipt: Pick<EvaluationCasebookQualificationReceipt, "contentSha256"> & {
    casebook: Pick<
      EvaluationCasebookQualificationReceipt["casebook"],
      "id" | "currentRevision"
    >;
  },
): string {
  const safeCasebookId = safeFilenameSegment(receipt.casebook.id, "casebook");
  return `napier-casebook-qualification-${safeCasebookId}-r${receipt.casebook.currentRevision}-${receipt.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}

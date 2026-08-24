import { safeFilenameSegment, setBodyContentSha256Header, setStableContentSha256Header } from "./http-response-evidence.js";
import type { EvaluationCasebook, EvaluationCasebookArtifact, EvaluationCasebookCalibrationReport, EvaluationCasebookQualificationExecution, EvaluationCasebookQualificationReceipt, EvaluationQualificationBaseline, PromoteEvaluationQualificationBaselineResult } from "@napier/contracts";
import type { Context } from "hono";

export function setEvaluationCasebookListHeaders(context: Context, casebooks: readonly EvaluationCasebook[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, casebooks);
  context.header("X-Napier-Casebook-Count", String(casebooks.length));
  context.header("X-Napier-Casebook-Revision-Count", String(casebooks.reduce((total, casebook) => total + casebook.revisions.length, 0)));
  context.header("X-Napier-Case-Count", String(casebooks.reduce((total, casebook) => total + casebook.cases.length, 0)));
}

export function setEvaluationCasebookCalibrationHeaders(context: Context, report: EvaluationCasebookCalibrationReport): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Casebook-Id", report.casebookId);
  context.header("X-Napier-Casebook-Revision", String(report.casebookRevision));
  context.header("X-Napier-Calibration-Sample-Count", String(report.sampleCount));
  context.header("X-Napier-Calibration-Agreement-Count", String(report.agreementCount));
  context.header("X-Napier-Calibration-Agreement-Rate", String(report.agreementRate));
  context.header("X-Napier-Calibration-Group-Count", String(report.groups.length));
}

export function setEvaluationCasebookArtifactHeaders(context: Context, artifact: EvaluationCasebookArtifact): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${evaluationCasebookArtifactFilename(artifact)}"`);
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Casebook-Id", artifact.casebook.id);
  context.header("X-Napier-Casebook-Revision", String(artifact.casebook.currentRevision));
  context.header("X-Napier-Case-Count", String(artifact.casebook.cases.length));
  context.header("X-Napier-Casebook-Revision-Count", String(artifact.casebook.revisions.length));
  context.header("X-Napier-Calibration-Sample-Count", String(artifact.calibration.sampleCount));
  context.header("X-Napier-Calibration-Agreement-Rate", String(artifact.calibration.agreementRate));
}

export function evaluationCasebookArtifactFilename(artifact: EvaluationCasebookArtifact): string {
  const safeCasebookId = safeFilenameSegment(artifact.casebook.id, "casebook");
  return `napier-casebook-${safeCasebookId}-r${artifact.casebook.currentRevision}-${artifact.contentSha256.slice(0, 12)}.json`;
}

export function setEvaluationCasebookQualificationListHeaders(context: Context, casebookId: string, qualifications: readonly EvaluationCasebookQualificationExecution[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualifications);
  context.header("X-Napier-Casebook-Id", casebookId);
  context.header("X-Napier-Qualification-Execution-Count", String(qualifications.length));
  context.header("X-Napier-Qualification-Sample-Count", String(qualifications.reduce((total, qualification) => total + qualification.sampleCount, 0)));
  context.header("X-Napier-Qualification-Agreement-Count", String(qualifications.reduce((total, qualification) => total + qualification.agreementCount, 0)));
  context.header("X-Napier-Qualification-Inconclusive-Count", String(qualifications.reduce((total, qualification) => total + qualification.inconclusiveCount, 0)));
  context.header("X-Napier-Qualification-Unverified-Count", String(qualifications.reduce((total, qualification) => total + qualification.unverifiedCount, 0)));
}

export function setEvaluationCasebookQualificationReceiptHeaders(context: Context, receipt: EvaluationCasebookQualificationReceipt): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${evaluationCasebookQualificationReceiptFilename(receipt)}"`);
  setStableContentSha256Header(context, receipt.contentSha256);
  context.header("X-Napier-Casebook-Id", receipt.casebook.id);
  context.header("X-Napier-Casebook-Revision", String(receipt.casebook.currentRevision));
  context.header("X-Napier-Qualification-State", receipt.state);
  context.header("X-Napier-Case-Count", String(receipt.casebook.cases.length));
  context.header("X-Napier-Casebook-Revision-Count", String(receipt.casebook.revisions.length));
  if (receipt.execution) {
    context.header("X-Napier-Qualification-Execution-Id", receipt.execution.id);
    context.header("X-Napier-Qualification-Execution-Status", receipt.execution.status);
    context.header("X-Napier-Qualification-Execution-SHA256", receipt.execution.contentSha256);
    context.header("X-Napier-Audit-Thread-Id", receipt.execution.auditThreadId);
    context.header("X-Napier-Qualification-Sample-Count", String(receipt.execution.sampleCount));
    context.header("X-Napier-Qualification-Agreement-Count", String(receipt.execution.agreementCount));
    context.header("X-Napier-Qualification-Inconclusive-Count", String(receipt.execution.inconclusiveCount));
    context.header("X-Napier-Qualification-Unverified-Count", String(receipt.execution.unverifiedCount));
  }
}

export function evaluationCasebookQualificationReceiptFilename(receipt: EvaluationCasebookQualificationReceipt): string {
  const safeCasebookId = safeFilenameSegment(receipt.casebook.id, "casebook");
  return `napier-casebook-qualification-${safeCasebookId}-r${receipt.casebook.currentRevision}-${receipt.contentSha256.slice(0, 12)}.json`;
}

export function setEvaluationQualificationBaselineListHeaders(context: Context, casebookId: string, baselines: readonly EvaluationQualificationBaseline[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header("X-Napier-Casebook-Id", casebookId);
  context.header("X-Napier-Qualification-Baseline-Count", String(baselines.length));
  const current = baselines.at(-1);
  if (current) {
    context.header("X-Napier-Qualification-Baseline-Id", current.id);
    context.header("X-Napier-Qualification-Baseline-SHA256", current.contentSha256);
    context.header("X-Napier-Qualification-Execution-Id", current.qualificationExecutionId);
    context.header("X-Napier-Qualification-Execution-SHA256", current.qualificationExecutionSha256);
  }
}

export function setPromoteEvaluationQualificationBaselineResultHeaders(context: Context, result: PromoteEvaluationQualificationBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Casebook-Id", result.baseline.casebookId);
  context.header("X-Napier-Casebook-Revision", String(result.baseline.casebookRevision));
  context.header("X-Napier-Qualification-Baseline-Created", String(result.created));
  context.header("X-Napier-Qualification-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Qualification-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Qualification-Execution-Id", result.baseline.qualificationExecutionId);
  context.header("X-Napier-Qualification-Execution-SHA256", result.baseline.qualificationExecutionSha256);
  context.header("X-Napier-Receipt-SHA256", result.baseline.envelope.receipt.contentSha256);
  context.header("X-Napier-Receipt-Artifact-SHA256", result.baseline.envelope.signature.receiptArtifactSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
}

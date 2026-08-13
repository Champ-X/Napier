import type {
  CreateEvaluationCasebookRequest,
  CurateEvaluationCaseRequest,
  EvaluationCasebook,
  EvaluationCasebookArtifact,
  EvaluationCasebookCalibrationReport,
  EvaluationCasebookQualificationExecution,
  EvaluationCasebookQualificationReceipt,
  ExecuteEvaluationCasebookRequest,
  RemoveEvaluationCaseRequest,
  UpdateEvaluationCasebookRequest,
} from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import { requestJson as requestCasebookJson } from "./api-client";

export function listEvaluationCasebooks(): Promise<EvaluationCasebook[]> {
  return requestCasebookJson("/api/evaluation-casebooks");
}

export function listEvaluationCasebookTemplates(): Promise<EvaluationCasebookTemplate[]> {
  return requestCasebookJson("/api/evaluation-casebook-templates");
}

export function createEvaluationCasebook(body: CreateEvaluationCasebookRequest): Promise<EvaluationCasebook> {
  return requestCasebookJson("/api/evaluation-casebooks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateEvaluationCasebook(casebookId: string, body: UpdateEvaluationCasebookRequest): Promise<EvaluationCasebook> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function curateEvaluationCase(casebookId: string, body: CurateEvaluationCaseRequest): Promise<EvaluationCasebook> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/cases`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeEvaluationCase(casebookId: string, caseId: string, body: RemoveEvaluationCaseRequest): Promise<EvaluationCasebook> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/cases/${encodeURIComponent(caseId)}/remove`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getEvaluationCasebookCalibration(casebookId: string): Promise<EvaluationCasebookCalibrationReport> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/calibration`);
}

export function getEvaluationCasebookArtifact(casebookId: string): Promise<EvaluationCasebookArtifact> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/export`);
}

export function listEvaluationCasebookQualifications(casebookId: string): Promise<EvaluationCasebookQualificationExecution[]> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualifications`);
}

export function executeEvaluationCasebookQualification(
  casebookId: string,
  body: ExecuteEvaluationCasebookRequest,
): Promise<EvaluationCasebookQualificationExecution> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualifications`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getEvaluationCasebookQualificationReceipt(casebookId: string): Promise<EvaluationCasebookQualificationReceipt> {
  return requestCasebookJson(`/api/evaluation-casebooks/${encodeURIComponent(casebookId)}/qualification-receipt`);
}

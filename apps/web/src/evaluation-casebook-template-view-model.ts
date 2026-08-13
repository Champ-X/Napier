import type { EvaluationCasebookCase, RunEvaluationRecord } from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

export function evaluationCasebookTemplateCoverageComplete(
  template: EvaluationCasebookTemplate | undefined,
  cases: EvaluationCasebookCase[],
): boolean {
  return !template || template.cases.every((templateCase) => cases.some((item) => item.templateCaseId === templateCase.id));
}

export function findEvaluationCasebookCurationCase(
  cases: EvaluationCasebookCase[],
  templated: boolean,
  templateCaseId: string,
  evaluation: RunEvaluationRecord | undefined,
): EvaluationCasebookCase | undefined {
  if (templated) {
    return cases.find((item) => item.templateCaseId === templateCaseId);
  }
  return evaluation
    ? cases.find((item) => item.sourceThreadId === evaluation.threadId && item.sourceEvaluationId === evaluation.id)
    : undefined;
}

export function evaluationCasebookCurationState(
  item: EvaluationCasebookCase | undefined,
  evaluation: RunEvaluationRecord | undefined,
  truthSha256: string | undefined,
): "new" | "current" | "refresh" {
  if (!item) return "new";
  return item.sourceEvaluationId === evaluation?.id && item.adjudicationRevision.contentSha256 === truthSha256 ? "current" : "refresh";
}

export function evaluationCasebookQualificationDisabled(
  cases: EvaluationCasebookCase[],
  templateCoverageComplete: boolean,
  qualifierModelKey: string,
  busyId: string | undefined,
): boolean {
  return cases.length === 0 || !templateCoverageComplete || !qualifierModelKey || Boolean(busyId);
}

import { useMemo } from "react";

import type {
  EvaluationAdjudication,
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationQualificationBaseline,
  ModelSummary,
  ReceiptTrustAnchor,
  RunEvaluationRecord,
} from "@napier/contracts";
import type { EvaluationCasebookTemplate } from "@napier/contracts/evaluation-casebook-template";

import {
  evaluationCasebookCurationState,
  evaluationCasebookTemplateCoverageComplete,
  findEvaluationCasebookCurationCase,
} from "./evaluation-casebook-template-view-model";
import { configuredModelProviderGroups } from "./model-selection-view-model";

export interface EvaluationCasebookProjectionInput {
  adjudications: EvaluationAdjudication[];
  evaluations: RunEvaluationRecord[];
  casebooks: EvaluationCasebook[];
  selectedId: string;
  templates: EvaluationCasebookTemplate[];
  models: ModelSummary[];
  qualifications: EvaluationCasebookQualificationExecution[];
  qualificationBaselines: EvaluationQualificationBaseline[];
  trustAnchors: ReceiptTrustAnchor[];
  selectedTrustAnchorId: string;
  curationEvaluationId: string;
  templateCaseId: string;
}

export function useEvaluationCasebookProjection({
  adjudications,
  evaluations,
  casebooks,
  selectedId,
  templates,
  models,
  qualifications,
  qualificationBaselines,
  trustAnchors,
  selectedTrustAnchorId,
  curationEvaluationId,
  templateCaseId,
}: EvaluationCasebookProjectionInput) {
  const curation = useMemo(
    () =>
      projectCuration({
        adjudications,
        evaluations,
        casebooks,
        selectedId,
        templates,
        curationEvaluationId,
        templateCaseId,
      }),
    [
      adjudications,
      casebooks,
      curationEvaluationId,
      evaluations,
      selectedId,
      templateCaseId,
      templates,
    ],
  );
  const qualification = useMemo(
    () =>
      projectQualification({
        models,
        qualifications,
        qualificationBaselines,
        trustAnchors,
        selectedTrustAnchorId,
        selected: curation.selected,
      }),
    [
      curation.selected,
      models,
      qualificationBaselines,
      qualifications,
      selectedTrustAnchorId,
      trustAnchors,
    ],
  );
  return { ...curation, ...qualification };
}

function projectCuration(
  input: Pick<
    EvaluationCasebookProjectionInput,
    | "adjudications"
    | "evaluations"
    | "casebooks"
    | "selectedId"
    | "templates"
    | "curationEvaluationId"
    | "templateCaseId"
  >,
) {
  const adjudicationByEvaluation = new Map(
    input.adjudications.map((item) => [item.evaluationId, item]),
  );
  const reviewedEvaluations = input.evaluations
    .filter((evaluation) => adjudicationByEvaluation.has(evaluation.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selected =
    input.casebooks.find((item) => item.id === input.selectedId) ??
    input.casebooks[0];
  const revision = selected?.revisions.at(-1);
  const currentCases =
    selected && revision
      ? revision.caseIds.flatMap((caseId) => {
          const item = selected.cases.find(
            (candidate) => candidate.id === caseId,
          );
          return item ? [item] : [];
        })
      : [];
  const selectedTemplate = input.templates.find(
    (template) => template.id === selected?.templateId,
  );
  const selectedEvaluation = reviewedEvaluations.find(
    (evaluation) => evaluation.id === input.curationEvaluationId,
  );
  const existingCase = findEvaluationCasebookCurationCase(
    currentCases,
    Boolean(selected?.templateId),
    input.templateCaseId,
    selectedEvaluation,
  );
  return {
    adjudicationByEvaluation,
    reviewedEvaluations,
    selected,
    revision,
    currentCases,
    selectedTemplate,
    releaseTemplate: input.templates.find(
      (template) => template.id === "release-product-v1",
    ),
    templateCoverageComplete: evaluationCasebookTemplateCoverageComplete(
      selectedTemplate,
      currentCases,
    ),
    selectedEvaluation,
    existingCase,
    curationState: evaluationCasebookCurationState(
      existingCase,
      selectedEvaluation,
      selectedEvaluation
        ? adjudicationByEvaluation.get(selectedEvaluation.id)?.revisions.at(-1)
            ?.contentSha256
        : undefined,
    ),
  };
}

function projectQualification(
  input: Pick<
    EvaluationCasebookProjectionInput,
    | "models"
    | "qualifications"
    | "qualificationBaselines"
    | "trustAnchors"
    | "selectedTrustAnchorId"
  > & { selected: EvaluationCasebook | undefined },
) {
  const qualificationModelGroups = configuredModelProviderGroups(input.models);
  const qualificationHistory = input.qualifications
    .slice()
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
  const currentQualification = qualificationHistory.find(
    (execution) =>
      execution.casebookRevision === input.selected?.currentRevision,
  );
  const currentBaseline = input.qualificationBaselines.at(-1);
  const baselineAnchor = currentBaseline
    ? input.trustAnchors.find(
        (anchor) => anchor.keyId === currentBaseline.envelope.signature.keyId,
      )
    : undefined;
  const baselineState = !currentBaseline
    ? "missing"
    : baselineAnchor?.status === "revoked"
      ? "revoked"
      : currentBaseline.casebookRevision !== input.selected?.currentRevision
        ? "stale"
        : "current";
  return {
    qualificationModelGroups,
    qualificationModelOptions: qualificationModelGroups.flatMap(
      (group) => group.options,
    ),
    qualificationHistory,
    currentQualification,
    currentBaseline,
    baselineAnchor,
    baselineState,
    baselineUpToDate:
      baselineState === "current" &&
      currentBaseline?.qualificationExecutionId === currentQualification?.id &&
      currentBaseline?.envelope.signature.keyId ===
        input.trustAnchors.find(
          (anchor) => anchor.id === input.selectedTrustAnchorId,
        )?.keyId,
  };
}

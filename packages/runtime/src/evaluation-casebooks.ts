import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type EvaluationAdjudication,
  type EvaluationCasebook,
  type EvaluationCasebookArtifact,
  type EvaluationCasebookCalibrationReport,
  type EvaluationCasebookCase,
  type EvaluationCasebookRevision,
  type EvaluationCalibrationSample,
  type EvaluationConsensusResolution,
  type EvaluationReviewerBallot,
  type RunEvaluationRecord,
} from "@napier/contracts";

import {
  hashEvaluationAdjudicationRevision,
  hashEvaluationRubric,
  summarizeEvaluationCalibrationSamples,
  validateEvaluationAdjudication,
} from "./evaluation-calibration.js";
import { validateEvaluationConsensusResolutionEvidence } from "./evaluation-consensus.js";
import { hashRunEvaluation } from "./evaluation-suites.js";
import { createId, nowIso } from "./ids.js";
import { getEvaluationCasebookTemplate } from "./evaluation-casebook-templates.js";

export const MAX_EVALUATION_CASEBOOK_CASES = 100;
export const MAX_EVALUATION_CASEBOOK_SNAPSHOTS = 200;
export const MAX_EVALUATION_CASEBOOK_REVISIONS = 100;
export const MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES = 10 * 1024 * 1024;

const REVISION_SOURCES = new Set<EvaluationCasebookRevision["source"]>([
  "created",
  "metadata_updated",
  "case_curated",
  "case_refreshed",
  "case_removed",
]);

export function createEvaluationCasebook(input: { name: string; description?: string; templateId?: string }): EvaluationCasebook {
  const timestamp = nowIso();
  const id = createId("casebook");
  if (input.templateId) getEvaluationCasebookTemplate(input.templateId);
  const revision = createRevision(id, {
    revision: 1,
    ...(input.templateId ? { templateId: input.templateId } : {}),
    name: normalizeName(input.name),
    description: normalizeDescription(input.description),
    caseIds: [],
    source: "created",
    createdAt: timestamp,
  });
  return validateEvaluationCasebook({
    id,
    ...(input.templateId ? { templateId: input.templateId } : {}),
    currentRevision: 1,
    cases: [],
    revisions: [revision],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateEvaluationCasebook(current: EvaluationCasebook, input: { name?: string; description?: string }): EvaluationCasebook {
  const validated = validateEvaluationCasebook(current);
  const latest = currentCasebookRevision(validated);
  const name = input.name === undefined ? latest.name : normalizeName(input.name);
  const description = input.description === undefined ? latest.description : normalizeDescription(input.description);
  if (name === latest.name && description === latest.description) {
    return validated;
  }
  return appendRevision(validated, {
    ...(latest.templateId ? { templateId: latest.templateId } : {}),
    name,
    description,
    caseIds: latest.caseIds,
    source: "metadata_updated",
  });
}

export function curateEvaluationCase(
  current: EvaluationCasebook,
  evaluation: RunEvaluationRecord,
  adjudication: EvaluationAdjudication,
  consensusEvidence?: {
    reviewerBallots: EvaluationReviewerBallot[];
    resolution: EvaluationConsensusResolution;
  },
  templateCaseId?: string,
): EvaluationCasebook {
  const validated = validateEvaluationCasebook(current);
  const reviewed = validateEvaluationAdjudication(adjudication, evaluation);
  const latest = currentCasebookRevision(validated);
  const currentCases = currentEvaluationCasebookCases(validated);
  const normalizedTemplateCaseId = normalizeTemplateCaseId(validated, templateCaseId);
  const existing = currentCases.find((candidate) =>
    normalizedTemplateCaseId
      ? candidate.templateCaseId === normalizedTemplateCaseId
      : candidate.sourceThreadId === evaluation.threadId && candidate.sourceEvaluationId === evaluation.id,
  );
  const adjudicationRevision = reviewed.revisions.at(-1)!;
  if (
    existing?.adjudicationRevision.evaluationSha256 === hashRunEvaluation(evaluation) &&
    existing?.adjudicationRevision.contentSha256 === adjudicationRevision.contentSha256 &&
    existing.contentSha256 === hashEvaluationCasebookCase(existing)
  ) {
    return validated;
  }
  if (!existing && currentCases.length >= MAX_EVALUATION_CASEBOOK_CASES) {
    throw new Error(`Evaluation Casebook accepts at most ${MAX_EVALUATION_CASEBOOK_CASES} cases`);
  }
  const reusable = validated.cases.find(
    (candidate) =>
      candidate.templateCaseId === normalizedTemplateCaseId &&
      candidate.sourceThreadId === evaluation.threadId &&
      candidate.sourceEvaluationId === evaluation.id &&
      candidate.adjudicationRevision.evaluationSha256 === hashRunEvaluation(evaluation) &&
      candidate.adjudicationRevision.contentSha256 === adjudicationRevision.contentSha256,
  );
  if (!reusable && validated.cases.length >= MAX_EVALUATION_CASEBOOK_SNAPSHOTS) {
    throw new Error(`Evaluation Casebook accepts at most ${MAX_EVALUATION_CASEBOOK_SNAPSHOTS} case snapshots`);
  }
  const item = reusable ?? createCase(validated.id, evaluation, reviewed, normalizedTemplateCaseId, consensusEvidence);
  const caseIds = currentCases
    .filter((candidate) =>
      normalizedTemplateCaseId
        ? candidate.templateCaseId !== normalizedTemplateCaseId
        : !(candidate.sourceThreadId === evaluation.threadId && candidate.sourceEvaluationId === evaluation.id),
    )
    .map((candidate) => candidate.id);
  caseIds.push(item.id);
  return appendRevision(
    validated,
    {
      ...(latest.templateId ? { templateId: latest.templateId } : {}),
      name: latest.name,
      description: latest.description,
      caseIds: sortCaseIds(caseIds),
      source: existing ? "case_refreshed" : "case_curated",
      caseId: item.id,
      sourceEvaluationId: evaluation.id,
    },
    reusable ? validated.cases : [...validated.cases, item],
  );
}

export function removeEvaluationCase(current: EvaluationCasebook, caseId: string): EvaluationCasebook {
  const validated = validateEvaluationCasebook(current);
  const latest = currentCasebookRevision(validated);
  const item = currentEvaluationCasebookCases(validated).find((candidate) => candidate.id === caseId);
  if (!item) throw new Error(`Evaluation Casebook case not found: ${caseId}`);
  return appendRevision(validated, {
    ...(latest.templateId ? { templateId: latest.templateId } : {}),
    name: latest.name,
    description: latest.description,
    caseIds: latest.caseIds.filter((candidate) => candidate !== caseId),
    source: "case_removed",
    caseId: item.id,
    sourceEvaluationId: item.sourceEvaluationId,
  });
}

export function currentCasebookRevision(casebook: EvaluationCasebook): EvaluationCasebookRevision {
  const revision = casebook.revisions.at(-1);
  if (!revision || revision.revision !== casebook.currentRevision) {
    throw new Error("Evaluation Casebook current revision is invalid");
  }
  return structuredClone(revision);
}

export function currentEvaluationCasebookCases(casebook: EvaluationCasebook): EvaluationCasebookCase[] {
  const revision = currentCasebookRevision(casebook);
  const casesById = new Map(casebook.cases.map((item) => [item.id, item]));
  return revision.caseIds.map((caseId) => {
    const item = casesById.get(caseId);
    if (!item) {
      throw new Error(`Evaluation Casebook case is missing: ${caseId}`);
    }
    return structuredClone(item);
  });
}

export function hashEvaluationCasebookCase(input: EvaluationCasebookCase): string {
  const { contentSha256: _contentSha256, ...content } = input;
  return sha256(canonicalJson(content));
}

export function hashEvaluationCasebookRevision(casebookId: string, input: Omit<EvaluationCasebookRevision, "contentSha256">): string {
  return sha256(canonicalJson({ casebookId, ...input }));
}

export function validateEvaluationCasebook(input: EvaluationCasebook): EvaluationCasebook {
  if (
    !/^casebook_[a-z0-9]{8,80}$/.test(input.id) ||
    !Array.isArray(input.cases) ||
    input.cases.length > MAX_EVALUATION_CASEBOOK_SNAPSHOTS ||
    !Array.isArray(input.revisions) ||
    input.revisions.length < 1 ||
    input.revisions.length > MAX_EVALUATION_CASEBOOK_REVISIONS ||
    input.currentRevision !== input.revisions.length ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    !Number.isFinite(Date.parse(input.updatedAt))
  ) {
    throw new Error("Evaluation Casebook is invalid");
  }
  const template = input.templateId ? getEvaluationCasebookTemplate(input.templateId) : undefined;
  const caseIds = new Set<string>();
  for (const item of input.cases) {
    validateCase(input.id, item);
    if (caseIds.has(item.id)) {
      throw new Error(`Duplicate Evaluation Casebook case: ${item.id}`);
    }
    caseIds.add(item.id);
  }
  if (JSON.stringify(input.cases) !== JSON.stringify(sortCases(input.cases))) {
    throw new Error("Evaluation Casebook case registry is not canonical");
  }
  const referencedCaseIds = new Set<string>();
  let previous: EvaluationCasebookRevision | undefined;
  for (const [index, revision] of input.revisions.entries()) {
    validateRevision(input.id, revision, index + 1, input.cases);
    if (revision.templateId !== input.templateId) {
      throw new Error("Evaluation Casebook template revision is invalid");
    }
    for (const caseId of revision.caseIds) referencedCaseIds.add(caseId);
    if (
      index === 0 &&
      (revision.source !== "created" ||
        revision.caseIds.length !== 0 ||
        revision.caseId !== undefined ||
        revision.sourceEvaluationId !== undefined)
    ) {
      throw new Error("Evaluation Casebook initial revision is invalid");
    }
    if (previous) {
      validateRevisionTransition(previous, revision, input.cases);
    }
    previous = revision;
  }
  validateEvaluationCasebookTemplateRevisions(input, template);
  if (input.cases.some((item) => !referencedCaseIds.has(item.id))) {
    throw new Error("Evaluation Casebook has unreferenced case evidence");
  }
  if (input.createdAt !== input.revisions[0]!.createdAt || input.updatedAt !== input.revisions.at(-1)!.createdAt) {
    throw new Error("Evaluation Casebook timestamps are invalid");
  }
  return structuredClone(input);
}

export function migrateLegacyEvaluationCasebook(input: EvaluationCasebook): EvaluationCasebook {
  if (Array.isArray(input.cases)) {
    return validateEvaluationCasebook(input);
  }
  const legacy = input as unknown as Omit<EvaluationCasebook, "cases" | "revisions"> & {
    cases?: unknown;
    revisions: Array<
      Omit<EvaluationCasebookRevision, "caseIds"> & {
        caseIds?: unknown;
        cases?: EvaluationCasebookCase[];
      }
    >;
  };
  if (!Array.isArray(legacy.revisions) || legacy.revisions.some((revision) => !Array.isArray(revision.cases))) {
    throw new Error("Evaluation Casebook is invalid");
  }
  const casesById = new Map<string, EvaluationCasebookCase>();
  const revisions = legacy.revisions.map((inputRevision) => {
    const { cases, caseIds: _caseIds, contentSha256: _contentSha256, ...revision } = inputRevision;
    for (const item of cases!) {
      const existing = casesById.get(item.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
        throw new Error(`Legacy Evaluation Casebook case conflicts: ${item.id}`);
      }
      casesById.set(item.id, structuredClone(item));
    }
    const content = {
      ...structuredClone(revision),
      caseIds: sortCaseIds(cases!.map((item) => item.id)),
    };
    return {
      ...content,
      contentSha256: hashEvaluationCasebookRevision(legacy.id, content),
    };
  });
  return validateEvaluationCasebook({
    id: legacy.id,
    ...(legacy.templateId ? { templateId: legacy.templateId } : {}),
    currentRevision: legacy.currentRevision,
    cases: sortCases([...casesById.values()]),
    revisions,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
}

export function createEvaluationCasebookCalibrationReport(
  input: EvaluationCasebook,
  generatedAt = new Date(),
): EvaluationCasebookCalibrationReport {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Evaluation Casebook calibration time is invalid");
  }
  const casebook = validateEvaluationCasebook(input);
  const cases = currentEvaluationCasebookCases(casebook);
  const samples: EvaluationCalibrationSample[] = cases.map((item) => {
    const truth = item.adjudicationRevision;
    return {
      evaluationId: item.sourceEvaluationId,
      adjudicationId: item.sourceAdjudicationId,
      adjudicationRevision: truth.revision,
      evaluatorModel: structuredClone(item.evaluation.evaluatorModel),
      rubricName: item.evaluation.rubric.name,
      rubricSha256: item.rubricSha256,
      modelVerdict: item.evaluation.verdict,
      expectedVerdict: truth.expectedVerdict,
      agreement: item.evaluation.verdict === truth.expectedVerdict,
      evaluationSha256: truth.evaluationSha256,
      adjudicationSha256: truth.contentSha256,
    };
  });
  const summary = summarizeEvaluationCalibrationSamples(samples);
  const content = {
    kind: "napier.evaluation-casebook-calibration" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    casebookId: casebook.id,
    casebookRevision: casebook.currentRevision,
    ...summary,
  };
  return {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createEvaluationCasebookArtifact(input: EvaluationCasebook, generatedAt = new Date()): EvaluationCasebookArtifact {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Evaluation Casebook artifact time is invalid");
  }
  const casebook = validateEvaluationCasebook(input);
  const calibration = createEvaluationCasebookCalibrationReport(casebook, generatedAt);
  const content = {
    kind: "napier.evaluation-casebook" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    casebook,
    calibration: withoutGeneratedAt(calibration),
  };
  const artifact: EvaluationCasebookArtifact = {
    kind: content.kind,
    schemaVersion: content.schemaVersion,
    apiVersion: content.apiVersion,
    generatedAt: generatedAt.toISOString(),
    casebook,
    calibration,
    contentSha256: sha256(canonicalJson(content)),
  };
  const bytes = Buffer.byteLength(JSON.stringify(artifact));
  if (bytes > MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES) {
    throw new Error(`Evaluation Casebook artifact exceeds ${MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES} bytes`);
  }
  return artifact;
}

export function validateEvaluationCasebookArtifact(input: EvaluationCasebookArtifact): EvaluationCasebookArtifact {
  const serialized = JSON.stringify(input);
  if (
    Buffer.byteLength(serialized) > MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES ||
    input.kind !== "napier.evaluation-casebook" ||
    input.schemaVersion !== 1 ||
    input.apiVersion !== NAPIER_API_VERSION ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    input.generatedAt !== input.calibration.generatedAt ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256)
  ) {
    throw new Error("Evaluation Casebook artifact is invalid");
  }
  const casebook = validateEvaluationCasebook(input.casebook);
  const expectedCalibration = createEvaluationCasebookCalibrationReport(casebook, new Date(input.calibration.generatedAt));
  if (JSON.stringify(expectedCalibration) !== JSON.stringify(input.calibration)) {
    throw new Error("Evaluation Casebook calibration evidence is invalid");
  }
  const content = {
    kind: input.kind,
    schemaVersion: input.schemaVersion,
    apiVersion: input.apiVersion,
    casebook,
    calibration: withoutGeneratedAt(input.calibration),
  };
  if (sha256(canonicalJson(content)) !== input.contentSha256) {
    throw new Error("Evaluation Casebook artifact hash mismatch");
  }
  return structuredClone(input);
}

function createCase(
  casebookId: string,
  evaluation: RunEvaluationRecord,
  adjudication: EvaluationAdjudication,
  templateCaseId: string | undefined,
  consensusEvidence?: {
    reviewerBallots: EvaluationReviewerBallot[];
    resolution: EvaluationConsensusResolution;
  },
): EvaluationCasebookCase {
  const timestamp = nowIso();
  const adjudicationRevision = adjudication.revisions.at(-1)!;
  if (adjudicationRevision.source === "reviewer_consensus" && !consensusEvidence) {
    throw new Error("Consensus-derived Casebook truth requires reviewer evidence");
  }
  if (adjudicationRevision.source !== "reviewer_consensus" && consensusEvidence) {
    throw new Error("Manual Casebook truth cannot include consensus evidence");
  }
  const reviewerBallots = consensusEvidence?.reviewerBallots.slice().sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  if (consensusEvidence) {
    validateEvaluationConsensusResolutionEvidence(
      consensusEvidence.resolution,
      evaluation,
      reviewerBallots!,
      adjudication.id,
      adjudicationRevision,
    );
  }
  const content = {
    id: createId("evalcase"),
    casebookId,
    ...(templateCaseId ? { templateCaseId } : {}),
    sourceThreadId: evaluation.threadId,
    sourceEvaluationId: evaluation.id,
    sourceAdjudicationId: adjudication.id,
    evaluation: structuredClone(evaluation),
    adjudicationRevision: structuredClone(adjudicationRevision),
    ...(consensusEvidence
      ? {
          reviewerBallots: structuredClone(reviewerBallots!),
          consensusResolution: structuredClone(consensusEvidence.resolution),
        }
      : {}),
    rubricSha256: hashEvaluationRubric(evaluation.rubric),
    createdAt: timestamp,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function normalizeTemplateCaseId(casebook: EvaluationCasebook, templateCaseId: string | undefined): string | undefined {
  if (!casebook.templateId) {
    if (templateCaseId !== undefined) {
      throw new Error("Custom Evaluation Casebook cannot assign a template case");
    }
    return undefined;
  }
  const normalized = templateCaseId?.trim();
  const template = getEvaluationCasebookTemplate(casebook.templateId);
  if (!normalized || !template.cases.some((item) => item.id === normalized)) {
    throw new Error(`Evaluation Casebook template case is invalid: ${templateCaseId ?? "missing"}`);
  }
  return normalized;
}

function validateEvaluationCasebookTemplateRevisions(
  casebook: EvaluationCasebook,
  template: ReturnType<typeof getEvaluationCasebookTemplate> | undefined,
): void {
  for (const revision of casebook.revisions) {
    const active = revision.caseIds.map((caseId) => casebook.cases.find((item) => item.id === caseId)!);
    const templateCaseIds = active.flatMap((item) => (item.templateCaseId ? [item.templateCaseId] : []));
    if (
      (template && active.some((item) => !item.templateCaseId)) ||
      (!template && templateCaseIds.length > 0) ||
      new Set(templateCaseIds).size !== templateCaseIds.length ||
      templateCaseIds.some((caseId) => !template?.cases.some((item) => item.id === caseId))
    ) {
      throw new Error("Evaluation Casebook template coverage is invalid");
    }
  }
}

function createRevision(casebookId: string, input: Omit<EvaluationCasebookRevision, "contentSha256">): EvaluationCasebookRevision {
  return {
    ...structuredClone(input),
    contentSha256: hashEvaluationCasebookRevision(casebookId, input),
  };
}

function appendRevision(
  current: EvaluationCasebook,
  input: Omit<EvaluationCasebookRevision, "revision" | "createdAt" | "contentSha256">,
  cases = current.cases,
): EvaluationCasebook {
  if (current.revisions.length >= MAX_EVALUATION_CASEBOOK_REVISIONS) {
    throw new Error(`Evaluation Casebook accepts at most ${MAX_EVALUATION_CASEBOOK_REVISIONS} revisions`);
  }
  const timestamp = nowIso();
  const revision = createRevision(current.id, {
    revision: current.currentRevision + 1,
    ...structuredClone(input),
    caseIds: sortCaseIds(input.caseIds),
    createdAt: timestamp,
  });
  return validateEvaluationCasebook({
    ...structuredClone(current),
    currentRevision: revision.revision,
    cases: sortCases(cases),
    revisions: [...current.revisions, revision],
    updatedAt: timestamp,
  });
}

function validateRevision(
  casebookId: string,
  revision: EvaluationCasebookRevision,
  expectedRevision: number,
  cases: EvaluationCasebookCase[],
): void {
  if (
    revision.revision !== expectedRevision ||
    revision.name !== normalizeName(revision.name) ||
    revision.description !== normalizeDescription(revision.description) ||
    !Array.isArray(revision.caseIds) ||
    revision.caseIds.length > MAX_EVALUATION_CASEBOOK_CASES ||
    !REVISION_SOURCES.has(revision.source) ||
    !Number.isFinite(Date.parse(revision.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(revision.contentSha256)
  ) {
    throw new Error("Evaluation Casebook revision is invalid");
  }
  const casesById = new Map(cases.map((item) => [item.id, item]));
  const caseIds = new Set<string>();
  const sourceEvaluationKeys = new Set<string>();
  for (const caseId of revision.caseIds) {
    const item = casesById.get(caseId);
    if (!item) {
      throw new Error(`Evaluation Casebook case is missing: ${caseId}`);
    }
    const sourceKey = `${item.sourceThreadId}:${item.sourceEvaluationId}`;
    if (caseIds.has(caseId) || sourceEvaluationKeys.has(sourceKey)) {
      throw new Error("Evaluation Casebook contains duplicate cases");
    }
    caseIds.add(caseId);
    sourceEvaluationKeys.add(sourceKey);
    if (Date.parse(item.createdAt) > Date.parse(revision.createdAt)) {
      throw new Error("Evaluation Casebook case timestamp is invalid");
    }
  }
  if (JSON.stringify(revision.caseIds) !== JSON.stringify(sortCaseIds(revision.caseIds))) {
    throw new Error("Evaluation Casebook case IDs are not canonical");
  }
  const { contentSha256: _contentSha256, ...content } = revision;
  if (hashEvaluationCasebookRevision(casebookId, content) !== revision.contentSha256) {
    throw new Error("Evaluation Casebook revision hash mismatch");
  }
}

function validateCase(casebookId: string, item: EvaluationCasebookCase): void {
  if (
    !/^evalcase_[a-z0-9]{8,80}$/.test(item.id) ||
    item.casebookId !== casebookId ||
    (item.templateCaseId !== undefined && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.templateCaseId)) ||
    item.sourceThreadId !== item.evaluation.threadId ||
    item.sourceEvaluationId !== item.evaluation.id ||
    !/^adjudication_[a-z0-9]{8,80}$/.test(item.sourceAdjudicationId) ||
    !Number.isFinite(Date.parse(item.createdAt)) ||
    item.rubricSha256 !== hashEvaluationRubric(item.evaluation.rubric) ||
    item.adjudicationRevision.evaluationSha256 !== hashRunEvaluation(item.evaluation)
  ) {
    throw new Error("Evaluation Casebook case is invalid");
  }
  const { contentSha256: adjudicationSha256, ...adjudicationContent } = item.adjudicationRevision;
  if (
    hashEvaluationAdjudicationRevision(item.sourceAdjudicationId, item.sourceThreadId, item.sourceEvaluationId, adjudicationContent) !==
    adjudicationSha256
  ) {
    throw new Error("Evaluation Casebook adjudication hash mismatch");
  }
  if (item.adjudicationRevision.source === "reviewer_consensus") {
    if (
      !Array.isArray(item.reviewerBallots) ||
      !item.consensusResolution ||
      JSON.stringify(item.reviewerBallots) !==
        JSON.stringify(item.reviewerBallots.slice().sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)))
    ) {
      throw new Error("Evaluation Casebook consensus evidence is invalid");
    }
    validateEvaluationConsensusResolutionEvidence(
      item.consensusResolution,
      item.evaluation,
      item.reviewerBallots,
      item.sourceAdjudicationId,
      item.adjudicationRevision,
    );
  } else if (item.reviewerBallots || item.consensusResolution) {
    throw new Error("Evaluation Casebook manual truth has consensus evidence");
  }
  if (hashEvaluationCasebookCase(item) !== item.contentSha256) {
    throw new Error("Evaluation Casebook case hash mismatch");
  }
}

function validateRevisionTransition(
  previous: EvaluationCasebookRevision,
  current: EvaluationCasebookRevision,
  cases: EvaluationCasebookCase[],
): void {
  if (Date.parse(current.createdAt) < Date.parse(previous.createdAt) || current.source === "created") {
    throw new Error("Evaluation Casebook revision transition is invalid");
  }
  const casesById = new Map(cases.map((item) => [item.id, item]));
  const previousIds = new Set(previous.caseIds);
  const currentIds = new Set(current.caseIds);
  if (current.source === "metadata_updated") {
    if (
      current.caseId !== undefined ||
      current.sourceEvaluationId !== undefined ||
      JSON.stringify(current.caseIds) !== JSON.stringify(previous.caseIds) ||
      (current.name === previous.name && current.description === previous.description)
    ) {
      throw new Error("Evaluation Casebook metadata revision is invalid");
    }
    return;
  }
  if (!current.caseId || !current.sourceEvaluationId) {
    throw new Error("Evaluation Casebook case revision provenance is missing");
  }
  if (current.source === "case_curated") {
    const added = casesById.get(current.caseId);
    if (
      !added ||
      added.sourceEvaluationId !== current.sourceEvaluationId ||
      current.caseIds.length !== previous.caseIds.length + 1 ||
      !currentIds.has(added.id) ||
      [...previousIds].some((id) => !currentIds.has(id))
    ) {
      throw new Error("Evaluation Casebook curated revision is invalid");
    }
    return;
  }
  if (current.source === "case_refreshed") {
    const added = casesById.get(current.caseId);
    const previousItem = previous.caseIds
      .map((caseId) => casesById.get(caseId)!)
      .find((item) =>
        added?.templateCaseId
          ? item.templateCaseId === added.templateCaseId
          : item.sourceThreadId === added?.sourceThreadId && item.sourceEvaluationId === current.sourceEvaluationId,
      );
    if (
      !added ||
      !previousItem ||
      current.caseIds.length !== previous.caseIds.length ||
      !currentIds.has(added.id) ||
      currentIds.has(previousItem.id) ||
      [...previousIds].filter((id) => id !== previousItem.id).some((id) => !currentIds.has(id))
    ) {
      throw new Error("Evaluation Casebook refreshed revision is invalid");
    }
    return;
  }
  if (current.source === "case_removed") {
    const removed = casesById.get(current.caseId);
    if (
      !removed ||
      !previousIds.has(removed.id) ||
      removed.sourceEvaluationId !== current.sourceEvaluationId ||
      current.caseIds.length !== previous.caseIds.length - 1 ||
      currentIds.has(current.caseId) ||
      [...currentIds].some((id) => !previousIds.has(id))
    ) {
      throw new Error("Evaluation Casebook removed revision is invalid");
    }
  }
}

function sortCases(input: EvaluationCasebookCase[]): EvaluationCasebookCase[] {
  return structuredClone(input).sort((left, right) =>
    `${left.sourceThreadId}/${left.sourceEvaluationId}/${left.id}`.localeCompare(
      `${right.sourceThreadId}/${right.sourceEvaluationId}/${right.id}`,
    ),
  );
}

function sortCaseIds(input: string[]): string[] {
  return [...input].sort((left, right) => left.localeCompare(right));
}

function normalizeName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 100) {
    throw new Error("Evaluation Casebook name is invalid");
  }
  return normalized;
}

function normalizeDescription(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length > 1_000) {
    throw new Error("Evaluation Casebook description exceeds 1000 characters");
  }
  return normalized;
}

function withoutGeneratedAt(report: EvaluationCasebookCalibrationReport): Omit<EvaluationCasebookCalibrationReport, "generatedAt"> {
  const { generatedAt: _generatedAt, ...content } = report;
  return content;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

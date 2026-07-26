import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type EvaluationAdjudication,
  type EvaluationAdjudicationRevision,
  type EvaluationCalibrationGroup,
  type EvaluationCalibrationReport,
  type EvaluationCalibrationSample,
  type EvaluationConfusionMatrix,
  type EvaluationRubricSnapshot,
  type ReviewRunEvaluationRequest,
  type RunEvaluationRecord,
  type RunEvaluationVerdict,
} from "@napier/contracts";

import { hashRunEvaluation } from "./evaluation-suites.js";
import { createId, nowIso } from "./ids.js";

const VERDICTS: readonly RunEvaluationVerdict[] = [
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
];

export function reviewRunEvaluation(
  current: EvaluationAdjudication | undefined,
  evaluation: RunEvaluationRecord,
  request: ReviewRunEvaluationRequest,
): EvaluationAdjudication {
  const expectedVerdict = normalizeVerdict(request.expectedVerdict);
  const note = normalizeNote(request.note);
  const source = normalizeAdjudicationSource(request);
  const evaluationSha256 = hashRunEvaluation(evaluation);
  if (current) {
    validateEvaluationAdjudication(current, evaluation);
    const previous = current.revisions.at(-1)!;
    if (
      previous.expectedVerdict === expectedVerdict &&
      previous.note === note &&
      previous.source === source.source &&
      previous.sourceSha256 === source.sourceSha256
    ) {
      return structuredClone(current);
    }
  }
  const timestamp = nowIso();
  const id = current?.id ?? createId("adjudication");
  const revisionNumber = (current?.currentRevision ?? 0) + 1;
  const content = {
    revision: revisionNumber,
    expectedVerdict,
    note,
    evaluationSha256,
    ...source,
    createdAt: timestamp,
  };
  const revision: EvaluationAdjudicationRevision = {
    ...content,
    contentSha256: hashEvaluationAdjudicationRevision(
      id,
      evaluation.threadId,
      evaluation.id,
      content,
    ),
  };
  const adjudication: EvaluationAdjudication = current
    ? {
        ...structuredClone(current),
        revisions: [...current.revisions, revision],
        currentRevision: revisionNumber,
        updatedAt: timestamp,
      }
    : {
        id,
        threadId: evaluation.threadId,
        evaluationId: evaluation.id,
        revisions: [revision],
        currentRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  return validateEvaluationAdjudication(adjudication, evaluation);
}

export function hashEvaluationAdjudicationRevision(
  adjudicationId: string,
  threadId: string,
  evaluationId: string,
  revision: Omit<EvaluationAdjudicationRevision, "contentSha256">,
): string {
  return sha256(
    canonicalJson({
      adjudicationId,
      threadId,
      evaluationId,
      ...revision,
    }),
  );
}

export function validateEvaluationAdjudication(
  input: EvaluationAdjudication,
  evaluation: RunEvaluationRecord,
): EvaluationAdjudication {
  if (
    !/^adjudication_[a-z0-9]{8,80}$/.test(input.id) ||
    input.threadId !== evaluation.threadId ||
    input.evaluationId !== evaluation.id ||
    !Array.isArray(input.revisions) ||
    input.revisions.length < 1 ||
    input.currentRevision !== input.revisions.length ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    !Number.isFinite(Date.parse(input.updatedAt)) ||
    Date.parse(input.updatedAt) < Date.parse(input.createdAt)
  ) {
    throw new Error("Evaluation adjudication is invalid");
  }
  const evaluationSha256 = hashRunEvaluation(evaluation);
  for (const [index, revision] of input.revisions.entries()) {
    const expectedRevision = index + 1;
    normalizeVerdict(revision.expectedVerdict);
    if (
      revision.revision !== expectedRevision ||
      revision.note !== normalizeNote(revision.note) ||
      revision.evaluationSha256 !== evaluationSha256 ||
      !validAdjudicationSource(revision) ||
      !Number.isFinite(Date.parse(revision.createdAt)) ||
      !/^[a-f0-9]{64}$/.test(revision.contentSha256)
    ) {
      throw new Error("Evaluation adjudication revision is invalid");
    }
    const { contentSha256: _contentSha256, ...content } = revision;
    if (
      hashEvaluationAdjudicationRevision(
        input.id,
        input.threadId,
        input.evaluationId,
        content,
      ) !== revision.contentSha256
    ) {
      throw new Error("Evaluation adjudication revision hash mismatch");
    }
  }
  if (
    input.createdAt !== input.revisions[0]!.createdAt ||
    input.updatedAt !== input.revisions.at(-1)!.createdAt
  ) {
    throw new Error("Evaluation adjudication timestamps are invalid");
  }
  return structuredClone(input);
}

export function createEvaluationCalibrationReport(
  threadId: string,
  evaluations: RunEvaluationRecord[],
  adjudications: EvaluationAdjudication[],
  generatedAt = new Date(),
): EvaluationCalibrationReport {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Evaluation calibration generation time is invalid");
  }
  const evaluationsById = new Map(
    evaluations
      .filter((evaluation) => evaluation.threadId === threadId)
      .map((evaluation) => [evaluation.id, evaluation]),
  );
  const samples: EvaluationCalibrationSample[] = adjudications
    .filter((adjudication) => adjudication.threadId === threadId)
    .map((adjudication) => {
      const evaluation = evaluationsById.get(adjudication.evaluationId);
      if (!evaluation) {
        throw new Error(
          `Calibration evaluation is missing: ${adjudication.evaluationId}`,
        );
      }
      const validated = validateEvaluationAdjudication(
        adjudication,
        evaluation,
      );
      const revision = validated.revisions.at(-1)!;
      return {
        evaluationId: evaluation.id,
        adjudicationId: validated.id,
        adjudicationRevision: revision.revision,
        evaluatorModel: structuredClone(evaluation.evaluatorModel),
        rubricName: evaluation.rubric.name,
        rubricSha256: hashEvaluationRubric(evaluation.rubric),
        modelVerdict: evaluation.verdict,
        expectedVerdict: revision.expectedVerdict,
        agreement: evaluation.verdict === revision.expectedVerdict,
        evaluationSha256: revision.evaluationSha256,
        adjudicationSha256: revision.contentSha256,
      };
    });
  const summary = summarizeEvaluationCalibrationSamples(samples);
  const content = {
    kind: "napier.evaluator-calibration" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    threadId,
    ...summary,
  };
  return {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function hashEvaluationRubric(rubric: EvaluationRubricSnapshot): string {
  return sha256(canonicalJson(rubric));
}

export function summarizeEvaluationCalibrationSamples(
  input: EvaluationCalibrationSample[],
): {
  samples: EvaluationCalibrationSample[];
  groups: EvaluationCalibrationGroup[];
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
} {
  const samples = structuredClone(input).sort((left, right) =>
    `${left.evaluatorModel.provider}/${left.evaluatorModel.id}/${left.rubricSha256}/${left.evaluationId}`.localeCompare(
      `${right.evaluatorModel.provider}/${right.evaluatorModel.id}/${right.rubricSha256}/${right.evaluationId}`,
    ),
  );
  const groupMap = new Map<string, EvaluationCalibrationSample[]>();
  for (const sample of samples) {
    const key = `${sample.evaluatorModel.provider}\0${sample.evaluatorModel.id}\0${sample.rubricSha256}`;
    groupMap.set(key, [...(groupMap.get(key) ?? []), sample]);
  }
  const groups: EvaluationCalibrationGroup[] = [...groupMap.values()].map(
    (groupSamples) => {
      const first = groupSamples[0]!;
      const agreementCount = groupSamples.filter(
        (sample) => sample.agreement,
      ).length;
      return {
        evaluatorModel: first.evaluatorModel,
        rubricName: first.rubricName,
        rubricSha256: first.rubricSha256,
        sampleCount: groupSamples.length,
        agreementCount,
        agreementRate: rate(agreementCount, groupSamples.length),
        confusionMatrix: confusionMatrix(groupSamples),
      };
    },
  );
  const agreementCount = samples.filter((sample) => sample.agreement).length;
  return {
    samples,
    groups,
    sampleCount: samples.length,
    agreementCount,
    agreementRate: rate(agreementCount, samples.length),
  };
}

function confusionMatrix(
  samples: EvaluationCalibrationSample[],
): EvaluationConfusionMatrix {
  const matrix = Object.fromEntries(
    VERDICTS.map((modelVerdict) => [
      modelVerdict,
      Object.fromEntries(
        VERDICTS.map((expectedVerdict) => [expectedVerdict, 0]),
      ),
    ]),
  ) as EvaluationConfusionMatrix;
  for (const sample of samples) {
    matrix[sample.modelVerdict][sample.expectedVerdict] += 1;
  }
  return matrix;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function normalizeVerdict(value: RunEvaluationVerdict): RunEvaluationVerdict {
  if (!VERDICTS.includes(value)) {
    throw new Error(`Evaluation adjudication verdict is invalid: ${value}`);
  }
  return value;
}

function normalizeNote(value: string | undefined): string {
  const note = (value ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 1_000) {
    throw new Error("Evaluation adjudication note exceeds 1000 characters");
  }
  return note;
}

function normalizeAdjudicationSource(
  request: ReviewRunEvaluationRequest,
): Pick<EvaluationAdjudicationRevision, "source" | "sourceSha256"> {
  if (request.source === undefined && request.sourceSha256 === undefined) {
    return {};
  }
  if (
    request.source !== "reviewer_consensus" ||
    typeof request.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.sourceSha256)
  ) {
    throw new Error("Evaluation adjudication provenance is invalid");
  }
  return {
    source: request.source,
    sourceSha256: request.sourceSha256,
  };
}

function validAdjudicationSource(
  revision: EvaluationAdjudicationRevision,
): boolean {
  return (
    (revision.source === undefined && revision.sourceSha256 === undefined) ||
    (revision.source === "reviewer_consensus" &&
      typeof revision.sourceSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(revision.sourceSha256))
  );
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

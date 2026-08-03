import type {
  EvaluationConsensusGate,
  ReviewRunEvaluationRequest,
  ResolveEvaluationConsensusRequest,
  SubmitEvaluationReviewerBallotRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseReviewRunEvaluationRequest(
  input: unknown,
): ReviewRunEvaluationRequest | undefined {
  const record = requestRecord(input, ["expectedVerdict", "note"]);
  const expectedVerdict = parseRunEvaluationVerdict(
    record?.["expectedVerdict"],
  );
  const note = parseOptionalBoundedText(record?.["note"], 1_000);
  if (
    !record ||
    !expectedVerdict ||
    (record["note"] !== undefined && note === undefined)
  ) {
    return undefined;
  }
  return {
    expectedVerdict,
    ...(note ? { note } : {}),
  };
}

export function parseSubmitEvaluationReviewerBallotRequest(
  input: unknown,
): SubmitEvaluationReviewerBallotRequest | undefined {
  const record = requestRecord(input, [
    "reviewerId",
    "reviewerName",
    "expectedVerdict",
    "note",
  ]);
  const reviewerId = record?.["reviewerId"];
  const reviewerName = record?.["reviewerName"];
  const expectedVerdict = parseRunEvaluationVerdict(
    record?.["expectedVerdict"],
  );
  const note = parseOptionalBoundedText(record?.["note"], 1_000);
  if (
    !record ||
    typeof reviewerId !== "string" ||
    !/^[a-z][a-z0-9_-]{1,63}$/i.test(reviewerId.trim()) ||
    typeof reviewerName !== "string" ||
    !reviewerName.replace(/\s+/g, " ").trim() ||
    reviewerName.replace(/\s+/g, " ").trim().length > 80 ||
    !expectedVerdict ||
    (record["note"] !== undefined && note === undefined)
  ) {
    return undefined;
  }
  return {
    reviewerId,
    reviewerName,
    expectedVerdict,
    ...(typeof record["note"] === "string" ? { note: record["note"] } : {}),
  };
}

export function parseResolveEvaluationConsensusRequest(
  input: unknown,
): ResolveEvaluationConsensusRequest | undefined {
  const record = requestRecord(input, ["gate"]);
  const gate =
    record?.["gate"] === undefined
      ? undefined
      : requestRecord(record["gate"], [
          "minimumReviewers",
          "minimumAgreementRate",
          "allowInconclusive",
        ]);
  const minimumReviewers = gate?.["minimumReviewers"];
  const minimumAgreementRate = gate?.["minimumAgreementRate"];
  const allowInconclusive = gate?.["allowInconclusive"];
  if (
    !record ||
    (record["gate"] !== undefined && !gate) ||
    (minimumReviewers !== undefined &&
      (!Number.isInteger(minimumReviewers) ||
        Number(minimumReviewers) < 2 ||
        Number(minimumReviewers) > 9)) ||
    (minimumAgreementRate !== undefined &&
      (typeof minimumAgreementRate !== "number" ||
        !Number.isFinite(minimumAgreementRate) ||
        minimumAgreementRate < 0.5 ||
        minimumAgreementRate > 1)) ||
    (allowInconclusive !== undefined && typeof allowInconclusive !== "boolean")
  ) {
    return undefined;
  }
  const normalizedGate: Partial<EvaluationConsensusGate> = {
    ...(typeof minimumReviewers === "number" ? { minimumReviewers } : {}),
    ...(typeof minimumAgreementRate === "number"
      ? { minimumAgreementRate }
      : {}),
    ...(typeof allowInconclusive === "boolean" ? { allowInconclusive } : {}),
  };
  return gate ? { gate: normalizedGate } : {};
}

function parseRunEvaluationVerdict(
  input: unknown,
): ReviewRunEvaluationRequest["expectedVerdict"] | undefined {
  return input === "left_better" ||
    input === "right_better" ||
    input === "tie" ||
    input === "inconclusive"
    ? input
    : undefined;
}

function parseOptionalBoundedText(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (input === undefined) return "";
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : undefined;
}

import { describe, expect, it } from "vitest";

import {
  parseResolveEvaluationConsensusRequest,
  parseReviewRunEvaluationRequest,
  parseSubmitEvaluationReviewerBallotRequest,
} from "../src/evaluation-review-http-validation.js";

describe("Evaluation Review HTTP validation", () => {
  it("parses adjudication, ballot, and consensus requests", () => {
    expect(
      parseReviewRunEvaluationRequest({
        expectedVerdict: "left_better",
        note: "  reviewed  ",
      }),
    ).toEqual({ expectedVerdict: "left_better", note: "reviewed" });
    expect(
      parseSubmitEvaluationReviewerBallotRequest({
        reviewerId: "Reviewer_1",
        reviewerName: "Reviewer One",
        expectedVerdict: "tie",
        note: "  preserve raw note  ",
      }),
    ).toEqual({
      reviewerId: "Reviewer_1",
      reviewerName: "Reviewer One",
      expectedVerdict: "tie",
      note: "  preserve raw note  ",
    });
    expect(
      parseResolveEvaluationConsensusRequest({
        gate: {
          minimumReviewers: 3,
          minimumAgreementRate: 0.75,
          allowInconclusive: false,
        },
      }),
    ).toEqual({
      gate: {
        minimumReviewers: 3,
        minimumAgreementRate: 0.75,
        allowInconclusive: false,
      },
    });
  });

  it("accepts an empty consensus override and optional notes", () => {
    expect(parseResolveEvaluationConsensusRequest({})).toEqual({});
    expect(
      parseReviewRunEvaluationRequest({ expectedVerdict: "inconclusive" }),
    ).toEqual({ expectedVerdict: "inconclusive" });
  });

  it("rejects extra keys, invalid verdicts, identities, notes, and gates", () => {
    expect(
      parseReviewRunEvaluationRequest({
        expectedVerdict: "wrong",
      }),
    ).toBeUndefined();
    expect(
      parseSubmitEvaluationReviewerBallotRequest({
        reviewerId: "!",
        reviewerName: "Reviewer",
        expectedVerdict: "tie",
      }),
    ).toBeUndefined();
    expect(
      parseSubmitEvaluationReviewerBallotRequest({
        reviewerId: "reviewer",
        reviewerName: "Reviewer",
        expectedVerdict: "tie",
        note: "x".repeat(1_001),
      }),
    ).toBeUndefined();
    expect(
      parseResolveEvaluationConsensusRequest({
        gate: { minimumReviewers: 1 },
      }),
    ).toBeUndefined();
    expect(
      parseResolveEvaluationConsensusRequest({ gate: {}, extra: true }),
    ).toBeUndefined();
  });
});

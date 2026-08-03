import { describe, expect, it } from "vitest";

import {
  parseCreateEvaluationSuiteRequest,
  parseCreateRunEvaluationRequest,
  parseUpdateEvaluationSuiteRequest,
} from "../src/evaluation-http-validation.js";

const rubric = {
  name: "Correctness",
  criteria: [
    { id: "correct", name: "Correct", description: "Correct result" },
    { id: "scope", name: "Scope", description: "Bounded changes" },
  ],
};

describe("Evaluation HTTP validation", () => {
  it("parses Run Evaluation and Suite requests with shared rubric rules", () => {
    expect(
      parseCreateRunEvaluationRequest({
        leftRunId: "run_abcdefgh",
        rightRunId: "run_ijklmnop",
        rubric,
      }),
    ).toEqual({
      leftRunId: "run_abcdefgh",
      rightRunId: "run_ijklmnop",
      rubric,
    });
    expect(
      parseCreateEvaluationSuiteRequest({
        name: "Release gate",
        baselineRunId: "run_abcdefgh",
        candidateRunIds: ["run_ijklmnop"],
        rubric,
        gate: {
          minimumPassRate: 0.8,
          minimumCandidateScore: 3,
          allowInconclusive: false,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        name: "Release gate",
        baselineRunId: "run_abcdefgh",
        candidateRunIds: ["run_ijklmnop"],
        rubric,
      }),
    );
  });

  it("parses partial Suite updates", () => {
    expect(
      parseUpdateEvaluationSuiteRequest({
        name: "Updated gate",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
      }),
    ).toEqual({
      name: "Updated gate",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    });
  });

  it("rejects duplicate Runs, rubric criteria, invalid gates, and extra keys", () => {
    expect(
      parseCreateRunEvaluationRequest({
        leftRunId: "run_abcdefgh",
        rightRunId: "run_abcdefgh",
      }),
    ).toBeUndefined();
    expect(
      parseCreateEvaluationSuiteRequest({
        name: "Gate",
        baselineRunId: "run_abcdefgh",
        candidateRunIds: ["run_abcdefgh"],
      }),
    ).toBeUndefined();
    expect(
      parseUpdateEvaluationSuiteRequest({
        gate: { minimumCandidateScore: 6 },
      }),
    ).toBeUndefined();
    expect(
      parseCreateRunEvaluationRequest({
        leftRunId: "run_abcdefgh",
        rightRunId: "run_ijklmnop",
        rubric: {
          ...rubric,
          criteria: [rubric.criteria[0], rubric.criteria[0]],
        },
      }),
    ).toBeUndefined();
    expect(parseUpdateEvaluationSuiteRequest({ extra: true })).toBeUndefined();
  });
});

import type { RunEvaluationRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createEvaluationCalibrationReport,
  reviewRunEvaluation,
  validateEvaluationAdjudication,
} from "../src/evaluation-calibration.js";

function evaluation(
  id: string,
  verdict: RunEvaluationRecord["verdict"],
  modelId = "judge-1",
): RunEvaluationRecord {
  return {
    id,
    threadId: "thread_calibration",
    leftRunId: `run_left_${id}`,
    rightRunId: `run_right_${id}`,
    leftSnapshotSha256: "a".repeat(64),
    rightSnapshotSha256: "b".repeat(64),
    rubric: {
      name: "Release rubric",
      criteria: [
        {
          id: "correctness",
          name: "Correctness",
          description: "Grounded in evidence.",
        },
      ],
    },
    scores: [
      {
        criterionId: "correctness",
        leftScore: 3,
        rightScore: 4,
        reason: "Compared evidence.",
      },
    ],
    verdict,
    reason: "Model judgment.",
    evidence: "Immutable evidence.",
    evaluatorModel: { provider: "faux", id: modelId },
    createdAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("evaluation adjudication and calibration", () => {
  it("appends reviewed truth revisions and rejects tampering", () => {
    const record = evaluation("evaluation_reviewed", "right_better");
    const first = reviewRunEvaluation(undefined, record, {
      expectedVerdict: "tie",
      note: "Human review found equivalent evidence.",
    });
    expect(first).toEqual(
      expect.objectContaining({
        currentRevision: 1,
        revisions: [
          expect.objectContaining({
            revision: 1,
            expectedVerdict: "tie",
            evaluationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    expect(validateEvaluationAdjudication(first, record)).toEqual(first);
    expect(
      reviewRunEvaluation(first, record, {
        expectedVerdict: "tie",
        note: "Human review found equivalent evidence.",
      }),
    ).toEqual(first);

    const revised = reviewRunEvaluation(first, record, {
      expectedVerdict: "right_better",
      note: "A second review confirmed the candidate.",
    });
    expect(revised.currentRevision).toBe(2);
    expect(revised.revisions).toHaveLength(2);

    const tampered = structuredClone(revised);
    tampered.revisions[0]!.note = "Tampered";
    expect(() => validateEvaluationAdjudication(tampered, record)).toThrow(
      "hash mismatch",
    );
  });

  it("groups calibration by model and rubric with a confusion matrix", () => {
    const first = evaluation("evaluation_one", "right_better");
    const second = evaluation("evaluation_two", "left_better");
    const third = evaluation("evaluation_three", "tie", "judge-2");
    const adjudications = [
      reviewRunEvaluation(undefined, first, {
        expectedVerdict: "right_better",
      }),
      reviewRunEvaluation(undefined, second, {
        expectedVerdict: "tie",
      }),
      reviewRunEvaluation(undefined, third, {
        expectedVerdict: "tie",
      }),
    ];
    const report = createEvaluationCalibrationReport(
      first.threadId,
      [first, second, third],
      adjudications,
      new Date("2026-07-25T01:00:00.000Z"),
    );

    expect(report).toEqual(
      expect.objectContaining({
        sampleCount: 3,
        agreementCount: 2,
        agreementRate: 0.6667,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0]).toEqual(
      expect.objectContaining({
        evaluatorModel: { provider: "faux", id: "judge-1" },
        sampleCount: 2,
        agreementCount: 1,
        agreementRate: 0.5,
      }),
    );
    expect(report.groups[0]!.confusionMatrix.left_better.tie).toBe(1);
    expect(report.groups[0]!.confusionMatrix.right_better.right_better).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  applyGoalEvaluation,
  beginGoalContinuation,
  buildGoalContinuationPrompt,
  createGoal,
  parseGoalEvaluationResponse,
  shouldContinueGoal,
} from "../src/goals.js";

const CONTINUE_EVALUATION = {
  satisfied: false,
  blocker: "goal_not_met_yet" as const,
  reason: "More autonomous work can produce evidence.",
  evidence: "The first implementation step completed.",
};

describe("goal evaluator contract", () => {
  it("parses fenced JSON and normalizes satisfied blockers", () => {
    const evaluation = parseGoalEvaluationResponse(`
\`\`\`json
{"satisfied":true,"blocker":"goal_not_met_yet","reason":"Verified.","evidence":"Tests passed."}
\`\`\`
`);
    expect(evaluation).toEqual({
      satisfied: true,
      blocker: "none",
      reason: "Verified.",
      evidence: "Tests passed.",
    });
  });

  it("fails malformed evaluator output instead of guessing", () => {
    expect(() => parseGoalEvaluationResponse("probably done")).toThrow(
      "did not contain a JSON object",
    );
  });
});

describe("goal continuation state machine", () => {
  it("continues only for an explicitly continuable blocker", () => {
    const goal = applyGoalEvaluation(
      createGoal("Ship the verified change"),
      CONTINUE_EVALUATION,
      "Implemented the first step.",
      "run_1",
    );
    expect(goal.status).toBe("active");
    expect(shouldContinueGoal(goal)).toBe(true);

    const next = beginGoalContinuation(goal);
    expect(next.continuationCount).toBe(1);
    expect(buildGoalContinuationPrompt(next)).toContain(
      "Do not repeat the previous response",
    );
  });

  it("blocks after repeated evidence reaches the no-progress limit", () => {
    const first = applyGoalEvaluation(
      createGoal("Complete the migration"),
      CONTINUE_EVALUATION,
      "No new evidence.",
      "run_1",
    );
    const second = applyGoalEvaluation(
      beginGoalContinuation(first),
      CONTINUE_EVALUATION,
      "No new evidence.",
      "run_1",
    );
    expect(second.noProgressCount).toBe(1);
    expect(shouldContinueGoal(second)).toBe(true);

    const third = applyGoalEvaluation(
      beginGoalContinuation(second),
      CONTINUE_EVALUATION,
      "No new evidence.",
      "run_1",
    );
    expect(third.noProgressCount).toBe(2);
    expect(third.status).toBe("blocked");
    expect(third.reason).toContain("No-progress limit reached");
    expect(shouldContinueGoal(third)).toBe(false);
  });

  it("stops at the configured continuation budget", () => {
    const first = applyGoalEvaluation(
      createGoal("Finish the report", 1),
      CONTINUE_EVALUATION,
      "Draft created.",
      "run_1",
    );
    const exhausted = applyGoalEvaluation(
      beginGoalContinuation(first),
      CONTINUE_EVALUATION,
      "Sources reviewed.",
      "run_1",
    );
    expect(exhausted.continuationCount).toBe(1);
    expect(exhausted.status).toBe("blocked");
    expect(exhausted.reason).toContain("Continuation limit reached");
  });

  it("marks verified completion terminal", () => {
    const completed = applyGoalEvaluation(
      createGoal("Publish the artifact"),
      {
        satisfied: true,
        blocker: "none",
        reason: "The artifact and verification are present.",
        evidence: "artifact.md; checks passed",
      },
      "Published artifact.md and ran checks.",
      "run_2",
    );
    expect(completed.status).toBe("completed");
    expect(completed.blocker).toBe("none");
    expect(shouldContinueGoal(completed)).toBe(false);
  });
});

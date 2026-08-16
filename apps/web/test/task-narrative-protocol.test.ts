import { describe, expect, it } from "vitest";

import { isTaskNarrativeProjection } from "../src/task-narrative-protocol";

describe("Task Narrative protocol", () => {
  it("accepts the bounded server projection and rejects malformed items", () => {
    expect(
      isTaskNarrativeProjection({
        phase: "working",
        phaseLabel: "Working",
        currentAction: "Running web search",
        completedItems: ["Read 2 files"],
        metricRunId: "run_1",
      }),
    ).toBe(true);
    expect(
      isTaskNarrativeProjection({
        phase: "working",
        phaseLabel: "Working",
        currentAction: "Invalid",
        completedItems: "not-an-array",
      }),
    ).toBe(false);
  });
});

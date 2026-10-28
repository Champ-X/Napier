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
  it("validates the execution, acceptance and deliverable facts independently", () => {
    const projection = {
      phase: "ended",
      phaseLabel: "Run ended",
      currentAction: "Inspect",
      completedItems: [],
      execution: "ended",
      objective: { status: "unverified", reason: "No grader", evidence: [] },
      remainingItems: [],
      processItems: [],
      deliverables: [],
    };
    expect(isTaskNarrativeProjection(projection)).toBe(true);
    expect(
      isTaskNarrativeProjection({
        ...projection,
        objective: { status: "accepted" },
      }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({ ...projection, execution: "success" }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({
        ...projection,
        deliverables: [{ path: "fake" }],
      }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({ ...projection, processItems: [2] }),
    ).toBe(false);
  });
});

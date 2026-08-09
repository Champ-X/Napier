import type { ExecutionPlan } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { taskArtifactPaths } from "../src/TaskCompletionSummary";

describe("Task completion summary", () => {
  it("shows recent authoritative outputs without missing artifacts", () => {
    const current = plan("active");
    current.artifacts = [
      artifact("report", "verified", "artifacts/report.md", 4),
      artifact("preview", "produced", "artifacts/preview.html", 3),
      artifact("missing", "missing", "artifacts/missing.txt", 5),
      artifact("old", "superseded", "artifacts/old.txt", 6),
    ];

    expect(taskArtifactPaths([current])).toEqual([
      "artifacts/report.md",
      "artifacts/preview.html",
    ]);
  });
});

function plan(status: ExecutionPlan["status"]): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "Deliver outputs",
    status,
    steps: [],
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "a".repeat(64),
    revision: 1,
    createdAt: timestamp(0),
    updatedAt: timestamp(0),
  };
}

function artifact(
  id: string,
  status: ExecutionPlan["artifacts"][number]["status"],
  path: string,
  second: number,
): ExecutionPlan["artifacts"][number] {
  return {
    id,
    path,
    kind: "file",
    description: id,
    status,
    evidence: "Runtime evidence.",
    createdAt: timestamp(0),
    updatedAt: timestamp(second),
  };
}

function timestamp(second: number): string {
  return `2026-08-09T00:00:0${String(second)}.000Z`;
}

import type { RunEvent } from "@napier/contracts";
import { expect, it } from "vitest";
import {
  createTaskPlanSnapshot,
  parseTaskPlanSnapshot,
} from "../src/task-plan-snapshot.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import { plan, hash } from "./run-progress-vector-test-support.js";

function event(
  seq: number,
  snapshot: ReturnType<typeof createTaskPlanSnapshot>,
  runId = "run_fixture",
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: snapshot.threadId,
    runId,
    seq,
    createdAt: "2026-09-13T00:00:00Z",
    category: "tool",
    visibility: "user",
    type: "tool.completed",
    payload: {
      toolName: "replan_plan",
      details: { planId: snapshot.planId, planState: snapshot },
    },
  };
}

it("retains current revision, replaced IDs and reasons across compaction and same-thread recovery", () => {
  const before = plan("pending", "expected", "active");
  const after = structuredClone(before);
  after.revision = 2;
  after.artifacts[0]!.status = "superseded";
  after.artifacts.push({
    ...after.artifacts[0]!,
    id: "replacement",
    path: "report.json",
    status: "expected",
  });
  after.replans.push({
    id: "replan_fixture",
    fromRevision: 1,
    toRevision: 2,
    reason: "Use the user's requested path",
    supersededStepIds: [],
    supersededArtifactIds: ["artifact_fixture"],
    addedStepIds: [],
    addedArtifactIds: ["replacement"],
    dependencyUpdatedStepIds: [],
    strategy: "scope_change",
    evidence: "User instruction",
    addedStepsSha256: hash("steps"),
    addedArtifactsSha256: hash("artifacts"),
    dependencyUpdatesSha256: hash("dependencies"),
    replanSha256: hash("replan"),
    createdAt: "2026-09-13T00:00:00Z",
  });
  const first = event(1, createTaskPlanSnapshot(before));
  const latest = event(2, createTaskPlanSnapshot(after));
  const state = projectTaskWorkingState({
    runId: "run_recovered",
    sourceRunIds: ["run_fixture"],
    events: [
      first,
      latest,
      {
        ...latest,
        id: "compaction",
        seq: 3,
        type: "context.compacted",
        payload: {},
      },
    ],
  });
  expect(state.plans).toHaveLength(1);
  expect(state.plans[0]).toMatchObject({
    revision: 2,
    state: "observed",
    snapshot: {
      artifacts: [
        { id: "artifact_fixture", status: "superseded" },
        { id: "replacement", path: "report.json" },
      ],
      latestReplan: {
        fromRevision: 1,
        toRevision: 2,
        supersededArtifactIds: ["artifact_fixture"],
      },
    },
  });
  expect(state.completion).toBe("not_determined");
  expect(state.instructionRevision).toBe(0);
});

it("rejects corrupted, foreign and duplicate-ID snapshots and exposes same-revision conflicts", () => {
  const base = plan("pending", "expected", "active");
  const snapshot = createTaskPlanSnapshot(base);
  expect(parseTaskPlanSnapshot({ ...snapshot, revision: 3 })).toBeUndefined();
  const duplicate = structuredClone(base);
  duplicate.artifacts.push(duplicate.artifacts[0]!);
  expect(
    parseTaskPlanSnapshot(createTaskPlanSnapshot(duplicate)),
  ).toBeUndefined();
  const altered = structuredClone(base);
  altered.status = "cancelled";
  const old = event(1, snapshot);
  const conflict = event(2, createTaskPlanSnapshot(altered));
  const foreign = { ...event(3, snapshot), threadId: "foreign" };
  const state = projectTaskWorkingState({
    runId: "run_fixture",
    events: [old, conflict, foreign],
  });
  expect(state.plans[0]).toMatchObject({
    state: "conflicting",
    snapshot: null,
  });
  expect(state.truncated).toBe(true);
  expect(
    projectTaskWorkingState({ runId: "other", events: [old] }).plans,
  ).toEqual([]);
});

it("does not roll back current state when an older revision is re-observed", () => {
  const base = plan("pending", "expected", "active");
  const current = { ...base, revision: 3 };
  const events = [
    event(1, createTaskPlanSnapshot(current)),
    event(2, createTaskPlanSnapshot(base)),
  ];
  const state = projectTaskWorkingState({ runId: "run_fixture", events });
  expect(state.plans[0]!.revision).toBe(3);
});

it("bounds large plan projections and keeps truncation visible", () => {
  const base = plan("pending", "expected", "active");
  base.artifacts = Array.from({ length: 40 }, (_, i) => ({
    ...base.artifacts[0]!,
    id: `artifact_${i}`,
  }));
  const snapshot = createTaskPlanSnapshot(base);
  expect(parseTaskPlanSnapshot(snapshot)).toBeDefined();
  expect(snapshot.artifacts).toHaveLength(32);
  expect(snapshot.artifactCount).toBe(40);
  expect(snapshot.truncated).toBe(true);
});

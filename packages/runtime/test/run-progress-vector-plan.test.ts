import type { JsonValue } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendPlanCreatedEvent,
  appendPlanStepEvent,
} from "../src/plan-tool-events.js";
import {
  createRunPlanProgressSnapshot,
  decodeRunPlanProgressSnapshot,
  projectRunArtifactState,
  projectRunPlanState,
} from "../src/run-progress-plan-state.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  event,
  plan,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("Plan and artifact progress ordering", () => {
  it("does not treat planning churn as product progress and detects rollback", () => {
    const pending = plan("pending", "expected", "active");
    const running = plan("running", "expected", "active");
    const partial = plan("partial", "candidate", "active");
    const completed = plan("completed", "verified", "completed");
    const regressed = plan("running", "missing", "active");

    expect(projectRunPlanState([pending]).productScore).toBe(0);
    expect(projectRunPlanState([running]).productScore).toBe(0);
    expect(projectRunPlanState([partial]).productScore).toBe(1);
    expect(projectRunPlanState([completed])).toEqual(
      expect.objectContaining({ productScore: 2, acceptanceScore: 2 }),
    );
    expect(projectRunPlanState([regressed]).productScore).toBeLessThan(
      projectRunPlanState([completed]).productScore,
    );
    expect(projectRunArtifactState([completed])).toEqual(
      expect.objectContaining({ productScore: 3, acceptanceScore: 1 }),
    );
    expect(projectRunArtifactState([regressed])).toEqual(
      expect.objectContaining({ productScore: 0, acceptanceScore: 0 }),
    );
  });

  it("replays each completed turn from its immutable Plan snapshot", async () => {
    const fixture = await createFixture("plan-as-of-replay");
    const run = await createRun(fixture);
    let current = await fixture.store.createPlan(fixture.threadId, {
      objective: "Build one durable product.",
      steps: [
        {
          id: "build",
          title: "Build",
          description: "Build the product.",
          verification: "The product is complete.",
        },
      ],
    });
    await appendPlanCreatedEvent(fixture.store, run, current);
    await event(fixture.store, run, "turn.completed", {});

    current = await fixture.store.transitionPlanStep(current.id, "build", {
      action: "start",
      runId: run.id,
    });
    await appendPlanStepEvent(fixture.store, run, current, "build", "start");
    current = await fixture.store.transitionPlanStep(current.id, "build", {
      action: "complete",
      runId: run.id,
      evidence: "Built and inspected.",
    });
    await appendPlanStepEvent(fixture.store, run, current, "build", "complete");
    await event(fixture.store, run, "turn.completed", {});

    await RunProgressTracker.create(fixture.store, run);
    const vectors = (await fixture.store.listRunEvents(run.id)).filter(
      (candidate) => candidate.type === "run.progress.vector",
    );
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.payload).toEqual(
      expect.objectContaining({
        turnIndex: 1,
        planCount: 1,
        productProgressed: false,
        progressScores: expect.objectContaining({ planProduct: 0 }),
      }),
    );
    expect(vectors[1]?.payload).toEqual(
      expect.objectContaining({
        turnIndex: 2,
        productProgressed: true,
        progressScores: expect.objectContaining({ planProduct: 2 }),
      }),
    );
    fixture.store.close();
  });

  it("rejects a modified Plan snapshot at the codec boundary", () => {
    const snapshot = createRunPlanProgressSnapshot(
      plan("completed", "verified", "completed"),
    );
    expect(
      decodeRunPlanProgressSnapshot(snapshot as unknown as JsonValue),
    ).toEqual(snapshot);
    expect(
      decodeRunPlanProgressSnapshot({
        ...snapshot,
        revision: snapshot.revision + 1,
      } as unknown as JsonValue),
    ).toBeUndefined();
  });
});

import type { JsonObject } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  DEFAULT_RUN_CONVERGENCE_POLICY,
  hasRunNoProgressPressure,
} from "../src/run-convergence-policy.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import { projectValidatedVectorChain } from "../src/run-progress-payload-codec.js";
import { LocalStore } from "../src/store.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  event,
  hash,
  productTurn,
  receipt,
  toolEvent,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("bounded execution activity", () => {
  it("allows an acknowledged redirect to finish its inspection before a productive action", async () => {
    const fixture = await createFixture("activity-redirect");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    for (let turn = 0; turn < 6; turn++) {
      await event(fixture.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    expect(await tracker.steer(new Map(), async () => [])).toHaveLength(1);
    for (let part = 0; part < 2; part++) {
      await toolEvent(fixture.store, run, "tool.completed", {
        callId: `inspect-${part}`,
        toolName: "observer",
        progress: receipt(
          "observe",
          "supporting",
          hash("file"),
          hash(`part-${part}`),
        ),
      });
      await event(fixture.store, run, "turn.completed", {});
      await expect(tracker.recordTurn()).resolves.toBeDefined();
    }
    await productTurn(
      fixture.store,
      run,
      tracker,
      "write",
      hash("file"),
      hash("output"),
    );
    expect(
      (await fixture.store.listRunEvents(run.id))
        .filter((item) => item.type === "run.progress.rerouted")
        .map((item) => item.payload["status"]),
    ).toEqual(["requested", "resolved"]);
    await expect(
      RunProgressTracker.create(fixture.store, run),
    ).resolves.toBeDefined();
    await fixture.store.close();
  });

  it("does not let fresh evidence waive the absolute semantic-stall deadline", async () => {
    const fixture = await createFixture("activity-deadline");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    await event(fixture.store, run, "turn.completed", {});
    await tracker.recordTurn();
    const original = projectValidatedVectorChain(
      await fixture.store.listRunEvents(run.id),
      run.id,
    )[0]!;
    const phase = { attempts: 0, advances: 0, failureDomains: 0 };
    const deadline = DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs;
    const working = {
      ...original,
      stagnantTurnCount: 6,
      activity: {
        progressed: true,
        stagnantTurnCount: 0,
        stagnantElapsedMs: 0,
        acquisitionTurnCountSinceProgress: 0,
      },
    };
    expect(
      hasRunNoProgressPressure(
        { ...working, stagnantElapsedMs: deadline - 1 },
        phase,
      ),
    ).toBe(false);
    expect(
      hasRunNoProgressPressure(
        { ...working, stagnantElapsedMs: deadline },
        phase,
      ),
    ).toBe(true);
    await fixture.store.close();
  });

  it("keeps a multi-step inspection/edit/verification pipeline live across SQLite reopen", async () => {
    const fixture = await createFixture("working-pipeline");
    const run = await createRun(fixture);
    let store = fixture.store;
    let tracker = await RunProgressTracker.create(store, run);
    const resource = hash("article.html");
    await productTurn(store, run, tracker, "draft", resource, hash("draft"));
    for (let part = 1; part <= 5; part++) {
      await observe(part);
    }
    const changed = await productTurn(
      store,
      run,
      tracker,
      "edit",
      resource,
      hash("revised"),
    );
    expect(changed.payload).toMatchObject({
      progressed: false,
      deliveryReadiness: "unverified",
      stagnantTurnCount: 6,
      activity: { progressed: true, stagnantTurnCount: 0 },
    });
    const options = {
      dataRoot: store.dataRoot,
      workspaceRoot: store.workspaceRoot,
    };
    // Reconstruct the live controller from durable state before continuing.
    tracker = await RunProgressTracker.create(store, run);
    await observe(6);
    await observe(7);
    await toolEvent(store, run, "tool.completed", {
      callId: "verify",
      toolName: "verifier",
      progress: receipt("verify", "verification", resource, hash("checks")),
      details: { status: "passed" },
    });
    await event(store, run, "turn.completed", {});
    const verified = await tracker.recordTurn();
    expect(verified.payload).toMatchObject({
      acceptanceProgressed: true,
      deliveryReadiness: "ready",
      stagnantTurnCount: 0,
    });
    const events = await store.listRunEvents(run.id);
    expect(events.some((item) => item.type === "run.progress.rerouted")).toBe(
      false,
    );
    const vectors = projectValidatedVectorChain(events, run.id);
    expect(vectors.at(-1)?.activity).toMatchObject({
      progressed: true,
      stagnantTurnCount: 0,
    });
    await store.close();
    store = new LocalStore(options);
    await store.initialize();
    await expect(RunProgressTracker.create(store, run)).resolves.toBeDefined();
    expect(
      projectValidatedVectorChain(await store.listRunEvents(run.id), run.id),
    ).toEqual(vectors);
    await store.close();

    async function observe(part: number) {
      await toolEvent(store, run, "tool.completed", {
        callId: `inspect-${part}`,
        toolName: "observer",
        progress: receipt(
          "observe",
          "supporting",
          resource,
          hash(`section-${part}`),
        ),
      });
      await event(store, run, "turn.completed", {});
      return tracker.recordTurn();
    }
  });

  it("does not renew activity for duplicate observations or cycling product states", async () => {
    const fixture = await createFixture("activity-cycle");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("cycle.txt");
    await productTurn(fixture.store, run, tracker, "a", resource, hash("A"));
    await productTurn(fixture.store, run, tracker, "b", resource, hash("B"));
    for (let index = 0; index < 6; index++) {
      const vector = await productTurn(
        fixture.store,
        run,
        tracker,
        `cycle-${index}`,
        resource,
        hash(index % 2 ? "B" : "A"),
      );
      expect(vector.payload["activity"]).toMatchObject({
        progressed: false,
        stagnantTurnCount: index + 1,
      });
    }
    await tracker.steer(new Map(), async () => []);
    await event(fixture.store, run, "turn.completed", {});
    await expect(tracker.recordTurn()).rejects.toThrow(
      "no measurable progress",
    );
    await fixture.store.close();
  });

  it("bounds novel but unverified changes and preserves the bound on tracker recovery", async () => {
    const fixture = await createFixture("activity-churn");
    const run = await createRun(fixture);
    let tracker = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("churn.txt");
    const limit = DEFAULT_RUN_CONVERGENCE_POLICY.noProgressTurnThreshold * 3;
    for (let turn = 0; turn <= limit; turn++) {
      await productTurn(
        fixture.store,
        run,
        tracker,
        `change-${turn}`,
        resource,
        hash(`state-${turn}`),
      );
      if (turn === limit - 1)
        tracker = await RunProgressTracker.create(fixture.store, run);
    }
    const requested = (await fixture.store.listRunEvents(run.id)).find(
      (item) => item.type === "run.progress.rerouted",
    );
    expect(requested?.payload).toMatchObject({
      status: "requested",
      stagnantTurnCount: limit,
    });
    await tracker.steer(new Map(), async () => []);
    // The redirect grants one multi-step finalization window. Its timestamp
    // and turn boundary never slide when more novel effects arrive.
    for (
      let turn = 0;
      turn < DEFAULT_RUN_CONVERGENCE_POLICY.noProgressTurnThreshold + 1;
      turn++
    ) {
      await productTurn(
        fixture.store,
        run,
        tracker,
        `grace-${turn}`,
        resource,
        hash(`grace-${turn}`),
      );
      if (turn === 1)
        tracker = await RunProgressTracker.create(fixture.store, run);
    }
    await expect(
      productTurn(fixture.store, run, tracker, "last", resource, hash("last")),
    ).rejects.toThrow("no measurable progress");
    await fixture.store.close();
  });

  it("rejects forged activity and a v3-to-v2 downgrade even when hashes are recomputed", async () => {
    const fixture = await createFixture("activity-codec");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    for (let turn = 0; turn < 2; turn++) {
      await event(fixture.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    const events = await fixture.store.listRunEvents(run.id);
    const last = events
      .filter((item) => item.type === "run.progress.vector")
      .at(-1)!;
    const forged = structuredClone(events);
    const target = forged.find((item) => item.id === last.id)!;
    const activity = target.payload["activity"] as JsonObject;
    target.payload = rehash({
      ...target.payload,
      activity: {
        ...activity,
        progressed: true,
        stagnantTurnCount: 0,
        stagnantElapsedMs: 0,
      },
    });
    expect(() => projectValidatedVectorChain(forged, run.id)).toThrow(
      "activity disagrees",
    );
    const { activity: _activity, ...legacy } = last.payload;
    target.payload = rehash({
      ...legacy,
      schemaVersion: 2,
      projectionId: sha256(
        canonicalJson({
          kind: "napier.run-progress-vector",
          schemaVersion: 2,
          runId: run.id,
          turnCompletedSeq: legacy["turnCompletedSeq"],
        }),
      ),
    });
    expect(() => projectValidatedVectorChain(forged, run.id)).toThrow(
      "cannot downgrade",
    );
    await fixture.store.close();
  });
});

function rehash(payload: JsonObject): JsonObject {
  const { contentSha256: _hash, ...content } = payload;
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

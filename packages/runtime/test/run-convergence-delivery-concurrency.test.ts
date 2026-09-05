import { afterEach, describe, expect, it, vi } from "vitest";

import { RunProgressTracker } from "../src/run-progress-vector.js";
import { RunOperatorEpochConflictError } from "../src/run-operator-epoch-claim.js";
import { ConcurrentRunEventHeadError } from "../src/sqlite-ledger-errors.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  event,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("Run convergence directive delivery", () => {
  it("lets only the durable delivery winner inject a directive", async () => {
    const fixture = await createFixture("directive-delivery-race");
    const run = await createRun(fixture);
    const initial = await RunProgressTracker.create(fixture.store, run);

    for (let turn = 0; turn < 6; turn += 1) {
      await event(fixture.store, run, "turn.completed", {});
      await initial.recordTurn();
    }

    const first = await RunProgressTracker.create(fixture.store, run);
    const second = await RunProgressTracker.create(fixture.store, run);
    const [firstMessages, secondMessages] = await Promise.all([
      first.steer(new Map(), async () => []),
      second.steer(new Map(), async () => []),
    ]);

    expect([...firstMessages, ...secondMessages]).toHaveLength(1);
    expect(
      (await fixture.store.listRunEvents(run.id)).filter(
        (candidate) => candidate.type === "run.progress.directive.delivered",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("never returns external steering without a durable operator epoch", async () => {
    const fixture = await createFixture("operator-epoch-contention");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    vi.spyOn(fixture.store, "appendEventOnceAtRunHead").mockRejectedValue(
      new ConcurrentRunEventHeadError(run.id, 0, 1),
    );

    await expect(
      tracker.steer(new Map(), async () => [
        { role: "user", content: "continue", timestamp: Date.now() },
      ]),
    ).rejects.toThrow("Run operator epoch claim was contended");

    fixture.store.close();
  });

  it("never adopts a competing operator epoch for different steering", async () => {
    const fixture = await createFixture("operator-epoch-message-race");
    const run = await createRun(fixture);
    const first = await RunProgressTracker.create(fixture.store, run);
    const second = await RunProgressTracker.create(fixture.store, run);
    const messages = [
      { role: "user" as const, content: "steering-a", timestamp: 101 },
      { role: "user" as const, content: "steering-b", timestamp: 102 },
    ];

    const settled = await Promise.allSettled([
      first.steer(new Map(), async () => [messages[0]!]),
      second.steer(new Map(), async () => [messages[1]!]),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toEqual([
      expect.objectContaining({ value: [expect.any(Object)] }),
    ]);
    expect(settled.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.any(RunOperatorEpochConflictError),
      }),
    ]);
    expect(
      (await fixture.store.listRunEvents(run.id)).filter(
        (event) => event.type === "run.progress.operator_epoch",
      ),
    ).toHaveLength(1);

    fixture.store.close();
  });
});

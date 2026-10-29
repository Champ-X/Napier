import { expect, it } from "vitest";
import { DeferredOperationReinspection } from "../src/run-deferred-operation-recovery.js";

it("bounds each batch and lets unattempted work precede a busy retry", () => {
  const queue = new DeferredOperationReinspection();
  const hints = Array.from({ length: 10 }, (_, index) => ({ runId: `run_${index}`, bindingSha256: `binding_${index}` }));
  queue.remember(hints, 0);
  expect(queue.due(999)).toEqual([]);
  const first = queue.due(1_000);
  expect(first).toHaveLength(8);
  queue.settle(first, first, 1_000);
  expect(queue.due(1_000)).toEqual(hints.filter((hint) => !first.includes(hint)));
  queue.settle(queue.due(1_000), [], 1_000);
  expect(queue.due(2_999)).toEqual([]);
  expect(queue.due(3_000)).toEqual(first);
});

it("caps backoff without dropping still-busy work and does not revive completed hints", () => {
  const queue = new DeferredOperationReinspection(), hint = { runId: "run_one", bindingSha256: "original" };
  queue.remember([hint], 0);
  let now = 1_000;
  for (const backoff of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    expect(queue.due(now)).toEqual([hint]);
    queue.settle([hint], [hint], now);
    expect(queue.due(now + backoff - 1)).toEqual([]);
    now += backoff;
  }
  queue.settle([hint], [], now);
  expect(queue.due(now + 60_000)).toEqual([]);
});

it("an old attempted batch cannot erase a newer generation discovered by lifecycle recovery", () => {
  const queue = new DeferredOperationReinspection();
  const old = { runId: "run_one", bindingSha256: "old" }, current = { ...old, bindingSha256: "current" };
  queue.remember([old], 0);
  const attempted = queue.due(1_000);
  queue.remember([current], 1_000);
  queue.settle(attempted, [], 1_000);
  expect(queue.due(2_000)).toEqual([current]);
});

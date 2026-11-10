import { expect, it } from "vitest";

import { ActiveRunStreamAbort } from "../src/active-run-stream-abort";

it("replaces the previous signal when a new stream begins", () => {
  const owner = new ActiveRunStreamAbort();
  const first = owner.begin();
  const second = owner.begin();
  expect(first.aborted).toBe(true);
  expect(second.aborted).toBe(false);
  owner.abort();
  expect(second.aborted).toBe(true);
});

it("ignores release for a superseded signal", () => {
  const owner = new ActiveRunStreamAbort();
  const first = owner.begin();
  const second = owner.begin();
  owner.release(first);
  expect(second.aborted).toBe(false);
  owner.abort();
  expect(second.aborted).toBe(true);
});

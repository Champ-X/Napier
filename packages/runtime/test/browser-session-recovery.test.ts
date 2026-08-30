import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness as createHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
});

describe("Browser Session recovery", () => {
  it("treats repeated start as navigation in the healthy Run Session", async () => {
    const harness = await createHarness();
    const owner = { threadId: "thread_repeat_start", runId: "run_repeat_start" };
    const first = await harness.manager.execute(owner, {
      action: "start", url: "https://one.example/first",
    });
    const repeated = await harness.manager.execute(owner, {
      action: "start", url: "https://one.example/second",
    });
    expect(first.details.sessionReused).toBe(false);
    expect(repeated.details.sessionReused).toBe(true);
    expect(repeated.details.sessionOperation).toBe(2);
    expect(repeated.details.sessionIdSha256).toBe(first.details.sessionIdSha256);
    expect(harness.browsers).toHaveLength(1);
    await harness.manager.cancelRun(owner);
  });

  it("keeps a healthy Session after a cross-origin preflight denial", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_cross_origin_preflight",
      runId: "run_cross_origin_preflight",
    };
    const started = await harness.manager.execute(owner, {
      action: "start", url: "https://one.example/start",
    });
    await expect(harness.manager.execute(owner, {
      action: "navigate", url: "https://two.example/blocked",
    })).rejects.toThrow("Cross-origin navigation requires allowCrossOrigin");
    const snapshot = await harness.manager.execute(owner, { action: "snapshot" });
    expect(snapshot.details.sessionIdSha256).toBe(started.details.sessionIdSha256);
    expect(snapshot.details.sessionReused).toBe(true);
    expect(harness.browsers[0]?.closed).toBe(false);
    await harness.manager.cancelRun(owner);
  });
});

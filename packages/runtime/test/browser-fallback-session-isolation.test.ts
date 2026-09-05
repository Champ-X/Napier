import { afterEach, describe, expect, it } from "vitest";

import { createWebFetchBrowserFallbackProvider } from "../src/web-fetch-browser-fallback.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness as createHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
});

describe("Web Fetch browser fallback session isolation", () => {
  it("isolates the fallback lane from the interactive Session", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_fallback_lane",
      runId: "run_fallback_lane",
    };
    const interactive = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/interactive",
    });
    const fallback = createWebFetchBrowserFallbackProvider(harness.manager);

    await fallback.captureUrl(owner, {
      url: "https://two.example/fallback",
      maxChars: 12_000,
      waitMs: 0,
    });

    const snapshot = await harness.manager.execute(owner, {
      action: "snapshot",
    });
    expect(snapshot.details.sessionIdSha256).toBe(
      interactive.details.sessionIdSha256,
    );
    expect(snapshot.output).toContain("https://one.example/interactive");
    expect(harness.browsers).toHaveLength(2);
    expect(harness.browsers[0]?.closed).toBe(false);
    expect(harness.browsers[1]?.closed).toBe(true);
    await harness.manager.cancelRun(owner);
  });

  it("serializes complete fallback captures within their lane", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_fallback_lane_queue",
      runId: "run_fallback_lane_queue",
    };
    const fallback = createWebFetchBrowserFallbackProvider(harness.manager);

    const [first, second] = await Promise.all([
      fallback.captureUrl(owner, {
        url: "https://one.example/fallback",
        maxChars: 12_000,
        waitMs: 0,
      }),
      fallback.captureUrl(owner, {
        url: "https://two.example/fallback",
        maxChars: 12_000,
        waitMs: 0,
      }),
    ]);

    expect(first.url).toBe("https://one.example/fallback");
    expect(second.url).toBe("https://two.example/fallback");
    expect(harness.browsers).toHaveLength(2);
    expect(harness.browsers.every((browser) => browser.closed)).toBe(true);
  });

  it("keeps a healthy Session after an ordinary navigation timeout", async () => {
    const harness = await createHarness();
    const owner = {
      threadId: "thread_navigation_timeout",
      runId: "run_navigation_timeout",
    };
    const started = await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/start",
    });
    const timeout = new Error("page.goto: Timeout 30000ms exceeded");
    timeout.name = "TimeoutError";
    harness.pages[0]!.gotoFailure = timeout;

    await expect(
      harness.manager.execute(owner, {
        action: "navigate",
        url: "https://two.example/slow",
        allowCrossOrigin: true,
      }),
    ).rejects.toThrow("Timeout 30000ms exceeded");

    const snapshot = await harness.manager.execute(owner, {
      action: "snapshot",
    });
    expect(snapshot.details.sessionIdSha256).toBe(
      started.details.sessionIdSha256,
    );
    expect(snapshot.output).toContain("https://one.example/start");
    expect(harness.browsers[0]?.closed).toBe(false);
    await harness.manager.cancelRun(owner);
  });
});

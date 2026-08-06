import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
});

describe("confirmed Browser Session action", () => {
  it("executes against the unchanged page state", async () => {
    const harness = await createBrowserSessionHarness();
    const owner = { threadId: "thread_confirm", runId: "run_confirm" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    const request = { action: "click" as const, target: { ref: "e3" } };
    const expected = await harness.manager.captureConfirmationPageState(
      owner,
      request,
    );

    const result = await harness.manager.executeConfirmedAction(
      owner,
      request,
      expected,
    );

    expect(result.details.sessionOperation).toBe(2);
    expect(harness.pages[0]?.clicked).toEqual(["aria-ref=e3"]);
    await harness.manager.cancelRun(owner);
  });

  it("rejects page drift before action and keeps the Session retryable", async () => {
    const harness = await createBrowserSessionHarness();
    const owner = { threadId: "thread_drift", runId: "run_drift" };
    await harness.manager.execute(owner, {
      action: "start",
      url: "https://one.example/",
    });
    const request = { action: "click" as const, target: { ref: "e3" } };
    const expected = await harness.manager.captureConfirmationPageState(
      owner,
      request,
    );
    harness.pages[0]!.ariaSnapshotText = '- button "Changed target" [ref=e3]';

    await expect(
      harness.manager.executeConfirmedAction(owner, request, expected),
    ).rejects.toThrow("page changed while confirmation was pending");
    expect(harness.pages[0]?.clicked).toEqual([]);
    expect(harness.manager.hasActiveSession(owner)).toBe(true);

    const fresh = await harness.manager.captureConfirmationPageState(
      owner,
      request,
    );
    await expect(
      harness.manager.executeConfirmedAction(owner, request, fresh),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ sessionOperation: 2 }),
      }),
    );
    expect(harness.pages[0]?.clicked).toEqual(["aria-ref=e3"]);
    await harness.manager.cancelRun(owner);
  });
});

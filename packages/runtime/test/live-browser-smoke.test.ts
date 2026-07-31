import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunBrowserSessionManager } from "../src/browser-session.js";

const describeLive =
  process.env["NAPIER_LIVE_BROWSER_SMOKE"] === "1" ? describe : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describeLive("live controlled Browser Session smoke", () => {
  it("navigates, snapshots, screenshots, and closes real Chrome", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_browser",
      runId: "run_live_browser",
    };
    try {
      const started = await manager.execute(owner, {
        action: "start",
        url: "https://example.com/",
      });
      const snapshot = await manager.execute(owner, { action: "snapshot" });
      const screenshot = await manager.execute(owner, {
        action: "screenshot",
      });
      const closed = await manager.execute(owner, { action: "close" });

      expect(started.details.sessionReused).toBe(false);
      expect(started.details.network.destinationCount).toBeGreaterThan(0);
      expect(started.output).toContain("Example Domain");
      expect(snapshot.details).toEqual(
        expect.objectContaining({
          sessionReused: true,
          sessionOperation: 2,
          sessionIdSha256: started.details.sessionIdSha256,
        }),
      );
      expect(snapshot.output).toContain("[ref=");
      expect(screenshot.details.screenshotBytes).toBeGreaterThan(0);
      expect(screenshot.screenshot?.mimeType).toBe("image/png");
      expect(closed.details.sessionOperation).toBe(4);
    } catch (error) {
      if (nestedSandboxDenied(error)) {
        skip(
          "inconclusive: the current host denies Chrome's nested production sandbox",
        );
      }
      throw error;
    } finally {
      await manager.cancelRun(owner).catch(() => undefined);
    }
  }, 60_000);
});

function nestedSandboxDenied(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return (
    /sandbox initialization failed/iu.test(message) ||
    /failed to initialize sandbox/iu.test(message)
  );
}

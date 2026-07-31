import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunBrowserSessionManager } from "../src/browser-session.js";
import { sha256 } from "../src/ed25519.js";
import { RunResearchSourceManager } from "../src/research-sources.js";

const describeLive =
  process.env["NAPIER_LIVE_BROWSER_SMOKE"] === "1" ? describe : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describeLive("live controlled Browser Session smoke", () => {
  it("captures a citation-backed Markdown brief through real Chrome", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const research = new RunResearchSourceManager(manager, workspaceRoot);
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
      const captured = await research.execute(owner, {
        action: "capture",
        maxChars: 12_000,
      });
      const sourceLine = captured.output
        .split("\n")
        .map((line) => /^(\d+) \| (.*Example Domain.*)$/u.exec(line))
        .find((match) => match !== null);
      expect(sourceLine).toBeDefined();
      const lineNumber = Number(sourceLine![1]);
      const citation = await research.execute(owner, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: captured.details.sourceContentSha256!,
        startLine: lineNumber,
        endLine: lineNumber,
        claim: "The page identifies itself as Example Domain.",
      });
      const citationToken = `[citation:${citation.details.citationId!}]`;
      const reportPath = path.join(workspaceRoot, "research-brief.md");
      const report = [
        "# Research Brief",
        "",
        `The page identifies itself as Example Domain. ${citationToken}`,
        "",
        "## Evidence Ledger",
        "",
        `- Source: ${captured.details.sourceId!}`,
        `- Capture SHA-256: ${captured.details.sourceContentSha256!}`,
        `- Lines: ${String(lineNumber)}-${String(lineNumber)}`,
        `- Citation ID: ${citation.details.citationId!}`,
        "- URL: https://example.com/",
        "",
      ].join("\n");
      await writeFile(reportPath, report);
      const verified = await research.execute(owner, {
        action: "verify_report",
        path: "research-brief.md",
        expectedSha256: sha256(report),
      });
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
      expect(captured.details).toEqual(
        expect.objectContaining({
          action: "capture",
          sourceCount: 1,
          citationCount: 0,
          browserSessionOperation: 3,
          browserSessionIdSha256: started.details.sessionIdSha256,
        }),
      );
      expect(citation.details).toEqual(
        expect.objectContaining({
          action: "cite",
          citationCount: 1,
          citationStartLine: lineNumber,
          citationEndLine: lineNumber,
        }),
      );
      expect(verified.details).toEqual(
        expect.objectContaining({
          action: "verify_report",
          reportFileSha256: sha256(report),
          reportCitationCount: 1,
        }),
      );
      expect(await readFile(reportPath, "utf8")).toContain(citationToken);
      expect(screenshot.details.screenshotBytes).toBeGreaterThan(0);
      expect(screenshot.screenshot?.mimeType).toBe("image/png");
      expect(closed.details.sessionOperation).toBe(5);
    } catch (error) {
      if (nestedSandboxDenied(error)) {
        skip(
          "inconclusive: the current host denies Chrome's nested production sandbox",
        );
      }
      throw error;
    } finally {
      await Promise.allSettled([
        research.cancelRun(owner),
        manager.cancelRun(owner),
      ]);
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

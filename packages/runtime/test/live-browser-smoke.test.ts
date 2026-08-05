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
      const found = await manager.execute(owner, {
        action: "find",
        query: "Example Domain",
      });
      const scrolled = await manager.execute(owner, {
        action: "scroll",
        direction: "down",
        pixels: 400,
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
      expect(found.details).toEqual(
        expect.objectContaining({
          action: "find",
          sessionReused: true,
          sessionOperation: 2,
          findMatchCount: 1,
        }),
      );
      expect(found.details.network).toEqual(started.details.network);
      expect(scrolled.details).toEqual(
        expect.objectContaining({
          action: "scroll",
          sessionReused: true,
          sessionOperation: 3,
          scrollAtStart: true,
          scrollAtEnd: true,
        }),
      );
      expect(scrolled.details.network).toEqual(started.details.network);
      expect(snapshot.details).toEqual(
        expect.objectContaining({
          sessionReused: true,
          sessionOperation: 4,
          sessionIdSha256: started.details.sessionIdSha256,
        }),
      );
      expect(snapshot.output).toContain("[ref=");
      expect(captured.details).toEqual(
        expect.objectContaining({
          action: "capture",
          sourceCount: 1,
          citationCount: 0,
          browserSessionOperation: 5,
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
      expect(closed.details.sessionOperation).toBe(7);
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

  it("keeps selected-tab history, Source capture, and Live view aligned", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-tabs-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_browser_tabs",
      runId: "run_live_browser_tabs",
    };
    try {
      const started = await manager.execute(owner, {
        action: "start",
        url: "https://example.com/?tab=first",
      });
      await manager.execute(owner, {
        action: "navigate",
        url: "https://example.com/?tab=next",
      });
      const backed = await manager.execute(owner, { action: "back" });
      const forwarded = await manager.execute(owner, { action: "forward" });
      const opened = await manager.execute(owner, {
        action: "tab_new",
        url: "https://example.com/?tab=second",
      });
      const listed = await manager.execute(owner, { action: "tab_list" });
      const captured = await manager.capturePage(owner, 12_000);
      const live = await manager.captureLiveView(owner);
      const switched = await manager.execute(owner, {
        action: "tab_switch",
        tabId: "tab_1",
      });
      const closedTab = await manager.execute(owner, {
        action: "tab_close",
        tabId: "tab_2",
      });
      const closed = await manager.execute(owner, { action: "close" });

      expect(started.details).toEqual(
        expect.objectContaining({
          activeTabId: "tab_1",
          tabCount: 1,
        }),
      );
      expect(backed.output).toContain("?tab=first");
      expect(forwarded.output).toContain("?tab=next");
      expect(opened.details).toEqual(
        expect.objectContaining({
          activeTabId: "tab_2",
          tabCount: 2,
        }),
      );
      expect(listed.tabs).toEqual([
        expect.objectContaining({
          tabId: "tab_1",
          active: false,
          url: "https://example.com/?tab=next",
        }),
        expect.objectContaining({
          tabId: "tab_2",
          active: true,
          url: "https://example.com/?tab=second",
        }),
      ]);
      expect(captured).toEqual(
        expect.objectContaining({
          url: "https://example.com/?tab=second",
          activeTabId: "tab_2",
          tabCount: 2,
          tabSetSha256: opened.details.tabSetSha256,
        }),
      );
      expect(live.receipt).toEqual(
        expect.objectContaining({
          activeTabId: "tab_2",
          tabCount: 2,
          tabSetSha256: opened.details.tabSetSha256,
        }),
      );
      expect(live.image.byteLength).toBeGreaterThan(0);
      expect(switched.output).toContain("?tab=next");
      expect(closedTab.details).toEqual(
        expect.objectContaining({
          activeTabId: "tab_1",
          tabCount: 1,
        }),
      );
      expect(closed.details.sessionOperation).toBe(10);
    } catch (error) {
      if (nestedSandboxDenied(error)) {
        skip(
          "inconclusive: the current host denies Chrome's nested production sandbox",
        );
      }
      throw error;
    } finally {
      await manager.cancelRun(owner);
    }
  }, 60_000);

  it("diagnoses public login and challenge pages without importing user state", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-diagnosis-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_browser_diagnosis",
      runId: "run_live_browser_diagnosis",
    };
    try {
      const login = await manager.execute(owner, {
        action: "start",
        url: "https://github.com/login",
        allowCrossOrigin: true,
      });
      const loginLive = await manager.captureLiveView(owner);
      expect(login.details.pageDiagnosis).toEqual(
        expect.objectContaining({
          status: "login_required",
          takeoverRecommended: true,
        }),
      );
      expect(loginLive.receipt.pageDiagnosis).toEqual(
        login.details.pageDiagnosis,
      );
      expect(login.output).toContain("Ask the user to take control");

      const article = await manager.execute(owner, {
        action: "navigate",
        url: "https://developers.cloudflare.com/turnstile/",
        allowCrossOrigin: true,
      });
      expect(article.details.pageDiagnosis).toEqual(
        expect.objectContaining({
          status: "none",
          takeoverRecommended: false,
        }),
      );

      const challenge = await manager.execute(owner, {
        action: "navigate",
        url: "https://demo.turnstile.workers.dev/",
        allowCrossOrigin: true,
      });
      const challengeLive = await manager.captureLiveView(owner);
      expect(challenge.details.pageDiagnosis).toEqual(
        expect.objectContaining({
          status: "challenge_detected",
          takeoverRecommended: true,
        }),
      );
      expect(challengeLive.receipt.pageDiagnosis).toEqual(
        challenge.details.pageDiagnosis,
      );
      expect(challenge.output).toContain("CAPTCHA solving is not automated");
    } catch (error) {
      if (nestedSandboxDenied(error)) {
        skip(
          "inconclusive: the current host denies Chrome's nested production sandbox",
        );
      }
      throw error;
    } finally {
      await manager.cancelRun(owner);
    }
  }, 90_000);
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

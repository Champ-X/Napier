import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BrowserOutputArtifactRegistrar } from "../src/browser-output-artifact.js";
import { streamBrowserLiveView } from "../src/browser-live-view-stream.js";
import { RunBrowserSessionManager } from "../src/browser-session.js";
import { sha256 } from "../src/ed25519.js";
import { RunResearchSourceManager } from "../src/research-sources.js";
import { LocalStore } from "../src/store.js";

const describeLive =
  process.env["NAPIER_LIVE_BROWSER_SMOKE"] === "1" ? describe : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describeLive("live controlled Browser Session smoke", () => {
  it("previews an interactive workspace artifact without a local service", async ({
    skip,
  }) => {
    const workspaceRoot = path.resolve(
      import.meta.dirname,
      "fixtures/browser-preview",
    );
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_workspace_preview",
      runId: "run_live_workspace_preview",
    };
    try {
      const preview = await manager.execute(owner, {
        action: "preview_workspace",
        path: "index.html",
      });
      await manager.execute(owner, {
        action: "click",
        target: { selector: '[data-mode="triangle"]' },
      });
      await manager.execute(owner, {
        action: "type",
        target: { selector: "#density" },
        text: "8",
      });
      const snapshot = await manager.execute(owner, { action: "snapshot" });
      const screenshot = await manager.execute(owner, {
        action: "screenshot",
      });
      const consoleResult = await manager.execute(owner, {
        action: "console",
      });

      expect(preview.details).toEqual(
        expect.objectContaining({
          action: "preview_workspace",
          sessionReused: false,
          workspacePreviewEntryPathSha256:
            expect.stringMatching(/^[a-f0-9]{64}$/u),
          workspacePreviewEntrySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          workspacePreviewEntryBytes: expect.any(Number),
          blockedRequestCount: 0,
          network: expect.objectContaining({
            destinationCount: 0,
            connectCount: 0,
            transferredBytes: 0,
          }),
        }),
      );
      expect(snapshot.output).toContain("triangle:8:5:5");
      expect(screenshot.details.screenshotBytes).toBeGreaterThan(0);
      expect(screenshot.screenshot?.mimeType).toBe("image/png");
      expect(consoleResult.output).toContain("No warnings or errors");
      expect(consoleResult.details).toEqual(
        expect.objectContaining({
          consoleEntryCount: 0,
          consoleErrorCount: 0,
          consoleWarningCount: 0,
        }),
      );
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

  it("persists the exact verified live viewport as a workspace PNG", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-screenshot-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_browser_screenshot",
      runId: "run_live_browser_screenshot",
    };
    try {
      await manager.execute(owner, {
        action: "start",
        url: "https://example.com/",
      });
      const live = await manager.captureLiveView(owner);
      const streamEvents = [];
      for await (const event of streamBrowserLiveView(
        {
          capture: (_threadId: string, _runId: string, signal?: AbortSignal) =>
            manager.captureLiveView(owner, signal),
        } as never,
        owner.threadId,
        owner.runId,
        undefined,
        {
          maxSamples: 3,
          intervalMs: 500,
          sleep: async () => undefined,
        },
      )) {
        streamEvents.push(event);
      }
      const saved = await manager.executeTakeoverAction(owner, {
        action: "save_screenshot",
        path: "browser-live.png",
        expectedLiveImageSha256: live.receipt.imageSha256,
      });
      const bytes = await readFile(
        path.join(workspaceRoot, "browser-live.png"),
      );
      const store = new LocalStore({
        workspaceRoot,
        dataRoot: path.join(workspaceRoot, ".state"),
      });
      await store.initialize();
      const agent = store.listAgents()[0]!;
      const thread = await store.createThread({
        title: "Live Browser Artifact",
        agentId: agent.id,
      });
      const run = await store.createRun({
        threadId: thread.id,
        agentId: agent.id,
        source: "user",
      });
      let plan = await store.createPlan(thread.id, {
        objective: "Register the saved Browser viewport.",
        steps: [
          {
            id: "save",
            title: "Save Browser viewport",
            description: "Save the verified Browser viewport.",
            verification: "The declared file Artifact is produced.",
          },
        ],
        artifacts: [
          {
            id: "browser-live",
            path: "browser-live.png",
            kind: "file",
            description: "The saved Browser viewport.",
          },
        ],
      });
      plan = await store.transitionPlanStep(plan.id, "save", {
        action: "start",
        runId: run.id,
      });
      const registration = await new BrowserOutputArtifactRegistrar(
        store,
      ).register(
        { threadId: thread.id, runId: run.id },
        {
          action: "save_screenshot",
          path: "browser-live.png",
          pathSha256: saved.details.file!.pathSha256,
          fileSha256: saved.details.file!.fileSha256,
          fileBytes: saved.details.file!.fileBytes,
        },
      );

      expect(saved.details).toEqual(
        expect.objectContaining({
          action: "save_screenshot",
          sessionOperation: 2,
          file: {
            pathSha256: sha256("browser-live.png"),
            fileSha256: live.receipt.imageSha256,
            fileBytes: live.receipt.imageBytes,
          },
        }),
      );
      expect(sha256(bytes)).toBe(live.receipt.imageSha256);
      expect(bytes.byteLength).toBe(live.image.byteLength);
      expect(streamEvents).toHaveLength(2);
      expect(streamEvents[0]).toEqual(
        expect.objectContaining({
          type: "browser_live_view",
          sequence: 1,
          receipt: expect.objectContaining({
            sessionOperation: 1,
            imageSha256: live.receipt.imageSha256,
          }),
        }),
      );
      expect(streamEvents[1]).toEqual(
        expect.objectContaining({
          type: "browser_live_view_end",
          sampleCount: 3,
          frameCount: 1,
          duplicateCount: 2,
          reason: "sample_limit",
        }),
      );
      expect(registration.status).toBe("registered");
      expect(store.getPlan(plan.id).artifacts[0]).toEqual(
        expect.objectContaining({
          status: "verified",
          sourceRunId: run.id,
          sha256: live.receipt.imageSha256,
          sizeBytes: bytes.byteLength,
        }),
      );
      store.close();
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

  it("streams a public archive from a fresh takeover ref into the workspace", async ({
    skip,
  }) => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-browser-download-"),
    );
    roots.push(workspaceRoot);
    const manager = new RunBrowserSessionManager({ workspaceRoot });
    const owner = {
      threadId: "thread_live_browser_download",
      runId: "run_live_browser_download",
    };
    try {
      await manager.execute(owner, {
        action: "start",
        url: "https://www.w3.org/TR/xhtml1/",
      });
      const takeover = await manager.captureTakeoverSnapshot(owner);
      const ref = /link "ZIP archive" \[ref=([a-z0-9]+)\]/u.exec(
        takeover.snapshot.snapshot ?? "",
      )?.[1];
      expect(ref).toBeDefined();

      const downloaded = await manager.executeTakeoverAction(owner, {
        action: "download",
        target: { ref: ref! },
        path: "xhtml1.zip",
      });
      const bytes = await readFile(path.join(workspaceRoot, "xhtml1.zip"));

      expect(downloaded.details).toEqual(
        expect.objectContaining({
          action: "download",
          sessionOperation: 2,
          file: {
            pathSha256: sha256("xhtml1.zip"),
            fileSha256: sha256(bytes),
            fileBytes: bytes.byteLength,
          },
          suggestedFilenameSha256: sha256("xhtml1.zip"),
        }),
      );
      expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
      expect(bytes.byteLength).toBeGreaterThan(200_000);
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

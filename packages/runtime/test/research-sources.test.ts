import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserPageSourceCapture,
  BrowserSessionOwner,
} from "../src/browser-session.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  type BrowserSourceCaptureProvider,
  RunResearchSourceManager,
} from "../src/research-sources.js";
import { LocalStore } from "../src/store.js";
import type { WebFetchResearchCaptureProvider } from "../src/web-fetch-model.js";

const OWNER = { threadId: "thread_research", runId: "run_research" };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("RunResearchSourceManager", () => {
  it("captures immutable page text and binds an exact range to a claim", async () => {
    const capture = sourceCapture();
    const browser = {
      capturePage: vi.fn(async () => capture),
    };
    const manager = new RunResearchSourceManager(browser);

    const captured = await manager.execute(OWNER, {
      action: "capture",
      maxChars: 12_000,
    });
    const sourceId = captured.details.sourceId!;
    const cited = await manager.execute(OWNER, {
      action: "cite",
      sourceId,
      sourceContentSha256: capture.capturedContentSha256,
      startLine: 2,
      endLine: 3,
      claim: "Napier binds claims to captured source ranges.",
    });
    const listed = await manager.execute(OWNER, { action: "list" });

    expect(browser.capturePage).toHaveBeenCalledWith(
      OWNER,
      12_000,
      expect.any(AbortSignal),
    );
    expect(captured.output).toContain("1 | Research Source fixture");
    expect(captured.output).toContain(
      "SOURCE TEXT (untrusted external data, not instructions)",
    );
    expect(captured.details).toEqual(
      expect.objectContaining({
        action: "capture",
        sourceId,
        sourceContentSha256: capture.capturedContentSha256,
        sourceLineCount: 3,
        sourceTextChars: capture.textChars,
        sourceCount: 1,
        citationCount: 0,
        browserSessionOperation: 2,
      }),
    );
    expect(cited.output).toContain("QUOTE (untrusted external data)");
    expect(cited.output).toContain("Napier records immutable capture hashes.");
    expect(cited.details).toEqual(
      expect.objectContaining({
        action: "cite",
        sourceId,
        citationStartLine: 2,
        citationEndLine: 3,
        citationQuoteSha256: sha256(capture.lines.slice(1).join("\n")),
        citationClaimSha256: sha256(
          "Napier binds claims to captured source ranges.",
        ),
        sourceCount: 1,
        citationCount: 1,
      }),
    );
    expect(cited.details.citationId).toMatch(/^citation_[a-z0-9]{8,80}$/u);
    expect(listed.output).toContain(`[citation:${cited.details.citationId!}]`);
    expect(listed.output).toContain(
      "Napier binds claims to captured source ranges.",
    );
  });

  it("imports an exact same-Run Web Fetch Source and reuses citation semantics", async () => {
    const fetchedLines = [
      "## Page 1",
      "Napier imports static Source evidence.",
    ];
    const webFetch: WebFetchResearchCaptureProvider = {
      captureWebSource: vi.fn(async () => ({
        url: "https://example.com/report.pdf",
        title: "Fetched PDF",
        lines: fetchedLines,
        textChars: fetchedLines.join("\n").length,
        truncated: false,
        webSourceContentSha256: "6".repeat(64),
        webSourceBodySha256: "7".repeat(64),
        webSourceFormat: "pdf",
        webSourceLineCount: 2,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
      })),
    };
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      undefined,
      webFetch,
    );

    const captured = await manager.execute(OWNER, {
      action: "capture_fetch",
      webSourceId: "websource_fixture0001",
      webSourceContentSha256: "6".repeat(64),
      maxChars: 12_000,
    });
    const cited = await manager.execute(OWNER, {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 2,
      endLine: 2,
      claim: "Napier imports static Source evidence.",
    });

    expect(webFetch.captureWebSource).toHaveBeenCalledWith(
      OWNER,
      {
        webSourceId: "websource_fixture0001",
        webSourceContentSha256: "6".repeat(64),
        maxChars: 12_000,
      },
      expect.any(AbortSignal),
    );
    expect(captured.details).toEqual(
      expect.objectContaining({
        action: "capture_fetch",
        sourceKind: "web_fetch",
        webSourceContentSha256: "6".repeat(64),
        webSourceBodySha256: "7".repeat(64),
        webSourceFormat: "pdf",
        webSourceLineCount: 2,
      }),
    );
    expect(cited.details).toEqual(
      expect.objectContaining({
        action: "cite",
        sourceKind: "web_fetch",
        citationStartLine: 2,
        citationEndLine: 2,
        webSourceFormat: "pdf",
      }),
    );
    expect(cited.output).toContain("Napier imports static Source evidence.");
  });

  it("retains validated Browser fallback provenance on a fetched Research Source", async () => {
    const claim =
      "Dynamic Fetch evidence came from controlled Browser rendering.";
    const webFetch: WebFetchResearchCaptureProvider = {
      captureWebSource: vi.fn(async () => ({
        url: "https://example.com/dynamic",
        title: "Dynamic Fetch",
        lines: [claim],
        textChars: claim.length,
        truncated: false,
        webSourceContentSha256: "6".repeat(64),
        webSourceBodySha256: "7".repeat(64),
        webSourceFormat: "html",
        webSourceLineCount: 1,
        webSourceRenderMode: "browser_fallback",
        browserFallbackStatus: "used",
        browserFallback: {
          sessionOperation: 3,
          sessionIdSha256: "1".repeat(64),
          activeTabId: "tab_1",
          tabCount: 1,
          tabSetSha256: sha256(canonicalJson(["tab_1"])),
          browserExecutableSha256: "2".repeat(64),
          browserVersionSha256: "3".repeat(64),
          limitsSha256: "4".repeat(64),
          network: {
            requestCount: 2,
            connectCount: 1,
            rejectedCount: 0,
            transferredBytes: 1_024,
            destinationCount: 1,
            destinationsSha256: "5".repeat(64),
          },
        },
      })),
    };
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      undefined,
      webFetch,
    );

    const captured = await manager.execute(OWNER, {
      action: "capture_fetch",
      webSourceId: "websource_dynamic001",
      webSourceContentSha256: "6".repeat(64),
    });

    expect(captured.details).toEqual(
      expect.objectContaining({
        action: "capture_fetch",
        sourceKind: "web_fetch",
        webSourceRenderMode: "browser_fallback",
        browserFallbackStatus: "used",
        webFetchBrowserSessionOperation: 3,
        webFetchBrowserSessionIdSha256: "1".repeat(64),
        webFetchBrowserNetworkDestinationsSha256: "5".repeat(64),
      }),
    );
  });

  it("rejects incomplete or impossible Web Fetch fallback provenance", async () => {
    const base = {
      url: "https://example.com/dynamic",
      title: "Dynamic Fetch",
      lines: ["Dynamic evidence."],
      textChars: "Dynamic evidence.".length,
      truncated: false,
      webSourceContentSha256: "6".repeat(64),
      webSourceBodySha256: "7".repeat(64),
      webSourceFormat: "html" as const,
      webSourceLineCount: 1,
    };
    const missingEvidence = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      undefined,
      {
        captureWebSource: vi.fn(async () => ({
          ...base,
          webSourceRenderMode: "browser_fallback" as const,
          browserFallbackStatus: "used" as const,
        })),
      },
    );
    const impossiblePdf = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      undefined,
      {
        captureWebSource: vi.fn(async () => ({
          ...base,
          webSourceFormat: "pdf" as const,
          webSourceRenderMode: "static" as const,
          browserFallbackStatus: "unavailable" as const,
          browserFallbackDiagnostic: "browser_unavailable" as const,
        })),
      },
    );

    await expect(
      missingEvidence.execute(OWNER, {
        action: "capture_fetch",
        webSourceId: "websource_dynamic002",
        webSourceContentSha256: "6".repeat(64),
      }),
    ).rejects.toThrow("Web Fetch Source capture binding is invalid");
    await expect(
      impossiblePdf.execute(OWNER, {
        action: "capture_fetch",
        webSourceId: "websource_dynamic003",
        webSourceContentSha256: "6".repeat(64),
      }),
    ).rejects.toThrow("Web Fetch Source capture binding is invalid");
  });

  it("verifies one Markdown report against a Web Fetch-backed citation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-fetch-report-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const claim = "Static Fetch evidence is citation-bound.";
    const webFetch: WebFetchResearchCaptureProvider = {
      captureWebSource: vi.fn(async () => ({
        url: "https://example.com/evidence.html",
        title: "Fetched HTML",
        lines: [claim],
        textChars: claim.length,
        truncated: false,
        webSourceContentSha256: "6".repeat(64),
        webSourceBodySha256: "7".repeat(64),
        webSourceFormat: "html",
        webSourceLineCount: 1,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
      })),
    };
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn() },
      workspaceRoot,
      webFetch,
    );
    const captured = await manager.execute(OWNER, {
      action: "capture_fetch",
      webSourceId: "websource_fixture0002",
      webSourceContentSha256: "6".repeat(64),
    });
    const cited = await manager.execute(OWNER, {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim,
    });
    const report = `${claim} [citation:${cited.details.citationId!}]\n`;
    await writeFile(path.join(workspaceRoot, "brief.md"), report);

    const verified = await manager.execute(OWNER, {
      action: "verify_report",
      path: "brief.md",
      expectedSha256: sha256(report),
    });

    expect(verified.details).toEqual(
      expect.objectContaining({
        action: "verify_report",
        reportFileSha256: sha256(report),
        reportCitationCount: 1,
        sourceCount: 1,
        citationCount: 1,
      }),
    );
  });

  it("settles only an exact Run-bound declared Markdown Artifact", async () => {
    const fixture = await reportArtifactFixture("brief.md");
    const manager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      fixture.workspaceRoot,
      undefined,
      undefined,
      undefined,
      fixture.store,
    );
    const captured = await manager.execute(fixture.owner, {
      action: "capture",
    });
    const claim = "Research Source fixture";
    const cited = await manager.execute(fixture.owner, {
      action: "cite",
      sourceId: captured.details.sourceId!,
      sourceContentSha256: captured.details.sourceContentSha256!,
      startLine: 1,
      endLine: 1,
      claim,
    });
    const report = `${claim} [citation:${cited.details.citationId!}]\n`;
    await writeFile(path.join(fixture.workspaceRoot, "brief.md"), report);

    const verified = await manager.execute(fixture.owner, {
      action: "verify_report",
      path: "brief.md",
      expectedSha256: sha256(report),
    });

    expect(verified.details.reportArtifactRegistration).toBe("registered");
    expect(fixture.store.getPlan(fixture.planId).artifacts[0]).toEqual(
      expect.objectContaining({
        status: "verified",
        sourceRunId: fixture.owner.runId,
        sha256: sha256(report),
        sizeBytes: Buffer.byteLength(report),
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.owner.threadId))
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    fixture.store.close();
  });

  it("keeps report verification successful when Plan settlement cannot apply", async () => {
    const noPlan = await reportArtifactFixture();
    const noPlanManager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      noPlan.workspaceRoot,
      undefined,
      undefined,
      undefined,
      noPlan.store,
    );
    const noPlanReport = await verifyFixtureReport(noPlanManager, noPlan);
    expect(noPlanReport.details.reportArtifactRegistration).toBe(
      "no_run_bound_plan",
    );
    noPlan.store.close();

    const mismatch = await reportArtifactFixture("other.md");
    const mismatchManager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      mismatch.workspaceRoot,
      undefined,
      undefined,
      undefined,
      mismatch.store,
    );
    const mismatchReport = await verifyFixtureReport(mismatchManager, mismatch);
    expect(mismatchReport.details.reportArtifactRegistration).toBe(
      "no_matching_artifact",
    );
    expect(mismatch.store.getPlan(mismatch.planId).artifacts[0]?.status).toBe(
      "expected",
    );
    mismatch.store.close();

    const failing = await reportArtifactFixture("brief.md");
    const failingManager = new RunResearchSourceManager(
      { capturePage: vi.fn(async () => sourceCapture()) },
      failing.workspaceRoot,
      undefined,
      undefined,
      undefined,
      failing.store,
    );
    failing.store.updatePlanArtifact = vi.fn(async () => {
      throw new Error("Injected report Artifact failure");
    });
    const failedRegistration = await verifyFixtureReport(
      failingManager,
      failing,
    );
    expect(failedRegistration.details).toEqual(
      expect.objectContaining({
        action: "verify_report",
        reportFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reportArtifactRegistration: "artifact_registration_failed",
      }),
    );
    failing.store.close();
  });

  it("rejects forged capture bindings, stale hashes, and invalid ranges", async () => {
    const capture = sourceCapture();
    const forged = {
      ...capture,
      textChars: capture.textChars + 1,
    };
    const manager = new RunResearchSourceManager({
      capturePage: vi.fn(async () => forged),
    });

    await expect(manager.execute(OWNER, { action: "capture" })).rejects.toThrow(
      "capture binding is invalid",
    );
    await expect(manager.execute(OWNER, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Research Sources captured in this Run.",
      }),
    );

    const unsafeTitle = sourceCapture({ title: "Unsafe\u001b title" });
    unsafeTitle.capturedContentSha256 = sha256(
      canonicalJson({
        url: unsafeTitle.url,
        title: unsafeTitle.title,
        lines: unsafeTitle.lines,
        truncated: unsafeTitle.truncated,
      }),
    );
    const unsafeTitleManager = new RunResearchSourceManager({
      capturePage: vi.fn(async () => unsafeTitle),
    });
    await expect(
      unsafeTitleManager.execute(OWNER, { action: "capture" }),
    ).rejects.toThrow("capture binding is invalid");

    const validManager = new RunResearchSourceManager({
      capturePage: vi.fn(async () => capture),
    });
    const captured = await validManager.execute(OWNER, { action: "capture" });
    await expect(
      validManager.execute(OWNER, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: "f".repeat(64),
        startLine: 1,
        endLine: 1,
        claim: "A stale claim.",
      }),
    ).rejects.toThrow("stale or invalid");
    await expect(
      validManager.execute(OWNER, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 4,
        claim: "An out-of-range claim.",
      }),
    ).rejects.toThrow("line range is invalid");
    await expect(
      validManager.execute(OWNER, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 1,
        claim: "A multiline\nclaim.",
      }),
    ).rejects.toThrow("claim is invalid");
  });

  it("isolates Sources by Run and removes live text at Run settlement", async () => {
    const capture = sourceCapture();
    const manager = new RunResearchSourceManager({
      capturePage: vi.fn(async () => capture),
    });
    const captured = await manager.execute(OWNER, { action: "capture" });
    const otherOwner = {
      threadId: OWNER.threadId,
      runId: "run_other",
    };

    await expect(
      manager.execute(otherOwner, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 1,
        claim: "Cross-Run claim.",
      }),
    ).rejects.toThrow("not found for this Run");
    await expect(
      manager.execute(otherOwner, {
        action: "verify_report",
        path: "brief.md",
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("citations not found for this Run");

    await manager.cancelRun(OWNER);
    await expect(
      manager.execute(OWNER, {
        action: "cite",
        sourceId: captured.details.sourceId!,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 1,
        claim: "Post-settlement claim.",
      }),
    ).rejects.toThrow("not found for this Run");
  });

  it("cancels active and queued captures without repopulating the Run", async () => {
    const started: Array<() => void> = [];
    const browser: BrowserSourceCaptureProvider = {
      capturePage: vi.fn(
        (_owner, _maxChars, signal) =>
          new Promise<BrowserPageSourceCapture>((_resolve, reject) => {
            started.push(() => undefined);
            signal?.addEventListener(
              "abort",
              () => reject(new Error("Browser capture cancelled")),
              { once: true },
            );
          }),
      ),
    };
    const manager = new RunResearchSourceManager(browser);
    const first = manager.execute(OWNER, { action: "capture" });
    const second = manager.execute(OWNER, { action: "capture" });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    await manager.cancelRun(OWNER);

    await expect(first).rejects.toThrow(
      "Research Source operation was cancelled",
    );
    await expect(second).rejects.toThrow(
      "Research Source operation was cancelled",
    );
    expect(browser.capturePage).toHaveBeenCalledTimes(1);
    await expect(manager.execute(OWNER, { action: "list" })).resolves.toEqual(
      expect.objectContaining({
        output: "No Research Sources captured in this Run.",
      }),
    );
  });

  it("enforces per-Run Source and citation limits", async () => {
    const capture = sourceCapture();
    const manager = new RunResearchSourceManager({
      capturePage: vi.fn(async () => capture),
    });
    let firstSourceId = "";
    for (let index = 0; index < 16; index += 1) {
      const result = await manager.execute(OWNER, { action: "capture" });
      firstSourceId ||= result.details.sourceId!;
    }
    await expect(manager.execute(OWNER, { action: "capture" })).rejects.toThrow(
      "Source limit reached",
    );

    for (let index = 0; index < 64; index += 1) {
      await manager.execute(OWNER, {
        action: "cite",
        sourceId: firstSourceId,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 1,
        claim: `Bounded claim ${String(index + 1)}.`,
      });
    }
    await expect(
      manager.execute(OWNER, {
        action: "cite",
        sourceId: firstSourceId,
        sourceContentSha256: capture.capturedContentSha256,
        startLine: 1,
        endLine: 1,
        claim: "One citation too many.",
      }),
    ).rejects.toThrow("citation limit reached");
  });
});

function sourceCapture(
  overrides: Partial<BrowserPageSourceCapture> = {},
): BrowserPageSourceCapture {
  const content = {
    url: "https://example.com/research",
    title: "Research Source fixture",
    lines: [
      "Research Source fixture",
      "Napier records immutable capture hashes.",
      "Citations bind exact line ranges to report claims.",
    ],
    truncated: false,
  };
  const capture: BrowserPageSourceCapture = {
    ...content,
    textChars: content.lines.join("\n").length,
    capturedContentSha256: sha256(canonicalJson(content)),
    sessionOperation: 2,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 2,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 512,
      destinationCount: 1,
      destinationsSha256: "5".repeat(64),
    },
    ...overrides,
  };
  return capture;
}

async function reportArtifactFixture(artifactPath?: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-report-artifact-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Research report Artifact",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    source: "user",
  });
  let planId = "";
  if (artifactPath) {
    let plan = await store.createPlan(thread.id, {
      objective: "Verify one citation-backed report.",
      steps: [
        {
          id: "report",
          title: "Verify report",
          description: "Create and verify the report.",
          verification: "The declared report Artifact is verified.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: artifactPath,
          kind: "file",
          description: "Citation-backed Markdown report.",
        },
      ],
    });
    plan = await store.transitionPlanStep(plan.id, "report", {
      action: "start",
      runId: run.id,
    });
    planId = plan.id;
  }
  return {
    store,
    workspaceRoot,
    planId,
    owner: { threadId: thread.id, runId: run.id },
  };
}

async function verifyFixtureReport(
  manager: RunResearchSourceManager,
  fixture: Awaited<ReturnType<typeof reportArtifactFixture>>,
) {
  const captured = await manager.execute(fixture.owner, { action: "capture" });
  const claim = "Research Source fixture";
  const cited = await manager.execute(fixture.owner, {
    action: "cite",
    sourceId: captured.details.sourceId!,
    sourceContentSha256: captured.details.sourceContentSha256!,
    startLine: 1,
    endLine: 1,
    claim,
  });
  const report = `${claim} [citation:${cited.details.citationId!}]\n`;
  await writeFile(path.join(fixture.workspaceRoot, "brief.md"), report);
  return manager.execute(fixture.owner, {
    action: "verify_report",
    path: "brief.md",
    expectedSha256: sha256(report),
  });
}

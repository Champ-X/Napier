import { describe, expect, it, vi } from "vitest";

import type {
  BrowserPageSourceCapture,
  BrowserSessionOwner,
} from "../src/browser-session.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  type BrowserSourceCaptureProvider,
  RunResearchSourceManager,
} from "../src/research-sources.js";

const OWNER = { threadId: "thread_research", runId: "run_research" };

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

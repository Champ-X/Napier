import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  browserToolCallArgumentsLedgerProjection,
  browserToolInputLedgerProjection,
  browserToolOutputLedgerProjection,
  createBrowserTool,
} from "../src/browser-tool.js";
import {
  type BrowserSessionDetails,
  RunBrowserSessionManager,
} from "../src/browser-session.js";
import { assessToolCall } from "../src/policy.js";
import { DEFAULT_AGENT_ENABLED_TOOLS } from "../src/read-only-tool-names.js";

describe("browser Agent tool", () => {
  it("allows read-only Browser actions by default and confines interactive actions", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "observe",
        "browser",
        { action: "start", url: "https://example.com" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
        reason: "read-only isolated public-network Browser Session",
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "browser",
        { action: "start", url: "https://127.0.0.1/private" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        risk: "critical",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "browser",
        { action: "click", target: { ref: "e1" } },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        risk: "high",
        reason: "interactive Browser actions require unrestricted policy",
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "browser",
        { action: "click", target: { ref: "e1" } },
        workspace,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "high" }));
    expect(
      assessToolCall(
        "unrestricted",
        "browser",
        { action: "download", path: "../escape.txt" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "writes must target a path inside the workspace",
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "browser",
        { action: "download", path: ".git/config" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: expect.stringContaining("protected"),
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "research_source",
        { action: "capture", maxChars: 12_000 },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
        reason: "Run-local Browser Source and report verification",
      }),
    );
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining(["browser", "research_source"]),
    );
  });

  it("redacts URLs, selectors, text, paths, values, and live output", () => {
    const args = {
      action: "type",
      url: "https://example.com/?token=raw-url-secret",
      target: { selector: "#raw-selector-secret" },
      text: "raw-text-secret",
      path: "raw-path-secret.txt",
      values: ["raw-value-secret"],
      allowCrossOrigin: true,
    };
    const call = browserToolCallArgumentsLedgerProjection(args);
    const input = browserToolInputLedgerProjection(args);
    const output = browserToolOutputLedgerProjection("raw-page-output-secret", {
      details: details("type"),
    });
    const serialized = JSON.stringify({ call, input, output });

    for (const secret of [
      "raw-url-secret",
      "raw-selector-secret",
      "raw-text-secret",
      "raw-path-secret",
      "raw-value-secret",
      "raw-page-output-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(call).toEqual(
      expect.objectContaining({
        action: "type",
        textBytes: 15,
        valueCount: 1,
        crossOriginAuthorized: true,
        redacted: true,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputBytes: 22,
      }),
    );
  });

  it("returns screenshots as live image content while details remain bounded", async () => {
    const execute = vi.fn(async () => ({
      output: "Screenshot complete",
      details: details("screenshot"),
      screenshot: {
        data: Buffer.from("png").toString("base64"),
        mimeType: "image/png" as const,
      },
    }));
    const tool = createBrowserTool(
      { execute } as unknown as RunBrowserSessionManager,
      { threadId: "thread_one", runId: "run_one" },
    );

    const result = await tool.execute("call_one", { action: "screenshot" });
    expect(result.content).toEqual([
      { type: "text", text: "Screenshot complete" },
      {
        type: "image",
        data: Buffer.from("png").toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(JSON.stringify(result.details)).not.toContain(
      Buffer.from("png").toString("base64"),
    );
  });

  it("classifies navigation/read lifecycle separately from interaction", () => {
    expect(builtInToolEffect("browser", { action: "start" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "navigate" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "back" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "wait" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "snapshot" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "screenshot" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "close" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "click" })).toBe("write");
    expect(builtInToolEffect("browser", { action: "download" })).toBe("write");
  });
});

function details(
  action: BrowserSessionDetails["action"],
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 1,
    action,
    sessionMode: "run_persistent",
    sessionReused: true,
    sessionOperation: 2,
    sessionIdSha256: "a".repeat(64),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    screenshotSha256: "2".repeat(64),
    screenshotBytes: 3,
    blockedRequestCount: 0,
    network: {
      requestCount: 1,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 10,
      destinationCount: 1,
      destinationsSha256: "3".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}

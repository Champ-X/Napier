import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  browserToolCallArgumentsLedgerProjection,
  browserInteractionConfirmationPreview,
  browserToolInputLedgerProjection,
  browserToolOutputLedgerProjection,
  createBrowserTool,
} from "../src/browser-tool.js";
import {
  type BrowserSessionDetails,
  RunBrowserSessionManager,
} from "../src/browser-session.js";
import { createBrowserConfirmationPageState } from "../src/browser-confirmed-action.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
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
        {
          action: "preview_workspace",
          path: "kakeya-conjecture/index.html",
        },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "browser",
        { action: "preview_workspace", path: "../escape.html" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: expect.stringContaining("workspace-relative HTML"),
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "browser",
        { action: "preview_workspace", path: ".napier/private.html" },
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
        "browser",
        { action: "find", query: "private query" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "browser",
        { action: "scroll", direction: "down", pixels: 720 },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
      }),
    );
    expect(
      assessToolCall("observe", "browser", { action: "console" }, workspace),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "low",
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
        reason: "interactive Browser actions require a writable Agent policy",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "browser",
        { action: "click", target: { ref: "e1" } },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
        reason: expect.stringContaining("action-bound confirmation"),
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "browser",
        { action: "click", target: { ref: "e1" } },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
        reason: expect.stringContaining("action-bound confirmation"),
      }),
    );
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
        "workspace",
        "browser",
        {
          action: "save_screenshot",
          path: "artifacts/page.png",
          expectedLiveImageSha256: "a".repeat(64),
        },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
        reason: expect.stringContaining("action-bound confirmation"),
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "browser",
        {
          action: "save_screenshot",
          path: "artifacts/page.jpg",
          expectedLiveImageSha256: "not-a-hash",
        },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: expect.stringContaining("exact prior screenshot hash"),
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
      action: "find",
      url: "https://example.com/?token=raw-url-secret",
      target: { selector: "#raw-selector-secret" },
      text: "raw-text-secret",
      query: "raw-find-secret",
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
      "raw-find-secret",
      "raw-path-secret",
      "raw-value-secret",
      "raw-page-output-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(call).toEqual(
      expect.objectContaining({
        action: "find",
        textBytes: 15,
        queryChars: 15,
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

  it("runs Browser calls sequentially and previews interaction effects by hash", () => {
    const tool = createBrowserTool(
      { execute: vi.fn() } as unknown as RunBrowserSessionManager,
      { threadId: "thread_preview", runId: "run_preview" },
    );
    expect(tool.executionMode).toBe("sequential");
    expect(
      browserInteractionConfirmationPreview({
        action: "type",
        target: { selector: "#PRIVATE_TARGET" },
        text: "PRIVATE_TEXT",
      }),
    ).toEqual({
      targetKind: "selector",
      targetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      textSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      textBytes: 12,
      crossOriginAuthorized: false,
    });
    expect(
      JSON.stringify(
        browserInteractionConfirmationPreview({
          action: "download",
          target: { ref: "e1" },
          path: "PRIVATE_PATH",
          allowCrossOrigin: true,
        }),
      ),
    ).not.toContain("PRIVATE");
    expect(
      browserInteractionConfirmationPreview({
        action: "save_screenshot",
        path: "PRIVATE_SCREENSHOT.png",
        expectedLiveImageSha256: "a".repeat(64),
      }),
    ).toEqual({
      pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sourceImageSha256: "a".repeat(64),
      crossOriginAuthorized: false,
    });
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

  it("tells the model when exact one-use Browser approval was consumed", async () => {
    const pageState = createBrowserConfirmationPageState({
      sessionOperation: 1,
      sessionIdSha256: "a".repeat(64),
      activeTabId: "tab_1",
      tabCount: 1,
      tabSetSha256: sha256(canonicalJson(["tab_1"])),
      currentUrlSha256: "e".repeat(64),
      currentOriginSha256: "f".repeat(64),
      targetStateSha256: sha256("target"),
      targetEffect: "interaction",
      targetSensitivity: "ordinary",
      targetSensitivitySha256: sha256(canonicalJson([])),
    });
    const executeConfirmedAction = vi.fn(async () => ({
      output: "Browser CLICK complete.",
      details: details("click"),
    }));
    const consume = vi.fn(() => pageState);
    const tool = createBrowserTool(
      { executeConfirmedAction } as unknown as RunBrowserSessionManager,
      { threadId: "thread_confirm", runId: "run_confirm" },
      { actionConfirmations: { consume } },
    );

    const result = await tool.execute("call_confirm", {
      action: "click",
      target: { ref: "e1" },
      allowCrossOrigin: false,
    });

    expect(consume).toHaveBeenCalledOnce();
    expect(executeConfirmedAction).toHaveBeenCalledWith(
      { threadId: "thread_confirm", runId: "run_confirm" },
      {
        action: "click",
        target: { ref: "e1" },
        allowCrossOrigin: false,
      },
      pageState,
      undefined,
    );
    expect(result.content).toEqual([
      {
        type: "text",
        text: [
          "Confirmation consumed: Napier received and consumed the exact one-use user approval for this Browser action before execution.",
          "Approved effect: interaction.",
          `Confirmed page state SHA-256: ${pageState.contentSha256}.`,
          "Browser CLICK complete.",
        ].join("\n"),
      },
    ]);
  });

  it("registers confirmed Browser file outputs through the standard Plan path", async () => {
    const outputArtifacts = {
      register: vi.fn(async () => ({
        status: "registered" as const,
        reason: "artifact_registered" as const,
        planId: "plan_browser_output",
        artifactId: "browser-output",
      })),
    };
    const execute = vi.fn(async () => ({
      output: "Browser SAVE_SCREENSHOT complete.",
      details: {
        ...details("save_screenshot"),
        file: {
          pathSha256: sha256("artifacts/page.png"),
          fileSha256: "9".repeat(64),
          fileBytes: 123,
        },
      },
    }));
    const tool = createBrowserTool(
      { execute } as unknown as RunBrowserSessionManager,
      { threadId: "thread_output", runId: "run_output" },
      { outputArtifacts },
    );

    const result = await tool.execute("call_output", {
      action: "save_screenshot",
      path: "artifacts/page.png",
      expectedLiveImageSha256: "9".repeat(64),
    });

    expect(execute).toHaveBeenCalledWith(
      { threadId: "thread_output", runId: "run_output" },
      {
        action: "save_screenshot",
        path: "artifacts/page.png",
        expectedLiveImageSha256: "9".repeat(64),
      },
      undefined,
    );
    expect(outputArtifacts.register).toHaveBeenCalledWith(
      { threadId: "thread_output", runId: "run_output" },
      {
        action: "save_screenshot",
        path: "artifacts/page.png",
        pathSha256: sha256("artifacts/page.png"),
        fileSha256: "9".repeat(64),
        fileBytes: 123,
      },
    );
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Browser SAVE_SCREENSHOT complete.\nPlan Artifact: verified",
      },
    ]);
  });

  it("classifies navigation/read lifecycle separately from interaction", () => {
    expect(builtInToolEffect("browser", { action: "start" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "navigate" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "back" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "forward" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "tab_new" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "tab_list" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "tab_switch" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "tab_close" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "wait" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "find" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "scroll" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "snapshot" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "screenshot" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "close" })).toBe("read");
    expect(builtInToolEffect("browser", { action: "click" })).toBe("write");
    expect(builtInToolEffect("browser", { action: "download" })).toBe("write");
    expect(builtInToolEffect("browser", { action: "save_screenshot" })).toBe(
      "write",
    );
  });
});

function details(
  action: BrowserSessionDetails["action"],
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 2,
    action,
    sessionMode: "run_persistent",
    sessionReused: true,
    sessionOperation: 2,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
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

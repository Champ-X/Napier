import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserTaskRunner } from "../src/use-browser-task-runner";

let container: HTMLElement | undefined;

describe("Browser workspace Chinese UI", () => {
  afterEach(() => {
    if (container) render(null, container);
    container = undefined;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("localizes task setup and both backend disclosures", async () => {
    container = installChineseDom();
    const { BrowserTaskForm } = await import("../src/BrowserTaskForm");
    const { BrowserTaskDisclosure } =
      await import("../src/BrowserTaskDisclosure");

    render(
      <>
        <BrowserTaskForm runner={runner()} defaults={defaults()} />
        <BrowserTaskDisclosure backend="browser_use_cloud" />
      </>,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("执行后端");
    expect(text).toContain("Browser Use 本地");
    expect(text).toContain("可见的本地浏览器与人工接管");
    expect(text).toContain("云端数据与计费边界");
    expect(text).toContain("启动本地任务");
    expect(text).toContain("模型提供方");
    expect(text).not.toContain("Execution backend");
  });

  it("localizes hash-bound confirmation without exposing private values", async () => {
    container = installChineseDom();
    const { BrowserInteractionConfirmationPanel } =
      await import("../src/BrowserInteractionConfirmationPanel");
    render(
      <BrowserInteractionConfirmationPanel
        confirmation={confirmation()}
        busy={false}
        onDecision={async () => undefined}
      />,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("确认 输入");
    expect(text).toContain("输入数据");
    expect(text).toContain("仅批准一次");
    expect(text).toContain("aaaaaaaaaaaa");
    expect(text).not.toContain("PRIVATE_TEXT");
    expect(text).not.toContain("Approve once");
  });

  it("localizes live diagnosis and preserves technical session evidence", async () => {
    container = installChineseDom();
    const { BrowserLiveViewSurface } =
      await import("../src/BrowserLiveViewSurface");
    render(
      <BrowserLiveViewSurface
        threadId="thread_browser_zh"
        runId="run_browser_zh"
        imageUrl="blob:browser-live"
        receipt={liveReceipt()}
        paused={false}
        takeoverOpen={false}
        refreshing={false}
        controlBusy={false}
        controlFailed={false}
        activity={{ state: "idle", label: "智能体 · 等待中" }}
        onTogglePause={async () => undefined}
        onOpenTakeover={async () => undefined}
        onRefresh={async () => undefined}
        onOperatorAction={() => undefined}
        onReturnToAgent={async () => undefined}
      />,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("浏览器实时视图");
    expect(text).toContain("需要登录");
    expect(text).toContain("隔离的浏览器配置");
    expect(text).toContain("tab_zh");
    expect(text).toContain("cccccccccc");
    expect(text).not.toContain("Login required");
  });
});

function installChineseDom(): HTMLElement {
  vi.resetModules();
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  return document.getElementById("app") as unknown as HTMLElement;
}

function runner(): BrowserTaskRunner {
  return {
    events: [],
    status: "idle",
    busy: false,
    canRetry: false,
    start: async () => undefined,
    retry: async () => undefined,
    stop: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    takeover: async () => undefined,
  };
}

function defaults() {
  return {
    defaultModel: { provider: "openai" as const, id: "gpt-test" },
    defaultCredentialEnv: "OPENAI_API_KEY",
    defaultMaxSteps: 12,
    models: [],
    credentials: [],
  };
}

function confirmation() {
  return {
    kind: "napier.browser-interaction-confirmation" as const,
    schemaVersion: 1 as const,
    id: "browser_confirm_abcdefghijklmnopqrst" as const,
    threadId: "thread_browser_zh",
    runId: "run_browser_zh",
    callId: "call_browser_zh",
    action: "type" as const,
    argumentsSha256: "a".repeat(64),
    preview: {
      targetKind: "ref" as const,
      targetSha256: "d".repeat(64),
      effect: "data_entry" as const,
      textSha256: "e".repeat(64),
      textBytes: 12,
      crossOriginAuthorized: false,
    },
    status: "pending" as const,
    requestedAt: "2026-08-19T08:00:00.000Z",
    expiresAt: "2026-08-19T08:01:00.000Z",
    requestSha256: "b".repeat(64),
    contentSha256: "c".repeat(64),
  };
}

function liveReceipt(): BrowserLiveViewReceipt {
  return {
    kind: "napier.browser-live-view",
    schemaVersion: 4,
    threadId: "thread_browser_zh",
    runId: "run_browser_zh",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: 4,
    activeTabId: "tab_zh",
    tabCount: 2,
    tabSetSha256: "9".repeat(64),
    imageSha256: "8".repeat(64),
    imageBytes: 128,
    mimeType: "image/png",
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: "2026-08-19T08:00:00.000Z",
    currentUrlSha256: "b".repeat(64),
    currentOriginSha256: "c".repeat(64),
    titleSha256: "d".repeat(64),
    browserExecutableSha256: "e".repeat(64),
    browserVersionSha256: "f".repeat(64),
    limitsSha256: "1".repeat(64),
    networkRequestCount: 5,
    blockedRequestCount: 2,
    pageDiagnosis: {
      status: "login_required",
      signalCount: 2,
      signalsSha256: "2".repeat(64),
      takeoverRecommended: true,
    },
    contentSha256: "3".repeat(64),
  };
}

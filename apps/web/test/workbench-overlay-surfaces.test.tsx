import type { RunEvent } from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type { BrowserLiveViewReceipt } from "@napier/contracts/browser-live-view";
import type { BrowserTakeoverSnapshot } from "@napier/contracts/browser-takeover";
import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LedgerNavigation } from "../src/LedgerNavigation";
import { SkillResourceInspector } from "../src/SkillResourceInspector";
import { WorkbenchBrowserRail } from "../src/WorkbenchBrowserRail";
import { previewSkillResource } from "../src/skill-resource-api";
import {
  getBrowserSessionPauseState,
  resumeBrowserSession,
} from "../src/browser-session-control-api";
import {
  getBrowserTakeoverSnapshot,
  executeBrowserTakeoverAction,
} from "../src/browser-takeover-api";
import { streamBrowserLiveViews } from "../src/browser-live-view-stream-api";
import type { WorkspaceLayoutControls } from "../src/use-workspace-layout";

// Mock the network boundary, retaining the real browser controller, takeover
// form, inspector and navigation state. This does not verify live HTTP/browser.
vi.mock("../src/skill-resource-api", () => ({ previewSkillResource: vi.fn() }));
vi.mock("../src/browser-session-control-api", () => ({
  getBrowserSessionPauseState: vi.fn(),
  pauseBrowserSession: vi.fn(),
  resumeBrowserSession: vi.fn(),
}));
vi.mock("../src/browser-takeover-api", () => ({
  getBrowserTakeoverSnapshot: vi.fn(),
  executeBrowserTakeoverAction: vi.fn(),
}));
vi.mock("../src/browser-live-view-stream-api", () => ({
  streamBrowserLiveViews: vi.fn(),
}));
vi.mock("../src/WorkspaceTree", () => ({ WorkspaceTree: () => null }));

const roots: Root[] = [];
const noop = () => undefined;

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("stateful workbench surfaces under shell overlays", () => {
  it("retains the actual takeover form and controller without resuming the browser", async () => {
    const { root, container } = installDom();
    vi.mocked(getBrowserSessionPauseState).mockResolvedValue({
      kind: "napier.browser-session-pause-state",
      schemaVersion: 1,
      threadId: "thread_overlay",
      runId: "run_overlay",
      status: "paused",
      pauseRequestedAt: "2026-10-29T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    });
    vi.mocked(streamBrowserLiveViews).mockImplementation(
      async (_thread, _run, onImage) => {
        onImage({
          blob: new Blob(["fixture"]),
          receipt: liveReceipt(),
          sequence: 1,
        });
        return {
          type: "browser_live_view_end",
          schemaVersion: 1,
          reason: "image_byte_limit",
          sampleCount: 1,
          frameCount: 1,
          duplicateCount: 0,
          emittedImageBytes: 7,
          contentSha256: "a".repeat(64),
        };
      },
    );
    vi.mocked(getBrowserTakeoverSnapshot).mockResolvedValue(takeoverSnapshot());
    const render = (suspended: boolean) =>
      act(async () =>
        root.render(
          <WorkbenchBrowserRail
            threadId="thread_overlay"
            runId="run_overlay"
            events={browserEvents}
            suspended={suspended}
            onClose={noop}
          />,
        ),
      );
    await render(false);
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(container.querySelector(".browser-session-toggle")).not.toBeNull();
    });
    const takeoverButton = buttons(container).find(
      (button) => button.textContent === "Take control",
    )!;
    expect(takeoverButton).toBeDefined();
    await act(async () => takeoverButton.click());
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(
        container
          .querySelector(".browser-takeover-new-tab")
          ?.querySelector("[type=url]"),
      ).toBeTruthy();
    });
    const rail = container.querySelector<HTMLElement>(
      ".workbench-browser-rail",
    )!;
    const desk = container.querySelector(".browser-takeover-desk");
    const tabInput = container
      .querySelector(".browser-takeover-new-tab")
      ?.querySelector<HTMLInputElement>("[type=url]")!;
    await input(tabInput, "https://example.test/unsent");
    const snapshotCalls = vi.mocked(getBrowserTakeoverSnapshot).mock.calls
      .length;
    const streamCalls = vi.mocked(streamBrowserLiveViews).mock.calls.length;

    await render(true);
    expect(container.querySelector(".workbench-browser-rail")).toBe(rail);
    expect(rail.hidden).toBe(true);
    expect(rail.inert).toBe(true);
    expect(rail.style.display).toBe("none");
    await render(false);
    expect(rail.hidden).toBe(false);
    expect(rail.inert).toBe(false);
    expect(container.querySelector(".browser-takeover-desk")).toBe(desk);
    expect(
      container
        .querySelector(".browser-takeover-new-tab")
        ?.querySelector("[type=url]"),
    ).toBe(tabInput);
    expect(tabInput.value).toBe("https://example.test/unsent");
    expect(
      container
        .querySelector(".browser-live-view")
        ?.classList.contains("has-takeover"),
    ).toBe(true);
    expect(getBrowserTakeoverSnapshot).toHaveBeenCalledTimes(snapshotCalls);
    expect(streamBrowserLiveViews).toHaveBeenCalledTimes(streamCalls);
    expect(resumeBrowserSession).not.toHaveBeenCalled();
    expect(executeBrowserTakeoverAction).not.toHaveBeenCalled();
  });

  it("passes suspension to a skill resource preview and keeps its source selection", async () => {
    const { root, container } = installDom();
    const onClose = vi.fn();
    const text = "# Skill resource\nRetained source view";
    vi.mocked(previewSkillResource).mockResolvedValue({
      path: "/project/.agents/skills/sample/references/guide.md",
      filename: "guide.md",
      contentType: "text/markdown",
      blob: new Blob([text]),
      sizeBytes: text.length,
      sha256: "a".repeat(64),
      text,
    });
    const reference = {
      skillName: "sample",
      resourcePath: "references/guide.md",
      relativePath: ".agents/skills/sample/references/guide.md",
      virtualPath: "/project/.agents/skills/sample/references/guide.md",
      rootKind: "project_standard" as const,
      rawContentSha256: "a".repeat(64),
    };
    const render = (suspended: boolean) =>
      act(async () =>
        root.render(
          <SkillResourceInspector
            reference={reference}
            suspended={suspended}
            onClose={onClose}
          />,
        ),
      );
    await render(false);
    const inspector = container.querySelector<HTMLElement>(
      ".artifact-inspector",
    )!;
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(
        buttons(inspector).map((button) => button.textContent?.trim()),
      ).toContain("Raw source");
    });
    const source = buttons(inspector).find(
      (button) => button.textContent?.trim() === "Raw source",
    )!;
    await act(async () => source.click());
    expect(source.getAttribute("aria-pressed")).toBe("true");
    await render(true);
    await act(async () => window.dispatchEvent(escapeEvent()));
    expect(inspector.hidden).toBe(true);
    expect(inspector.inert).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await render(false);
    expect(container.querySelector(".artifact-inspector")).toBe(inspector);
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(previewSkillResource).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(escapeEvent()));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("suspends mobile navigation Escape handling and retains its controlled search", async () => {
    const { root, container } = installDom();
    const closeSidebar = vi.fn();
    const layout: WorkspaceLayoutControls = {
      collapsed: true,
      compactViewport: true,
      mobileNavigationOpen: true,
      navigationWidth: 252,
      navigationMax: 252,
      evidenceWidth: 360,
      evidenceMax: 360,
      workspaceRailAvailable: false,
      closeSidebar,
      openSidebar: noop,
      toggleSidebar: noop,
      setNavigationWidth: noop,
      setEvidenceWidth: noop,
      resetNavigationWidth: noop,
      resetEvidenceWidth: noop,
    };
    // The navigation consumes only these bootstrap fields; tree loading is
    // mocked because this test exercises navigation's own state/listeners.
    const bootstrap = {
      workspace: { root: "/fixture" },
      threads: [],
    } as unknown as LiveReadyBootstrapResponse;
    const onWorkspaceSwitch = async () => undefined;
    const render = (suspended: boolean) =>
      act(async () =>
        root.render(
          <LedgerNavigation
            bootstrap={bootstrap}
            selectedThreadId={undefined}
            busyThreadId={undefined}
            newThreadBusy={false}
            onNewThread={noop}
            onSelect={noop}
            onTrash={noop}
            onWorkspaceSwitch={onWorkspaceSwitch}
            onOpenDeveloperWorkbench={noop}
            onOpenSettings={noop}
            layout={layout}
            suspended={suspended}
          />,
        ),
      );
    await render(false);
    const navigation = container.querySelector<HTMLElement>(".ledger-nav")!;
    const search =
      container.querySelector<HTMLInputElement>('[type="search"]')!;
    await input(search, "unsent search");
    await render(true);
    expect(navigation.hidden).toBe(true);
    expect(container.querySelector('[type="search"]')).toBe(search);
    expect(container.querySelector(".ledger-nav-backdrop")).toBeNull();
    await act(async () => document.dispatchEvent(escapeEvent()));
    expect(closeSidebar).not.toHaveBeenCalled();
    await render(false);
    expect(container.querySelector(".ledger-nav")).toBe(navigation);
    expect(navigation.classList.contains("is-mobile-open")).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>('[type="search"]')?.value,
    ).toBe("unsent search");
    navigation.inert = true;
    await act(async () => document.dispatchEvent(escapeEvent()));
    expect(closeSidebar).not.toHaveBeenCalled();
    navigation.inert = false;
    const escape = escapeEvent();
    await act(async () => document.dispatchEvent(escape));
    expect(closeSidebar).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(true);
  });
});

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    (_callback: FrameRequestCallback) => 0,
  );
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("inert");
    },
    set(this: HTMLElement, value: boolean) {
      this.toggleAttribute("inert", value);
    },
  });
  const container = document.getElementById("app") as unknown as HTMLElement;
  const root = createRoot(container);
  roots.push(root);
  return { root, container };
}

async function input(target: HTMLInputElement, value: string) {
  await act(async () => {
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttons(root: Element): HTMLButtonElement[] {
  return Array.from(root.children).flatMap((child) => [
    ...(child.localName === "button" ? [child as HTMLButtonElement] : []),
    ...buttons(child),
  ]);
}

function escapeEvent() {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: "Escape" });
  return event;
}

const browserEvents: RunEvent[] = [
  {
    id: "event_overlay",
    threadId: "thread_overlay",
    runId: "run_overlay",
    seq: 1,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-10-29T00:00:00.000Z",
    payload: { toolName: "browser", details: { action: "start" } },
  },
];

function liveReceipt(): BrowserLiveViewReceipt {
  return {
    kind: "napier.browser-live-view",
    schemaVersion: 4,
    threadId: "thread_overlay",
    runId: "run_overlay",
    sessionIdSha256: "b".repeat(64),
    sessionOperation: 2,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "c".repeat(64),
    imageSha256: "d".repeat(64),
    imageBytes: 7,
    mimeType: "image/png",
    viewportWidth: 1280,
    viewportHeight: 900,
    capturedAt: "2026-10-29T00:00:00.000Z",
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    networkRequestCount: 0,
    blockedRequestCount: 0,
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: "5".repeat(64),
      takeoverRecommended: false,
    },
    contentSha256: "6".repeat(64),
  };
}

function takeoverSnapshot(): BrowserTakeoverSnapshot {
  return {
    kind: "napier.browser-takeover-snapshot",
    schemaVersion: 2,
    threadId: "thread_overlay",
    runId: "run_overlay",
    pauseStateSha256: "a".repeat(64),
    sessionIdSha256: "b".repeat(64),
    sessionOperation: 2,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "c".repeat(64),
    tabs: [
      {
        tabId: "tab_1",
        active: true,
        url: "https://example.test/",
        currentUrlSha256: "e".repeat(64),
        title: "Fixture",
        titleSha256: "1".repeat(64),
      },
    ],
    snapshot: "",
    snapshotSha256: "7".repeat(64),
    snapshotChars: 0,
    snapshotTruncated: false,
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    capturedAt: "2026-10-29T00:00:00.000Z",
    contentSha256: "8".repeat(64),
  };
}

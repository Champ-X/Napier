import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchOverlay } from "../src/use-workbench-overlay";
import { useWorkspaceShell } from "../src/use-workspace-shell";
import { ArtifactInspector } from "../src/ArtifactInspector";
import { WorkspaceFileInspector } from "../src/WorkspaceFileInspector";
import type { ArtifactInspection } from "../src/artifact-inspection";
import { restoreWorkbenchOverlayFocus } from "../src/workbench-overlay-focus";

const roots: Root[] = [];
type Shell = ReturnType<typeof useWorkspaceShell>;
type EvidenceKind = "rail" | "artifact" | "none";
const setInspectorTab = () => undefined;

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("workbench overlay suspension", () => {
  it.each(["body", "documentElement"] as const)(
    "returns to a visible control when async opening captured document %s",
    (name) => {
      const dom = installDom();
      const fallback = document.createElement("button");
      fallback.id = "workspace-rail-toggle";
      dom.container.append(fallback);
      restoreWorkbenchOverlayFocus(document[name]);
      expect(document.activeElement).toBe(fallback);
    },
  );

  const entryPoints: Array<[string, (shell: Shell) => void]> = [
    ["Settings button", (shell) => shell.openSettings()],
    ["Developer button", (shell) => shell.openDeveloperWorkbench()],
    ["Settings inspector route", (shell) => shell.routeInspector("extensions")],
    ["Developer inspector route", (shell) => shell.routeInspector("lab")],
    ["Command-comma shortcut", () => dispatchShortcut("metaKey")],
    ["Control-comma shortcut", () => dispatchShortcut("ctrlKey")],
  ];

  it.each(entryPoints)(
    "captures the %s opener before a child moves focus and preserves mounted drafts",
    async (_label, open) => {
      const probe = await mountProbe("rail");
      const opener = probe.element("evidence-opener");
      const composer = probe.input("composer-draft");
      const sidebar = probe.input("sidebar-draft");
      const evidence = probe.input("evidence-draft");
      composer.value = "Unsent composer draft";
      sidebar.value = "Unsubmitted sidebar search";
      evidence.value = "Unsubmitted evidence note";
      opener.focus();

      await probe.update(open);
      expect(probe.shell().overlayReturnFocusRef.current).toBe(opener);
      expect(document.activeElement).toBe(probe.element("overlay-control"));
      expect(probe.main.inert).toBe(true);
      expect(probe.navigation.inert).toBe(true);

      await probe.closeOverlay();
      expect(probe.main.inert).toBe(false);
      expect(probe.navigation.inert).toBe(false);
      expect(
        probe.focusCalls.filter((call) => call.element === opener),
      ).toHaveLength(1);
      await probe.flushFrames();
      expect(document.activeElement).toBe(opener);
      expect(probe.focusCalls.some((call) => call.inert)).toBe(false);
      expect(probe.input("composer-draft")).toBe(composer);
      expect(probe.input("sidebar-draft")).toBe(sidebar);
      expect(probe.input("evidence-draft")).toBe(evidence);
      expect([composer.value, sidebar.value, evidence.value]).toEqual([
        "Unsent composer draft",
        "Unsubmitted sidebar search",
        "Unsubmitted evidence note",
      ]);
    },
  );

  it("keeps the original return target when Settings switches to Developer", async () => {
    const probe = await mountProbe("artifact");
    const opener = probe.element("evidence-opener");
    opener.focus();
    await probe.update((shell) => shell.openSettings());
    const settingsControl = probe.element("overlay-control");
    expect(document.activeElement).toBe(settingsControl);

    await probe.update((shell) => shell.openDeveloperWorkbench());
    expect(probe.shell().settingsOpen).toBe(false);
    expect(probe.shell().developerWorkbenchOpen).toBe(true);
    expect(probe.shell().overlayReturnFocusRef.current).toBe(opener);
    expect(document.activeElement).toBe(probe.element("overlay-control"));
    expect(document.activeElement).not.toBe(settingsControl);
    expect(probe.main.inert).toBe(true);
    await probe.flushFrames();
    expect(probe.main.inert).toBe(true);

    await probe.closeOverlay();
    await probe.flushFrames();
    expect(document.activeElement).toBe(opener);
    expect(probe.focusCalls.some((call) => call.inert)).toBe(false);
  });

  it.each(["rail", "artifact"] as const)(
    "returns to the resumed %s modal when its opener was outside that modal",
    async (kind) => {
      const probe = await mountProbe(kind);
      probe.element("navigation-opener").focus();
      await probe.update((shell) => shell.openSettings());
      await probe.closeOverlay();
      await probe.flushFrames();
      expect(document.activeElement).toBe(probe.element("evidence-first"));
      expect(probe.focusCalls.some((call) => call.inert)).toBe(false);
    },
  );

  it.each(["removed", "hidden", "disabled"] as const)(
    "falls back inside the resumed evidence modal when the saved opener is %s",
    async (invalidity) => {
      const probe = await mountProbe("rail");
      const opener = probe.element("evidence-opener");
      opener.focus();
      await probe.update((shell) => shell.openSettings());
      await probe.invalidateOpener(invalidity);
      await probe.closeOverlay();
      await probe.flushFrames();
      expect(document.activeElement).toBe(probe.element("evidence-first"));
      expect(
        probe.focusCalls.filter((call) => call.element === opener),
      ).toHaveLength(1);
    },
  );

  it("does not let a queued restore move focus behind a newly opened overlay", async () => {
    const probe = await mountProbe("rail");
    probe.element("evidence-opener").focus();
    await probe.update((shell) => shell.openSettings());
    await probe.closeOverlay();
    // Do not flush the previous overlay's scheduled focus restoration yet.
    await probe.update((shell) => shell.openDeveloperWorkbench());
    const developerControl = probe.element("overlay-control");
    await probe.flushFrames();
    expect(probe.main.inert).toBe(true);
    expect(document.activeElement).toBe(developerControl);
    expect(probe.focusCalls.some((call) => call.inert)).toBe(false);

    await probe.closeOverlay();
    await probe.flushFrames();
    expect(probe.main.inert).toBe(false);
    expect(
      probe.element("evidence-surface").contains(document.activeElement),
    ).toBe(true);
  });

  it("restores existing inert state and the ordinary opener when no evidence modal resumes", async () => {
    const probe = await mountProbe("none");
    probe.navigation.inert = true;
    const opener = probe.element("main-opener");
    opener.focus();
    await probe.update((shell) => shell.openSettings());
    await probe.closeOverlay();
    expect(probe.navigation.inert).toBe(true);
    expect(probe.main.inert).toBe(false);
    await probe.flushFrames();
    expect(document.activeElement).toBe(opener);
    expect(probe.focusCalls.some((call) => call.inert)).toBe(false);
  });

  it("invalidates an older return target across close, reopen and close before a frame", async () => {
    const probe = await mountProbe("none");
    const earlierOpener = probe.element("main-opener");
    const laterOpener = probe.element("navigation-opener");
    earlierOpener.focus();
    await probe.update((shell) => shell.openSettings());
    await probe.closeOverlay();
    laterOpener.focus();
    await probe.update((shell) => shell.openDeveloperWorkbench());
    await probe.closeOverlay();
    await probe.flushFrames();
    expect(document.activeElement).toBe(laterOpener);
    expect(
      probe.focusCalls.filter((call) => call.element === earlierOpener),
    ).toHaveLength(1);
    expect(
      probe.focusCalls.filter((call) => call.element === laterOpener),
    ).toHaveLength(2);
  });

  it("does not focus an inert main fallback while a newer overlay owns the page", async () => {
    const probe = await mountProbe("none");
    const opener = probe.element("main-opener");
    probe.main.inert = true;
    const previousCalls = probe.focusCalls.length;
    restoreWorkbenchOverlayFocus(opener);
    expect(probe.focusCalls).toHaveLength(previousCalls);
  });

  it.each(["workspace file", "plan artifact"] as const)(
    "suspends %s Escape handling without remounting or resetting its selected view",
    async (kind) => {
      const dom = installDom();
      const root = createRoot(dom.container);
      roots.push(root);
      const onClose = vi.fn();
      const text = "Keep this preview state through Settings.";
      const previewFile = vi.fn(async (path: string) => ({
        path,
        filename: "report.md",
        contentType: "text/markdown",
        blob: new Blob([text]),
        sizeBytes: text.length,
        sha256: "a".repeat(64),
        text,
      }));
      const inspection: ArtifactInspection = {
        mode: "preview",
        threadId: "thread_overlay",
        planId: "plan_overlay",
        planRevision: 1,
        artifact: {
          id: "artifact_overlay",
          path: "report.md",
          kind: "file",
          description: "Retained preview",
          status: "verified",
          evidence: "Fixture preview",
          sha256: "a".repeat(64),
          sizeBytes: text.length,
          createdAt: "2026-10-29T00:00:00.000Z",
          updatedAt: "2026-10-29T00:00:00.000Z",
        },
        receipt: {
          kind: "napier.plan-artifact-text-preview",
          schemaVersion: 1,
          planId: "plan_overlay",
          artifactId: "artifact_overlay",
          planRevision: 1,
          status: "verified",
          artifactKind: "file",
          pathSha256: createHash("sha256").update("report.md").digest("hex"),
          sha256: "a".repeat(64),
          sizeBytes: text.length,
          lineCount: 1,
          textSha256: "a".repeat(64),
          text,
          ledgerEventId: "event_overlay",
          ledgerEventSeq: 1,
          ledgerEventSha256: "c".repeat(64),
        },
      };
      const renderInspector = async (suspended: boolean) =>
        act(async () => {
          root.render(
            kind === "workspace file" ? (
              <WorkspaceFileInspector
                path="report.md"
                suspended={suspended}
                onClose={onClose}
                previewFile={previewFile}
              />
            ) : (
              <ArtifactInspector
                inspection={inspection}
                suspended={suspended}
                onClose={onClose}
              />
            ),
          );
        });
      await renderInspector(false);
      const inspector = dom.container.querySelector<HTMLElement>(
        ".artifact-inspector",
      )!;
      const sourceButton = descendants(inspector, "button").find(
        (button) => button.textContent?.trim() === "Raw source",
      ) as HTMLButtonElement;
      expect(sourceButton).toBeDefined();
      await act(async () => sourceButton.click());
      expect(sourceButton.getAttribute("aria-pressed")).toBe("true");
      const previewCalls = previewFile.mock.calls.length;
      const focusCalls = dom.focusCalls.length;

      await renderInspector(true);
      expect(dom.container.querySelector(".artifact-inspector")).toBe(
        inspector,
      );
      expect(inspector.hidden).toBe(true);
      expect(inspector.inert).toBe(true);
      await act(async () => window.dispatchEvent(keyEvent("Escape")));
      await dom.flushFrames();
      expect(onClose).not.toHaveBeenCalled();
      expect(dom.focusCalls).toHaveLength(focusCalls);

      await renderInspector(false);
      expect(dom.container.querySelector(".artifact-inspector")).toBe(
        inspector,
      );
      expect(inspector.hidden).toBe(false);
      expect(sourceButton.getAttribute("aria-pressed")).toBe("true");
      expect(previewFile).toHaveBeenCalledTimes(previewCalls);
      const handledEscape = keyEvent("Escape");
      handledEscape.preventDefault();
      await act(async () => window.dispatchEvent(handledEscape));
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => window.dispatchEvent(keyEvent("Escape")));
      expect(onClose).toHaveBeenCalledOnce();
      expect(dom.focusCalls.some((call) => call.inert)).toBe(false);
    },
  );
});

async function mountProbe(evidenceKind: EvidenceKind) {
  const dom = installDom();
  const root = createRoot(dom.container);
  roots.push(root);
  let controls!: Shell;
  let invalidate!: (value: "removed" | "hidden" | "disabled") => void;

  function Probe() {
    const shell = useWorkspaceShell(setInspectorTab);
    const [invalidity, setInvalidity] = useState<string>();
    controls = shell;
    invalidate = setInvalidity;
    const open = shell.settingsOpen || shell.developerWorkbenchOpen;
    useWorkbenchOverlay(open, shell.overlayReturnFocusRef);
    return (
      <>
        <nav className="workspace-navigation-shell">
          <button id="navigation-opener" onClick={shell.openSettings}>
            Settings
          </button>
          <input id="sidebar-draft" defaultValue="" />
        </nav>
        <main id="main-workspace">
          <button id="main-opener" onClick={shell.openSettings}>
            Settings
          </button>
          <input id="composer-draft" defaultValue="" />
          <div
            className={`workspace-primary-surface${evidenceKind !== "none" ? " has-evidence-overlay" : ""}`}
          >
            {evidenceKind !== "none" ? (
              <aside
                id={
                  evidenceKind === "rail"
                    ? "workspace-evidence-rail"
                    : "evidence-surface"
                }
                className={
                  evidenceKind === "artifact" ? "artifact-inspector" : undefined
                }
                data-probe="evidence-surface"
                role="dialog"
                hidden={open}
              >
                <button id="evidence-first">Close evidence</button>
                {invalidity !== "removed" ? (
                  <button
                    id="evidence-opener"
                    hidden={invalidity === "hidden"}
                    disabled={invalidity === "disabled"}
                  >
                    Current evidence action
                  </button>
                ) : null}
                <input id="evidence-draft" defaultValue="" />
              </aside>
            ) : null}
          </div>
        </main>
        {open ? (
          <OverlayProbe
            key={shell.settingsOpen ? "settings" : "developer"}
            developer={shell.developerWorkbenchOpen}
          />
        ) : null}
      </>
    );
  }

  await act(async () => root.render(<Probe />));
  const element = (id: string) => {
    const result =
      id === "evidence-surface"
        ? dom.container.querySelector<HTMLElement>(
            '[data-probe="evidence-surface"]',
          )
        : dom.container.querySelector<HTMLElement>(`#${id}`);
    if (!result) throw new Error(`Missing probe element: ${id}`);
    return result;
  };
  return {
    ...dom,
    element,
    main: element("main-workspace"),
    navigation: dom.container.querySelector<HTMLElement>(
      ".workspace-navigation-shell",
    )!,
    input: (id: string) => element(id) as HTMLInputElement,
    shell: () => controls,
    async update(action: (shell: Shell) => void) {
      await act(async () => action(controls));
    },
    async closeOverlay() {
      await act(async () => {
        if (controls.settingsOpen) controls.closeSettings();
        else controls.closeDeveloperWorkbench();
      });
    },
    async invalidateOpener(value: "removed" | "hidden" | "disabled") {
      await act(async () => invalidate(value));
    },
  };
}

function OverlayProbe({ developer }: { developer: boolean }) {
  const control = useRef<HTMLButtonElement>(null);
  // Child layout effects precede the parent's passive inert/focus effect.
  useLayoutEffect(() => control.current?.focus(), []);
  return (
    <aside
      className={`workspace-settings-surface${developer ? " developer-workbench-surface" : ""}`}
      role="dialog"
    >
      <button id="overlay-control" ref={control}>
        Overlay action
      </button>
    </aside>
  );
}

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  window.innerWidth = 320;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let focused: HTMLElement | null = null;
  const focusCalls: Array<{ element: HTMLElement; inert: boolean }> = [];
  // Linkedom has no layout or browser focus/inert behavior. This records the
  // hook's ordering contract; real-browser verification owns native semantics.
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => focused,
  });
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("inert");
    },
    set(this: HTMLElement, value: boolean) {
      this.toggleAttribute("inert", value);
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value(this: HTMLElement) {
      return this.isConnected && !this.closest("[hidden]") ? [{}] : [];
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "focus", {
    configurable: true,
    value(this: HTMLElement) {
      const inert = Boolean(this.closest("[inert]"));
      focusCalls.push({ element: this, inert });
      if (
        !inert &&
        this.isConnected &&
        !this.closest("[hidden]") &&
        !this.hasAttribute("disabled")
      )
        focused = this;
    },
  });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const requestFrame = (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  const cancelFrame = (id: number) => {
    frames.delete(id);
  };
  window.requestAnimationFrame = requestFrame;
  window.cancelAnimationFrame = cancelFrame;
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  return {
    container: document.getElementById("app") as unknown as HTMLElement,
    focusCalls,
    async flushFrames() {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
      });
    },
  };
}

function dispatchShortcut(modifier: "metaKey" | "ctrlKey") {
  const event = keyEvent(",");
  Object.defineProperty(event, modifier, { value: true });
  window.dispatchEvent(event);
}

function keyEvent(key: string) {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event;
}

// The project renders lucide through Preact compatibility; the same explicit
// traversal as the inspector's existing tests avoids Linkedom SVG matching.
function descendants(root: Element, localName: string): Element[] {
  return Array.from(root.children).flatMap((child) => [
    ...(child.localName === localName ? [child] : []),
    ...descendants(child, localName),
  ]);
}

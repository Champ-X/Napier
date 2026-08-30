import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceLayout } from "../src/use-workspace-layout";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useWorkspaceLayout", () => {
  it.each([1280, 1440, 1920])(
    "starts expanded at the supported %dpx desktop width",
    async (width) => {
      const probe = await mountProbe(width);
      expect(probe.read().collapsed).toBe(false);
    },
  );

  it.each([1280, 1440, 1920])(
    "keeps the operator's sidebar choice at %dpx",
    async (width) => {
      const probe = await mountProbe(width);
      await probe.toggle();
      expect(probe.read().collapsed).toBe(true);
      await probe.resizeTo(width === 1920 ? 1280 : 1920);
      expect(probe.read().collapsed).toBe(true);
    },
  );

  it("honors a manual collapse and never auto-reopens on minor width change", async () => {
    const probe = await mountProbe(1920);

    await probe.toggle();
    expect(probe.read().collapsed).toBe(true);

    await probe.resizeTo(1280);
    expect(probe.read().collapsed).toBe(true);

    await probe.toggle();
    expect(probe.read().collapsed).toBe(false);
  });

  it("persists independently resized navigation and evidence widths", async () => {
    const probe = await mountProbe(1920);

    await probe.setNavigationWidth(264);
    await probe.setEvidenceWidth(612);

    expect(probe.read()).toMatchObject({
      navigationWidth: 264,
      evidenceWidth: 612,
    });
    expect(
      window.localStorage.getItem("napier.workspace.navigation-width"),
    ).toBe("264");
    expect(window.localStorage.getItem("napier.workspace.evidence-width")).toBe(
      "612",
    );
  });

  it("clamps widths and restores the design defaults", async () => {
    const probe = await mountProbe(1920);

    await probe.setNavigationWidth(900);
    await probe.setEvidenceWidth(120);
    expect(probe.read()).toMatchObject({
      navigationWidth: 480,
      evidenceWidth: 360,
      navigationMax: 480,
      evidenceMax: 800,
    });

    await probe.resetWidths();
    expect(probe.read()).toMatchObject({
      navigationWidth: 252,
      evidenceWidth: 760,
      evidenceMax: 960,
    });
  });

  it("caps the evidence rail at half of the viewport", async () => {
    const probe = await mountProbe(1920);

    await probe.setEvidenceWidth(1200);
    expect(probe.read()).toMatchObject({
      navigationWidth: 252,
      evidenceWidth: 960,
      evidenceMax: 960,
    });
  });

  it("keeps the center readable while restoring preferred widths on a wider viewport", async () => {
    const probe = await mountProbe(1920);

    await probe.setNavigationWidth(480);
    await probe.setEvidenceWidth(1200);
    expect(probe.read()).toMatchObject({
      navigationWidth: 480,
      evidenceWidth: 800,
    });

    await probe.resizeTo(1440);
    expect(probe.read()).toMatchObject({
      navigationWidth: 440,
      evidenceWidth: 360,
      navigationMax: 440,
      evidenceMax: 360,
    });

    await probe.resizeTo(2560);
    expect(probe.read()).toMatchObject({
      navigationWidth: 480,
      evidenceWidth: 1200,
    });

    await probe.setEvidenceWidth(2000);
    expect(probe.read()).toMatchObject({
      evidenceWidth: 1280,
      evidenceMax: 1280,
    });
  });
});

interface ProbeReading {
  collapsed: boolean;
  navigationWidth: number;
  navigationMax: number;
  evidenceWidth: number;
  evidenceMax: number;
}

async function mountProbe(initialWidth: number) {
  const { container, window } = installDom(initialWidth);
  const root = createRoot(container);
  roots.push(root);
  let toggleSidebar = () => undefined as void;
  let setNavigationWidth = (_width: number) => undefined as void;
  let setEvidenceWidth = (_width: number) => undefined as void;
  let resetNavigationWidth = () => undefined as void;
  let resetEvidenceWidth = () => undefined as void;

  function Probe() {
    const controls = useWorkspaceLayout();
    toggleSidebar = controls.toggleSidebar;
    setNavigationWidth = controls.setNavigationWidth;
    setEvidenceWidth = controls.setEvidenceWidth;
    resetNavigationWidth = controls.resetNavigationWidth;
    resetEvidenceWidth = controls.resetEvidenceWidth;
    return (
      <div
        data-collapsed={String(controls.collapsed)}
        data-navigation-width={controls.navigationWidth}
        data-navigation-max={controls.navigationMax}
        data-evidence-width={controls.evidenceWidth}
        data-evidence-max={controls.evidenceMax}
      />
    );
  }

  await act(async () => root.render(<Probe />));

  return {
    read(): ProbeReading {
      const node = container.firstElementChild!;
      return {
        collapsed: node.getAttribute("data-collapsed") === "true",
        navigationWidth: Number(node.getAttribute("data-navigation-width")),
        navigationMax: Number(node.getAttribute("data-navigation-max")),
        evidenceWidth: Number(node.getAttribute("data-evidence-width")),
        evidenceMax: Number(node.getAttribute("data-evidence-max")),
      };
    },
    async resizeTo(width: number) {
      window.innerWidth = width;
      await act(async () => {
        window.dispatchEvent(new window.Event("resize"));
      });
    },
    async toggle() {
      await act(async () => toggleSidebar());
    },
    async setNavigationWidth(width: number) {
      await act(async () => setNavigationWidth(width));
    },
    async setEvidenceWidth(width: number) {
      await act(async () => setEvidenceWidth(width));
    },
    async resetWidths() {
      await act(async () => {
        resetNavigationWidth();
        resetEvidenceWidth();
      });
    },
  };
}

function installDom(initialWidth: number) {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  window.innerWidth = initialWidth;
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    container: document.getElementById("app") as unknown as HTMLElement,
    window,
  };
}

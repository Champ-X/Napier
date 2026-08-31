import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFileInspector } from "../src/WorkspaceFileInspector";

const containers: HTMLElement[] = [];
const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  containers.splice(0);
  vi.unstubAllGlobals();
});

describe("WorkspaceFileInspector", () => {
  it("loads a workspace HTML file and switches to its source", async () => {
    const { container } = installDom();
    const root = createRoot(container);
    roots.push(root);
    const previewFile = vi.fn(async (path: string) => ({
      path,
      filename: "slides.html",
      contentType: "text/html; charset=utf-8",
      blob: new Blob(["<main>Workspace preview</main>"], {
        type: "text/html",
      }),
      sizeBytes: 30,
      sha256: "a".repeat(64),
      text: "<main>Workspace preview</main>",
    }));

    await act(async () => {
      root.render(
        <WorkspaceFileInspector
          path="/workspace/slides.html"
          onClose={() => undefined}
          previewFile={previewFile}
        />,
      );
    });
    await waitFor(() => elements(container, "iframe").length === 1);

    expect(previewFile).toHaveBeenCalledWith(
      "/workspace/slides.html",
      expect.any(AbortSignal),
    );
    expect(elements(container, "iframe")[0]?.getAttribute("sandbox")).toBe(
      "allow-scripts",
    );
    await act(async () => button(container, "Raw source").click());
    expect(elements(container, "iframe")).toHaveLength(0);
    expect(container.textContent).toContain("Workspace preview");
  });

  it("renders image files inside the preview surface", async () => {
    const { container } = installDom();
    const root = createRoot(container);
    roots.push(root);
    const previewFile = vi.fn(async (path: string) => ({
      path,
      filename: "preview.png",
      contentType: "image/png",
      blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
        type: "image/png",
      }),
      sizeBytes: 4,
      sha256: "b".repeat(64),
    }));

    await act(async () => {
      root.render(
        <WorkspaceFileInspector
          path="/workspace/preview.png"
          onClose={() => undefined}
          previewFile={previewFile}
        />,
      );
    });
    await waitFor(() => elements(container, "img").length === 1);

    expect(elements(container, "img")[0]?.getAttribute("alt")).toBe(
      "preview.png",
    );
  });
});

function installDom() {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("document", parsed.document);
  vi.stubGlobal("window", parsed.window);
  vi.stubGlobal("navigator", parsed.window.navigator);
  vi.stubGlobal("HTMLElement", parsed.window.HTMLElement);
  vi.stubGlobal("Event", parsed.window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = parsed.document.querySelector("#root") as HTMLElement;
  containers.push(container);
  return { container };
}

function elements(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.localName === localName) matches.push(child);
    matches.push(...elements(child, localName));
  }
  return matches;
}

function button(root: Element, label: string): HTMLButtonElement {
  const match = elements(root, "button").find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (assertion()) return;
    await act(async () => Promise.resolve());
  }
  throw new Error("Timed out waiting for assertion");
}

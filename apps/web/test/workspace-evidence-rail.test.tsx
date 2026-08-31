import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceEvidenceRail } from "../src/WorkspaceEvidenceRail";

vi.mock("../src/WorkspaceFileTree", () => ({
  WorkspaceFileTree: () => <button type="button">File tree</button>,
}));

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("WorkspaceEvidenceRail", () => {
  it("behaves as a keyboard-dismissable dialog in overlay mode", async () => {
    const container = installDom();
    const onClose = vi.fn();
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <WorkspaceEvidenceRail
          workspace={{
            root: "/workspace/project",
            dataRoot: "/workspace/project/.napier",
            localFirst: true,
            isolation: "workspace",
          }}
          detail={undefined}
          open
          overlay
          onLedgerChanged={() => undefined}
          onOpenArtifact={() => undefined}
          onClose={onClose}
        />,
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.hasAttribute("hidden")).toBe(false);
    expect(
      dialog.querySelector('[aria-label="Hide workspace"]'),
    ).not.toBeNull();

    await act(async () => {
      const event = new Event("keydown", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "key", { value: "Escape" });
      window.dispatchEvent(event);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays mounted but non-interactive while closed", async () => {
    const container = installDom();
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <WorkspaceEvidenceRail
          workspace={{
            root: "/workspace/project",
            dataRoot: "/workspace/project/.napier",
            localFirst: true,
            isolation: "workspace",
          }}
          detail={undefined}
          open={false}
          overlay
          onLedgerChanged={() => undefined}
          onOpenArtifact={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    const rail = container.querySelector<HTMLElement>(
      "#workspace-evidence-rail",
    )!;
    expect(rail.hasAttribute("hidden")).toBe(true);
    expect(rail.textContent).toContain("File tree");
  });
});

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document.getElementById("app") as unknown as HTMLElement;
}

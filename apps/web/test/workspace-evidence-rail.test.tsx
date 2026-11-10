import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadDetail } from "@napier/contracts";

import { WorkspaceEvidenceRail } from "../src/WorkspaceEvidenceRail";

vi.mock("lucide-react", () => {
  const Icon = () => <svg aria-hidden="true" />;
  return {
    Files: Icon,
    PanelRightClose: Icon,
    Folder: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    File: Icon,
    FileCode2: Icon,
    FileImage: Icon,
    FileText: Icon,
  };
});

vi.mock("../src/WorkspaceFileTree", () => ({
  WorkspaceFileTree: () => <button type="button">File tree</button>,
}));

vi.mock("../src/TaskCompletionSummary", () => ({
  default: ({ completedItems }: { completedItems: string[] }) => (
    <div className="completion-record-fixture">
      {completedItems.map((item) => (
        <p key={item}>{item}</p>
      ))}
      <button type="button">Inspect completion evidence</button>
    </div>
  ),
}));

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("WorkspaceEvidenceRail", () => {
  it("prioritizes output names and locations, opens the existing inspector, and makes files secondary", async () => {
    const container = installDom();
    const onOpenArtifact = vi.fn();
    const path =
      "/workspace/project/outputs/thread_1/reports/任务分析报告.html";
    await renderRail(container, outputDetail([path]), { onOpenArtifact });

    const scroll = container.querySelector(".workspace-evidence-scroll")!;
    expect(scroll.firstElementChild?.className).toBe(
      "workspace-evidence-results",
    );
    const output = scroll.querySelector<HTMLButtonElement>(
      ".workspace-evidence-output-list button",
    )!;
    expect(output.querySelector("strong")?.textContent).toBe(
      "任务分析报告.html",
    );
    expect(output.querySelector("code")?.textContent).toBe(
      "outputs/thread_1/reports",
    );
    expect(output.querySelector(".workspace-output-type")?.textContent).toBe(
      "HTML",
    );
    expect(output.getAttribute("aria-label")).toBe(`Open output: ${path}`);
    await act(async () => output.click());
    expect(onOpenArtifact).toHaveBeenCalledWith(path);

    const toggle = scroll.querySelector<HTMLButtonElement>(
      ".workspace-files-heading button",
    )!;
    const files = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(files.hasAttribute("hidden")).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(files.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the file browser primary when there are no results", async () => {
    const container = installDom();
    await renderRail(container, undefined);
    expect(container.querySelector(".workspace-evidence-results")).toBeNull();
    expect(
      container.querySelector(".workspace-files-heading button"),
    ).toBeNull();
    const tree = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "File tree",
    )!;
    expect(tree.closest("[hidden]")).toBeNull();
    expect(
      container.querySelector(".workspace-evidence-empty")?.textContent,
    ).toContain("No task outputs yet");
    expect(
      container.querySelector(".workspace-evidence-heading")?.parentElement
        ?.tagName,
    ).toBe("ASIDE");
  });

  it.each([true, false])(
    "only automatically collapses newly secondary files when their content is not focused (focused: %s)",
    async (focusFiles) => {
      const container = installDom();
      const root = await renderRail(container, outputDetail([]));
      const tree = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "File tree",
      )!;
      const close = container.querySelector<HTMLButtonElement>(
        ".workspace-evidence-heading button",
      )!;
      (focusFiles ? tree : close).focus();

      await renderRail(
        container,
        outputDetail(["outputs/report.md"]),
        {},
        root,
      );
      const toggle = container.querySelector<HTMLButtonElement>(
        ".workspace-files-heading button",
      )!;
      expect(toggle.getAttribute("aria-expanded")).toBe(String(focusFiles));
      expect(tree.closest("[hidden]") === null).toBe(focusFiles);
      expect(document.activeElement).toBe(focusFiles ? tree : close);

      if (focusFiles) {
        await act(async () => toggle.click());
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(tree.closest("[hidden]")).not.toBeNull();
        expect(document.activeElement).toBe(toggle);
      }
    },
  );

  it("keeps focused completion evidence visible when a file result arrives", async () => {
    const container = installDom();
    const completedItems = ["Report ready"];
    const root = await renderRail(container, outputDetail([], completedItems));
    const evidence = container.querySelector<HTMLButtonElement>(
      ".completion-record-fixture button",
    )!;
    evidence.focus();

    await renderRail(
      container,
      outputDetail(["outputs/report.md"], completedItems),
      {},
      root,
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      ".workspace-evidence-record-toggle",
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(evidence.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(evidence);

    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(evidence.closest("[hidden]")).not.toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("retains completion evidence without inventing a file result", async () => {
    const container = installDom();
    await renderRail(
      container,
      outputDetail([], ["All requested checks passed"]),
    );
    expect(
      container.querySelector(".workspace-evidence-results")?.textContent,
    ).toContain("All requested checks passed");
    expect(
      container.querySelector(".workspace-evidence-output-list"),
    ).toBeNull();
    expect(
      container
        .querySelector(".completion-record-fixture")
        ?.closest("[hidden]"),
    ).toBeNull();
    expect(
      container
        .querySelector(".workspace-files-heading button")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("traps overlay focus among visible controls and restores the opener", async () => {
    const container = installDom();
    const opener = document.createElement("button");
    document.body.prepend(opener);
    opener.focus();
    const root = await renderRail(
      container,
      outputDetail(["outputs/report.md"], ["Report ready"]),
      { overlay: true },
    );
    const close = container.querySelector<HTMLButtonElement>(
      ".workspace-evidence-heading button",
    )!;
    const filesToggle = container.querySelector<HTMLButtonElement>(
      ".workspace-files-heading button",
    )!;
    expect(document.activeElement).toBe(close);

    filesToggle.focus();
    await act(async () => dispatchKey("Tab"));
    expect(document.activeElement).toBe(close);
    await act(async () => dispatchKey("Tab", true));
    expect(document.activeElement).toBe(filesToggle);

    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(document.activeElement).toBe(opener);
  });

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
      dialog.querySelector('[aria-label="Hide files & results"]'),
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
  let focused: HTMLElement | null = null;
  Object.defineProperty(document, "activeElement", { get: () => focused });
  Object.defineProperty(window.HTMLElement.prototype, "focus", {
    configurable: true,
    value(this: HTMLElement) {
      focused = this;
    },
  });
  return document.getElementById("app") as unknown as HTMLElement;
}

async function renderRail(
  container: HTMLElement,
  detail: ThreadDetail | undefined,
  options: { onOpenArtifact?: (path: string) => void; overlay?: boolean } = {},
  existingRoot?: Root,
) {
  const root = existingRoot ?? createRoot(container);
  if (!existingRoot) roots.push(root);
  await act(async () => {
    root.render(
      <WorkspaceEvidenceRail
        workspace={{
          root: "/workspace/project",
          dataRoot: "/workspace/project/.napier",
          localFirst: true,
          isolation: "workspace",
        }}
        detail={detail}
        onClose={() => undefined}
        onLedgerChanged={() => undefined}
        onOpenArtifact={options.onOpenArtifact ?? (() => undefined)}
        overlay={options.overlay}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

function outputDetail(
  paths: string[],
  completedItems: string[] = [],
): ThreadDetail {
  return {
    thread: { id: "thread_1" },
    runs: [],
    events: [],
    plans: [],
    activePlan: { outputPaths: paths },
    taskNarrative: {
      phase: completedItems.length > 0 ? "completed" : "working",
      phaseLabel: completedItems.length > 0 ? "Settled" : "Working",
      currentAction: "Prepare report",
      completedItems,
    },
  } as ThreadDetail;
}

function dispatchKey(key: string, shiftKey = false) {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    shiftKey: { value: shiftKey },
  });
  window.dispatchEvent(event);
}

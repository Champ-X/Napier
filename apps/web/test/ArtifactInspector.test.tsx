import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactInspection } from "../src/artifact-inspection";
import { ArtifactInspector } from "../src/ArtifactInspector";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("ArtifactInspector", () => {
  it("runs self-contained HTML interactions without granting origin access", async () => {
    const { document, container } = installDom();
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={htmlInspection()}
          onClose={() => undefined}
        />,
        container,
      );
    });

    const frame = elements(container, "iframe")[0];
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-popups");
    expect(frame?.getAttribute("title")).toBe("HTML artifact preview");
    expect(frame?.getAttribute("srcdoc")).toContain("Next");
  });

  it("switches between preview, source, and recorded changes in place", async () => {
    const { container } = installDom();
    const previewArtifact = vi.fn(async () => ({
      ...htmlInspection().receipt,
      text: "<main>refreshed</main>",
    }));
    const previewDiff = vi.fn(async () => diffReceipt());
    const onLedgerChanged = vi.fn(async () => undefined);
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={htmlInspection()}
          onClose={() => undefined}
          onLedgerChanged={onLedgerChanged}
          previewArtifact={previewArtifact}
          previewDiff={previewDiff}
        />,
        container,
      );
    });

    await click(button(container, "Raw source"));
    expect(elements(container, "iframe")).toHaveLength(0);
    expect(container.textContent).toContain("Next");
    expect(previewArtifact).not.toHaveBeenCalled();

    await click(button(container, "Refresh"));
    await waitFor(() => previewArtifact.mock.calls.length === 1);
    expect(container.textContent).toContain("refreshed");
    expect(onLedgerChanged).toHaveBeenCalledOnce();

    await click(button(container, "Changes"));
    await waitFor(() => previewDiff.mock.calls.length === 1);
    expect(container.textContent).toContain("+after");
    expect(onLedgerChanged).toHaveBeenCalledTimes(2);

    await click(button(container, "Preview"));
    await waitFor(() => elements(container, "iframe").length === 1);
    const frame = elements(container, "iframe")[0];
    expect(
      frame?.getAttribute("srcdoc") ??
        frame?.getAttribute("srcDoc") ??
        (frame as HTMLIFrameElement | undefined)?.srcdoc,
    ).toBe("<main>refreshed</main>");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("loads an answer file in place and refreshes its preview evidence", async () => {
    const { container } = installDom();
    const inspection = htmlInspection();
    delete inspection.receipt;
    const previewArtifact = vi.fn(async () => htmlInspection().receipt!);
    const onLedgerChanged = vi.fn(async () => undefined);

    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          onLedgerChanged={onLedgerChanged}
          previewArtifact={previewArtifact}
        />,
        container,
      );
    });
    await waitFor(() => previewArtifact.mock.calls.length === 1);
    await waitFor(() => onLedgerChanged.mock.calls.length === 1);

    expect(previewArtifact).toHaveBeenCalledWith(
      "thread_1",
      "plan_1",
      "slides",
    );
    expect(elements(container, "iframe")).toHaveLength(1);
    expect(onLedgerChanged).toHaveBeenCalledOnce();

    const nextOnLedgerChanged = vi.fn(async () => undefined);
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          onLedgerChanged={nextOnLedgerChanged}
          previewArtifact={previewArtifact}
        />,
        container,
      );
    });
    await act(async () => Promise.resolve());
    expect(previewArtifact).toHaveBeenCalledOnce();
    expect(nextOnLedgerChanged).not.toHaveBeenCalled();
  });
});

function diffReceipt() {
  return {
    kind: "napier.plan-artifact-diff-preview" as const,
    schemaVersion: 1 as const,
    planId: "plan_1",
    artifactId: "slides",
    planRevision: 1,
    status: "verified",
    artifactKind: "file",
    pathSha256: "a".repeat(64),
    scope: "working" as const,
    text: "-before\n+after",
    outputSha256: "b".repeat(64),
    outputBytes: 14,
    fileCount: 1,
    hunkCount: 1,
    addedLineCount: 1,
    deletedLineCount: 1,
    repositoryStateSha256: "c".repeat(64),
    ledgerEventId: "event_diff",
    ledgerEventSeq: 2,
    ledgerEventSha256: "d".repeat(64),
  };
}

function htmlInspection(): ArtifactInspection {
  return {
    mode: "preview",
    threadId: "thread_1",
    planId: "plan_1",
    artifact: {
      id: "slides",
      path: "slides.html",
      kind: "file",
      description: "Interactive slides",
      status: "verified",
      evidence: "Verified by the runtime.",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    receipt: {
      kind: "napier.plan-artifact-text-preview",
      schemaVersion: 1,
      planId: "plan_1",
      artifactId: "slides",
      planRevision: 1,
      status: "verified",
      artifactKind: "file",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      sizeBytes: 71,
      lineCount: 1,
      textSha256: "c".repeat(64),
      text: '<button id="next-slide" onclick="document.title=\"next\"">Next</button>',
      ledgerEventId: "event_1",
      ledgerEventSeq: 1,
      ledgerEventSha256: "d".repeat(64),
    },
  };
}

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
  return { document: parsed.document, container };
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

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (assertion()) return;
    await act(async () => Promise.resolve());
  }
  throw new Error("Timed out waiting for assertion");
}

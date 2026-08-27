import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactManifestEntry } from "@napier/contracts";
import type {
  PlanArtifactDiffPreviewReceipt,
  PlanArtifactTextPreviewReceipt,
} from "../src/artifact-file-api";
import { ArtifactActionSurface } from "../src/ArtifactActionSurface";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ArtifactActionSurface", () => {
  it("previews, diffs, and copies a file through consistent actions", async () => {
    const { container } = installDom();
    const previewArtifact = vi.fn(async () => preview());
    const previewDiff = vi.fn(async () => diff());
    const onLedgerChanged = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await renderSurface(container, {
      previewArtifact,
      previewDiff,
      onLedgerChanged,
    });

    expect(buttonLabels(container)).toEqual([
      "Open",
      "Preview",
      "Diff",
      "Copy path",
    ]);
    await click(button(container, "Open"));
    await waitFor(() => container.textContent?.includes("# Delivery") === true);
    expect(previewArtifact).toHaveBeenCalledWith(
      "thread_1",
      "plan_1",
      "artifact_report",
    );

    await click(button(container, "Diff"));
    await waitFor(() => container.textContent?.includes("+Changed") === true);
    expect(previewDiff).toHaveBeenCalledWith(
      "thread_1",
      "plan_1",
      "artifact_report",
    );
    expect(container.textContent).not.toContain("# Delivery");
    expect(onLedgerChanged).toHaveBeenCalledTimes(2);

    await click(button(container, "Copy path"));
    await waitFor(() => writeText.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith("artifacts/report.md");
    expect(container.textContent).toContain("Copied");
  });

  it("opens a safe URL without exposing file-only actions", async () => {
    const { container, window } = installDom();
    const open = vi.fn();
    window.open = open;
    await renderSurface(container, {
      artifact: artifact({
        kind: "url",
        path: "https://example.com/result",
      }),
    });

    expect(buttonLabels(container)).toEqual(["Open", "Copy path"]);
    await click(button(container, "Open"));
    expect(open).toHaveBeenCalledWith(
      "https://example.com/result",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("delegates Open when the host owns one-click navigation", async () => {
    const { container } = installDom();
    const onOpen = vi.fn();
    const previewArtifact = vi.fn(async () => preview());
    await renderSurface(container, { onOpen, previewArtifact });

    await click(button(container, "Open"));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(previewArtifact).not.toHaveBeenCalled();
  });

  it("exposes host actions only when executable callbacks are supplied", async () => {
    const { container } = installDom();
    const onReveal = vi.fn();
    const onRestore = vi.fn(async () => undefined);
    const onApply = vi.fn(async () => undefined);
    const onLedgerChanged = vi.fn(async () => undefined);
    await renderSurface(container, {
      onReveal,
      onRestore,
      onApply,
      onLedgerChanged,
    });

    expect(buttonLabels(container)).toEqual([
      "Open",
      "Preview",
      "Diff",
      "Reveal",
      "Copy path",
      "Restore",
      "Apply",
    ]);
    await click(button(container, "Reveal"));
    await click(button(container, "Restore"));
    await click(button(container, "Apply"));

    expect(onReveal).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onLedgerChanged).toHaveBeenCalledTimes(2);
  });
});

async function renderSurface(
  container: HTMLElement,
  options: {
    artifact?: ArtifactManifestEntry;
    previewArtifact?: () => Promise<PlanArtifactTextPreviewReceipt>;
    previewDiff?: () => Promise<PlanArtifactDiffPreviewReceipt>;
    onLedgerChanged?: () => Promise<void>;
    onOpen?: () => void | Promise<void>;
    onReveal?: () => void | Promise<void>;
    onRestore?: () => void | Promise<void>;
    onApply?: () => void | Promise<void>;
  },
) {
  await act(async () => {
    render(
      <ArtifactActionSurface
        artifact={options.artifact ?? artifact()}
        threadId="thread_1"
        planId="plan_1"
        {...(options.previewArtifact
          ? { previewArtifact: options.previewArtifact }
          : {})}
        {...(options.previewDiff ? { previewDiff: options.previewDiff } : {})}
        {...(options.onLedgerChanged
          ? { onLedgerChanged: options.onLedgerChanged }
          : {})}
        {...(options.onOpen ? { onOpen: options.onOpen } : {})}
        {...(options.onReveal ? { onReveal: options.onReveal } : {})}
        {...(options.onRestore ? { onRestore: options.onRestore } : {})}
        {...(options.onApply ? { onApply: options.onApply } : {})}
      />,
      container,
    );
  });
}

function artifact(
  overrides: Partial<ArtifactManifestEntry> = {},
): ArtifactManifestEntry {
  return {
    id: "artifact_report",
    path: "artifacts/report.md",
    kind: "file",
    description: "Verified report",
    status: "verified",
    evidence: "Verified by the runtime.",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function preview(): PlanArtifactTextPreviewReceipt {
  return {
    kind: "napier.plan-artifact-text-preview",
    schemaVersion: 1,
    planId: "plan_1",
    artifactId: "artifact_report",
    planRevision: 1,
    status: "verified",
    artifactKind: "file",
    pathSha256: "a".repeat(64),
    sha256: "b".repeat(64),
    sizeBytes: 16,
    lineCount: 2,
    textSha256: "c".repeat(64),
    text: "# Delivery\nDone.",
    ...receipt(),
  };
}

function diff(): PlanArtifactDiffPreviewReceipt {
  return {
    kind: "napier.plan-artifact-diff-preview",
    schemaVersion: 1,
    planId: "plan_1",
    artifactId: "artifact_report",
    planRevision: 1,
    status: "verified",
    artifactKind: "file",
    pathSha256: "a".repeat(64),
    scope: "working",
    text: "-Before\n+Changed",
    outputSha256: "d".repeat(64),
    outputBytes: 16,
    fileCount: 1,
    hunkCount: 1,
    addedLineCount: 1,
    deletedLineCount: 1,
    repositoryStateSha256: "e".repeat(64),
    ...receipt(),
  };
}

function receipt() {
  return {
    ledgerEventId: "event_1",
    ledgerEventSeq: 1,
    ledgerEventSha256: "f".repeat(64),
  };
}

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return { container, window };
}

function buttonLabels(container: HTMLElement): string[] {
  return elements(container, "button").map(
    (candidate) => candidate.textContent?.trim() ?? "",
  );
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = elements(container, "button").find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

function elements(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.localName === localName) matches.push(child);
    matches.push(...elements(child, localName));
  }
  return matches;
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
    await flush();
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => flush());
  }
  throw new Error("Timed out waiting for component state");
}

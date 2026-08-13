import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PlanArtifactFileDownload,
  PlanArtifactTextPreviewReceipt,
} from "../src/artifact-file-api";
import { ConversationArtifactCard } from "../src/ConversationArtifactCard";
import type { ConversationArtifact } from "../src/conversation-artifact-view-model";

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

describe("ConversationArtifactCard", () => {
  it("previews verified text and closes it without leaking receipt hashes", async () => {
    const { container } = installDom();
    const previewArtifact = vi.fn(async () => preview());
    const onLedgerChanged = vi.fn(async () => undefined);
    await renderCard(container, { previewArtifact, onLedgerChanged });

    await click(button(container, "Preview"));
    await waitFor(() => findElementsByLocalName(container, "pre").length > 0);

    expect(previewArtifact).toHaveBeenCalledWith(
      "thread_1",
      "plan_1",
      "artifact_report",
    );
    expect(onLedgerChanged).toHaveBeenCalledTimes(1);
    expect(findElementsByLocalName(container, "pre")[0]?.textContent).toBe(
      "# Delivery\nDone.",
    );
    expect(container.textContent).not.toContain("ledger_event_secret");
    expect(container.textContent).not.toContain("c".repeat(64));

    await click(button(container, "Close preview artifacts/report.md"));
    expect(findElementsByLocalName(container, "pre")).toHaveLength(0);
  });

  it("downloads verified bytes and recovers from a failed preview", async () => {
    const { container, window } = installDom();
    const clickMock = vi
      .spyOn(window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:artifact");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const downloadArtifact = vi.fn(async () => download());
    const previewArtifact = vi
      .fn<() => Promise<PlanArtifactTextPreviewReceipt>>()
      .mockRejectedValueOnce(new Error("Preview unavailable"))
      .mockResolvedValueOnce(preview());
    await renderCard(container, { downloadArtifact, previewArtifact });

    await click(button(container, "Preview"));
    await waitFor(() =>
      findElementsByLocalName(container, "p").some(
        (candidate) => candidate.getAttribute("role") === "alert",
      ),
    );
    expect(container.textContent).toContain("Preview unavailable");
    expect(button(container, "Preview").disabled).toBe(false);

    await click(button(container, "Download"));
    await waitFor(() => downloadArtifact.mock.calls.length === 1);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickMock).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
    expect(button(container, "Download").disabled).toBe(false);
  });
});

async function renderCard(
  container: HTMLElement,
  options: {
    previewArtifact?: () => Promise<PlanArtifactTextPreviewReceipt>;
    downloadArtifact?: () => Promise<PlanArtifactFileDownload>;
    onLedgerChanged?: () => Promise<void>;
  },
) {
  await act(async () => {
    render(
      <ConversationArtifactCard
        item={artifact()}
        threadId="thread_1"
        onLedgerChanged={options.onLedgerChanged ?? (async () => undefined)}
        {...(options.previewArtifact
          ? { previewArtifact: options.previewArtifact }
          : {})}
        {...(options.downloadArtifact
          ? { downloadArtifact: options.downloadArtifact }
          : {})}
      />,
      container,
    );
  });
}

function artifact(): ConversationArtifact {
  return {
    id: "event_1",
    seq: 1,
    createdAt: "2026-08-08T00:00:00.000Z",
    threadId: "thread_1",
    planId: "plan_1",
    planRevision: 3,
    artifact: {
      id: "artifact_report",
      path: "artifacts/report.md",
      kind: "file",
      description: "Verified delivery report",
      status: "verified",
      sha256: "a".repeat(64),
      sizeBytes: 128,
      sourceRunId: "run_1",
      evidence: "Runtime verified the report bytes.",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
  };
}

function preview(): PlanArtifactTextPreviewReceipt {
  return {
    kind: "napier.plan-artifact-text-preview",
    schemaVersion: 1,
    planId: "plan_1",
    artifactId: "artifact_report",
    planRevision: 3,
    status: "verified",
    artifactKind: "file",
    pathSha256: "b".repeat(64),
    sha256: "a".repeat(64),
    sizeBytes: 16,
    lineCount: 2,
    textSha256: "c".repeat(64),
    text: "# Delivery\nDone.",
    ledgerEventId: "ledger_event_secret",
    ledgerEventSeq: 2,
    ledgerEventSha256: "d".repeat(64),
  };
}

function download(): PlanArtifactFileDownload {
  return {
    blob: new Blob(["# Delivery\nDone."]),
    filename: "report.md",
    sha256: "a".repeat(64),
    sizeBytes: 16,
    ledgerEventId: "event_2",
    ledgerEventSeq: 2,
    ledgerEventSha256: "d".repeat(64),
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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = findElementsByLocalName(container, "button").find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

function findElementsByLocalName(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (typeof child.localName === "string" && child.localName === localName) {
      matches.push(child);
    }
    matches.push(...findElementsByLocalName(child, localName));
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

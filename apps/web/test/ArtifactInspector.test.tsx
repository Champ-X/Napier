import { resolveObjectURL } from "node:buffer";
import { createHash } from "node:crypto";
import { filePreviewContentType } from "@napier/contracts/file-preview";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactInspection } from "../src/artifact-inspection";
import type {
  PlanArtifactFilePreviewReceipt,
  PlanArtifactTextPreviewReceipt,
} from "../src/artifact-file-api";
import { ArtifactInspector } from "../src/ArtifactInspector";

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

describe("ArtifactInspector", () => {
  it.each(["resolve", "reject"] as const)(
    "ignores a stale %s after switching files during a pending refresh",
    async (outcome) => {
      const { container } = installDom();
      const oldFile = fileReceipt("outputs/old.png");
      const oldInspection = {
        ...fileInspection(oldFile.path),
        receipt: oldFile,
      };
      const nextInspection = fileInspection("outputs/new.png");
      nextInspection.artifact.id = "new-artifact";
      const nextFile = {
        ...fileReceipt(nextInspection.artifact.path),
        artifactId: nextInspection.artifact.id,
      };
      const stale = deferred<PlanArtifactFilePreviewReceipt>();
      const next = deferred<PlanArtifactFilePreviewReceipt>();
      const previewArtifactFile = vi.fn(
        async (_threadId: string, _planId: string, artifactId: string) =>
          artifactId === "new-artifact" ? next.promise : stale.promise,
      );
      const onLedgerChanged = vi.fn();
      const renderInspection = async (inspection: ArtifactInspection) =>
        act(async () => {
          render(
            <ArtifactInspector
              inspection={inspection}
              onClose={() => undefined}
              previewArtifactFile={previewArtifactFile}
              onLedgerChanged={onLedgerChanged}
            />,
            container,
          );
        });
      await renderInspection(oldInspection);
      await waitFor(() => elements(container, "img").length === 1);
      await click(button(container, "Refresh"));
      await renderInspection(nextInspection);
      await waitFor(() => previewArtifactFile.mock.calls.length === 2);
      await act(async () => {
        if (outcome === "resolve") stale.resolve({ ...oldFile });
        else stale.reject(new Error("Stale file request failed"));
      });
      expect(elements(container, "img")).toHaveLength(0);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(button(container, "Refresh").disabled).toBe(true);
      expect(onLedgerChanged).not.toHaveBeenCalled();
      await act(async () => next.resolve(nextFile));
      await waitFor(() => elements(container, "img").length === 1);
      expect(elements(container, "img")[0]?.getAttribute("alt")).toBe(
        "new.png",
      );
      expect(button(container, "Refresh").disabled).toBe(false);
      expect(onLedgerChanged).toHaveBeenCalledOnce();
    },
  );

  it("retries an unavailable HTML sandbox URL when refreshed bytes are unchanged", async () => {
    const { container } = installDom();
    const inspection = htmlInspection();
    const previewArtifact = vi.fn(async () => ({ ...inspection.receipt }));
    const file = await previewFile(inspection.artifact.path);
    const retryPreviewFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Preview link expired"))
      .mockResolvedValueOnce(file);
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          previewArtifact={previewArtifact}
          previewFile={retryPreviewFile}
        />,
        container,
      );
    });
    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    await click(button(container, "Refresh"));
    await waitFor(() => elements(container, "iframe").length === 1);
    expect(retryPreviewFile).toHaveBeenCalledTimes(2);
    expect(retryPreviewFile).toHaveBeenLastCalledWith(
      inspection.artifact.path,
      expect.any(AbortSignal),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps undecodable text downloadable as its original verified bytes", async () => {
    const { container } = installDom();
    const file = {
      ...fileReceipt("outputs/legacy.txt"),
      blob: new Blob([Uint8Array.from([0xff, 0x80, 0x00])]),
      textError: "Text preview requires valid UTF-8 or BOM-marked UTF-16 text",
    };
    const previewArtifact = vi.fn(async () => {
      throw new Error(file.textError);
    });
    const previewArtifactFile = vi.fn(async () => file);
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={fileInspection(file.path)}
          onClose={() => undefined}
          previewArtifact={previewArtifact}
          previewArtifactFile={previewArtifactFile}
        />,
        container,
      );
    });
    await waitFor(
      () => container.textContent?.includes(file.textError) === true,
    );
    expect(previewArtifact).toHaveBeenCalledOnce();
    expect(previewArtifactFile).toHaveBeenCalledOnce();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    await click(button(container, "Download"));
    expect(createObjectURL).toHaveBeenCalledWith(file.blob);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["png", "jpg", "gif", "webp", "avif", "bmp", "ico", "pdf"])(
    "renders %s artifact bytes without the text endpoint or binary source actions",
    async (extension) => {
      const { container } = installDom();
      const inspection = fileInspection(`outputs/drawing.${extension}`);
      const file = fileReceipt(inspection.artifact.path);
      const previewArtifactFile = vi.fn(async () => file);
      const previewArtifact = vi.fn();
      const previewDiff = vi.fn();
      const previewFile = vi.fn();
      const onLedgerChanged = vi.fn();
      await act(async () => {
        render(
          <ArtifactInspector
            inspection={inspection}
            onClose={() => undefined}
            previewArtifactFile={previewArtifactFile}
            previewArtifact={previewArtifact}
            previewDiff={previewDiff}
            previewFile={previewFile}
            onLedgerChanged={onLedgerChanged}
          />,
          container,
        );
      });
      const element = extension === "pdf" ? "iframe" : "img";
      await waitFor(() => elements(container, element).length === 1);
      const url = elements(container, element)[0]!.getAttribute("src")!;
      expect(resolveObjectURL(url)?.type).toBe(file.contentType);
      expect(previewArtifactFile).toHaveBeenCalledWith(
        "thread_1",
        "plan_1",
        "slides",
      );
      expect(previewArtifact).not.toHaveBeenCalled();
      expect(previewFile).not.toHaveBeenCalled();
      expect(button(container, "Raw source").disabled).toBe(true);
      expect(button(container, "Changes").disabled).toBe(true);
      expect(previewDiff).not.toHaveBeenCalled();
      expect(onLedgerChanged).toHaveBeenCalledOnce();
      await act(async () => render(null, container));
      expect(resolveObjectURL(url)).toBeUndefined();
    },
  );

  it("uses a supplied binary receipt and refreshes through its artifact identity", async () => {
    const { container } = installDom();
    const receipt = fileReceipt("outputs/drawing.png");
    const inspection = { ...fileInspection(receipt.path), receipt };
    const refreshed = {
      ...receipt,
      sha256: "e".repeat(64),
      blob: new Blob(["new pixels"], { type: receipt.contentType }),
    };
    const previewArtifactFile = vi.fn(async () => refreshed);
    const previewArtifact = vi.fn();
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          previewArtifactFile={previewArtifactFile}
          previewArtifact={previewArtifact}
        />,
        container,
      );
    });
    await waitFor(() => elements(container, "img").length === 1);
    const url = elements(container, "img")[0]!.getAttribute("src")!;
    expect(previewArtifactFile).not.toHaveBeenCalled();
    await click(button(container, "Refresh"));
    await waitFor(
      () => elements(container, "img")[0]?.getAttribute("src") !== url,
    );
    expect(previewArtifactFile).toHaveBeenCalledOnce();
    expect(previewArtifact).not.toHaveBeenCalled();
    expect(resolveObjectURL(url)).toBeUndefined();
  });

  it.each(["docx", "xlsx", "pptx", "zip"])(
    "offers download without interpreting unsupported %s as text",
    async (extension) => {
      const { container } = installDom();
      const inspection = fileInspection(`outputs/report.${extension}`);
      const previewArtifactFile = vi.fn(async () =>
        fileReceipt(inspection.artifact.path),
      );
      const previewArtifact = vi.fn();
      await act(async () => {
        render(
          <ArtifactInspector
            inspection={inspection}
            onClose={() => undefined}
            previewArtifactFile={previewArtifactFile}
            previewArtifact={previewArtifact}
          />,
          container,
        );
      });
      await waitFor(
        () =>
          container.querySelector(".workspace-file-preview-unavailable") !==
          null,
      );
      expect(button(container, "Download").disabled).toBe(false);
      expect(previewArtifact).not.toHaveBeenCalled();
      expect(elements(container, "img")).toHaveLength(0);
      expect(elements(container, "iframe")).toHaveLength(0);
      expect(container.textContent).not.toContain("UTF-8");
    },
  );

  it.each([true, false])(
    "loads large HTML with a complete sandbox URL when size is known: %s",
    async (knownSize) => {
      const { container } = installDom();
      const inspection = fileInspection("outputs/large.html");
      if (knownSize) inspection.artifact.sizeBytes = 3 * 1024 * 1024;
      const file = {
        ...fileReceipt(inspection.artifact.path),
        text: "<main>partial",
        textTruncated: true,
      };
      const previewArtifactFile = vi.fn(async () => file);
      const previewArtifact = vi.fn(async () => {
        throw new Error("Artifact preview exceeds the 2 MiB text limit");
      });
      const previewFile = vi.fn(async () => ({
        ...file,
        previewUrl: "/api/workspace/preview/large.html",
      }));
      await act(async () => {
        render(
          <ArtifactInspector
            inspection={inspection}
            onClose={() => undefined}
            previewArtifactFile={previewArtifactFile}
            previewArtifact={previewArtifact}
            previewFile={previewFile}
          />,
          container,
        );
      });
      await waitFor(() => elements(container, "iframe").length === 1);
      expect(previewArtifact).toHaveBeenCalledTimes(knownSize ? 0 : 1);
      expect(previewArtifactFile).toHaveBeenCalledOnce();
      expect(previewFile).toHaveBeenCalledWith(
        inspection.artifact.path,
        expect.any(AbortSignal),
      );
      expect(elements(container, "iframe")[0]?.getAttribute("src")).toBe(
        "/api/workspace/preview/large.html",
      );
      expect(
        elements(container, "iframe")[0]?.getAttribute("srcdoc"),
      ).toBeNull();
    },
  );

  it("does not retry artifact integrity failures through another file endpoint", async () => {
    const { container } = installDom();
    const inspection = fileInspection("outputs/report.md");
    const previewArtifactFile = vi.fn();
    const previewArtifact = vi.fn(async () => {
      throw new Error("Artifact digest does not match verified evidence");
    });
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          previewArtifactFile={previewArtifactFile}
          previewArtifact={previewArtifact}
        />,
        container,
      );
    });
    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    expect(container.textContent).toContain("digest does not match");
    expect(previewArtifactFile).not.toHaveBeenCalled();
  });

  it("previews SVG receipt content as an image while preserving source and changes", async () => {
    const { container } = installDom();
    const inspection = svgInspection();
    const previewArtifact = vi.fn(async () => inspection.receipt);
    const previewFile = vi.fn();
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          previewArtifact={previewArtifact}
          previewFile={previewFile}
          previewDiff={async () => diffReceipt()}
        />,
        container,
      );
    });
    await waitFor(() => elements(container, "img").length === 1);
    const image = elements(container, "img")[0]!;
    const url = image.getAttribute("src")!;
    const blob = resolveObjectURL(url)!;
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(await blob.text()).toBe(inspection.receipt.text);
    expect(image.getAttribute("alt")).toBe("drawing.SVG");
    expect(
      elements(container, "svg").some((node) => node.id === "artwork"),
    ).toBe(false);
    expect(elements(container, "iframe")).toHaveLength(0);
    expect(previewArtifact).not.toHaveBeenCalled();
    expect(previewFile).not.toHaveBeenCalled();

    await click(button(container, "Raw source"));
    expect(elements(container, "img")).toHaveLength(0);
    expect(container.textContent).toContain(inspection.receipt.text);
    expect(resolveObjectURL(url)).toBeUndefined();

    await click(button(container, "Changes"));
    expect(container.textContent).toContain("+after");
    await click(button(container, "Preview"));
    await waitFor(() => elements(container, "img").length === 1);
    const nextUrl = elements(container, "img")[0]!.getAttribute("src")!;
    expect(await resolveObjectURL(nextUrl)!.text()).toBe(
      inspection.receipt.text,
    );
    await act(async () => render(null, container));
    expect(resolveObjectURL(nextUrl)).toBeUndefined();
  });

  it.each([
    { failure: "malformed SVG", text: "<svg>broken" },
    { failure: "transient load error", text: svgInspection().receipt.text },
  ])("recovers from $failure on refresh", async ({ text }) => {
    const { container, document } = installDom();
    const inspection = svgInspection(text);
    const refreshed = svgInspection().receipt;
    const previewArtifact = vi.fn(async () => refreshed);
    await act(async () => {
      render(
        <ArtifactInspector
          inspection={inspection}
          onClose={() => undefined}
          previewArtifact={previewArtifact}
        />,
        container,
      );
    });
    await waitFor(() => elements(container, "img").length === 1);
    const image = elements(container, "img")[0]!;
    const url = image.getAttribute("src")!;
    await act(async () =>
      image.dispatchEvent(new document.defaultView!.Event("error")),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "SVG preview could not be loaded",
    );
    expect(button(container, "Raw source")).toBeDefined();

    await click(button(container, "Refresh"));
    await waitFor(() => elements(container, "img").length === 1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(resolveObjectURL(url)).toBeUndefined();
    const nextUrl = elements(container, "img")[0]!.getAttribute("src")!;
    expect(await resolveObjectURL(nextUrl)!.text()).toBe(refreshed.text);
  });

  it("runs self-contained HTML interactions without granting origin access", async () => {
    const { document, container } = installDom();
    await act(async () => {
      render(
        <ArtifactInspector
          previewFile={previewFile}
          inspection={htmlInspection()}
          onClose={() => undefined}
        />,
        container,
      );
    });

    await waitFor(() => elements(container, "iframe").length === 1);
    const frame = elements(container, "iframe")[0];
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-popups");
    expect(frame?.getAttribute("title")).toBe("HTML artifact preview");
    expect(frame?.getAttribute("src")).toBe(
      "/api/workspace/preview/site/slides.html",
    );
    expect(frame?.getAttribute("srcdoc")).toBeNull();
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
          previewFile={previewFile}
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
    expect(frame?.getAttribute("src")).toBe(
      "/api/workspace/preview/site/slides.html",
    );
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
          previewFile={previewFile}
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
    await waitFor(() => elements(container, "iframe").length === 1);
    expect(elements(container, "iframe")).toHaveLength(1);
    expect(onLedgerChanged).toHaveBeenCalledOnce();

    const nextOnLedgerChanged = vi.fn(async () => undefined);
    await act(async () => {
      render(
        <ArtifactInspector
          previewFile={previewFile}
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

async function previewFile(path: string) {
  return {
    path,
    filename: "slides.html",
    contentType: "text/html",
    blob: new Blob([]),
    sizeBytes: 71,
    sha256: "b".repeat(64),
    previewUrl: "/api/workspace/preview/site/slides.html",
  };
}

function fileInspection(
  path: string,
): Extract<ArtifactInspection, { mode: "preview" }> {
  const { receipt: _receipt, ...inspection } = htmlInspection();
  return { ...inspection, artifact: { ...inspection.artifact, path } };
}

function fileReceipt(path: string): PlanArtifactFilePreviewReceipt {
  const {
    text: _text,
    lineCount: _lineCount,
    textSha256: _textSha256,
    ...receipt
  } = htmlInspection().receipt;
  const contentType = filePreviewContentType(path);
  const blob = new Blob(["verified artifact bytes"], { type: contentType });
  return {
    ...receipt,
    kind: "napier.plan-artifact-file-preview",
    path,
    filename: path.split("/").at(-1)!,
    contentType,
    blob,
    sizeBytes: blob.size,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

function htmlInspection(): Extract<ArtifactInspection, { mode: "preview" }> & {
  receipt: PlanArtifactTextPreviewReceipt;
} {
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

function svgInspection(
  text = '<svg id="artwork" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><circle r="10"><animate attributeName="r" values="10;20;10" dur="1s" repeatCount="indefinite"/></circle></svg>',
) {
  const base = htmlInspection();
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    ...base,
    artifact: { ...base.artifact, path: "outputs/drawing.SVG" },
    receipt: {
      ...base.receipt,
      text,
      sha256,
      textSha256: sha256,
      sizeBytes: Buffer.byteLength(text),
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

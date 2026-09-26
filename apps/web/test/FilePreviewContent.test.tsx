import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { artifactInspectorCopy as copy } from "../src/artifact-inspector-copy";
import { FilePreviewContent } from "../src/FilePreviewContent";
import {
  FileSourcePreview,
  limitFilePreviewText,
  MAX_FILE_PREVIEW_CHARACTERS,
  MAX_FILE_PREVIEW_LINES,
} from "../src/FileSourcePreview";
import type { WorkspaceFilePreview } from "../src/workspace-directory-api";
import { WorkspaceFileInspector } from "../src/WorkspaceFileInspector";

const containers: HTMLElement[] = [];

afterEach(async () => {
  for (const container of containers.splice(0)) {
    await act(async () => render(null, container));
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FilePreviewContent", () => {
  it("renders SVG as an image even when source text is available, and revokes URLs on view changes", async () => {
    const { container, urls, revoked } = installDom();
    const preview = filePreview("drawing.svg", "image/svg+xml", "<svg/>");
    await show(container, preview);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:fixture-1",
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(urls).toHaveBeenCalledWith(preview.blob);

    await show(container, preview, "source");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("<svg/>");
    expect(revoked).toHaveBeenCalledWith("blob:fixture-1");

    await show(container, preview);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:fixture-2",
    );
    await act(async () => render(null, container));
    expect(revoked).toHaveBeenCalledWith("blob:fixture-2");
  });

  it("shows image decode failures and allows same-content refreshes without keeping stale images", async () => {
    const { container, revoked } = installDom();
    const preview = filePreview("drawing.png", "image/png");
    await show(container, preview);
    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      copy.imageUnavailable,
    );
    expect(container.querySelector("img")).toBeNull();

    await show(container, { ...preview });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:fixture-2",
    );
    expect(revoked).toHaveBeenCalledWith("blob:fixture-1");
  });

  it("uses the original PDF blob and keeps HTML scripts sandboxed", async () => {
    const { container, urls, revoked } = installDom();
    const pdf = filePreview("report.pdf", "application/pdf", "%PDF-1.4");
    await show(container, pdf);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "blob:fixture-1",
    );
    expect(urls).toHaveBeenCalledWith(pdf.blob);
    expect(container.querySelector("code")).toBeNull();

    const html = {
      ...filePreview(
        "index.html",
        "text/html; charset=utf-8",
        "<h1>hello</h1>",
      ),
      previewUrl: "/api/workspace/preview/site/index.html",
      textTruncated: true,
    };
    await show(container, html);
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(html.previewUrl);
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(revoked).toHaveBeenCalledWith("blob:fixture-1");
    await show(container, html, "source");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.textPreviewPartial,
    );
  });

  it("bounds Markdown rendering and distinguishes partial text from decoding errors", async () => {
    const { container } = installDom();
    const text = Array.from(
      { length: 2_001 },
      (_, index) => `# Heading ${String(index)}`,
    ).join("\n");
    const markdown = filePreview("report.markdown", "text/markdown", text);
    await show(container, markdown);
    expect(container.querySelectorAll("article h3")).toHaveLength(2_000);
    expect(container.textContent).not.toContain("Heading 2000");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.previewTruncated,
    );
    expect(markdown.text).toBe(text);

    await show(container, {
      ...filePreview("short.md", "text/markdown", "# Partial"),
      textTruncated: true,
    });
    expect(container.querySelector("article h3")?.textContent).toBe("Partial");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.textPreviewPartial,
    );

    await show(container, {
      ...filePreview("invalid.txt", "text/plain"),
      textError: copy.textEncodingUnavailable,
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.textEncodingUnavailable,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("keeps a readable source button for SVG and download available after text decoding fails", async () => {
    const { container } = installDom();
    const previewFile = vi.fn(async () =>
      filePreview("drawing.svg", "image/svg+xml", "<svg/>"),
    );
    await act(async () =>
      render(
        <WorkspaceFileInspector
          path="drawing.svg"
          onClose={() => undefined}
          previewFile={previewFile}
        />,
        container,
      ),
    );
    await waitFor(() => elements(container, "img").length === 1);
    const source = elements(container, "button").find(
      (element) => element.getAttribute("title") === copy.source,
    ) as HTMLElement;
    expect(source).toBeDefined();
    await act(async () => source.click());
    expect(elements(container, "code")[0]?.textContent).toBe("<svg/>");

    const invalidPreviewFile = async () => ({
      ...filePreview("invalid.txt", "text/plain"),
      textError: copy.textEncodingUnavailable,
    });
    await act(async () =>
      render(
        <WorkspaceFileInspector
          key="invalid"
          path="invalid.txt"
          onClose={() => undefined}
          previewFile={invalidPreviewFile}
        />,
        container,
      ),
    );
    await waitFor(() =>
      elements(container, "p").some(
        (element) => element.getAttribute("role") === "status",
      ),
    );
    expect(
      elements(container, "button")
        .find((element) => element.getAttribute("aria-label") === copy.download)
        ?.hasAttribute("disabled"),
    ).toBe(false);
  });

  it("does not display the previous file while a different workspace file is loading", async () => {
    const { container, revoked } = installDom();
    let resolveNext: ((preview: WorkspaceFilePreview) => void) | undefined;
    const next = new Promise<WorkspaceFilePreview>((resolve) => {
      resolveNext = resolve;
    });
    const previewFile = vi.fn((path: string) =>
      path === "first.png"
        ? Promise.resolve(filePreview(path, "image/png"))
        : next,
    );
    const onClose = () => undefined;
    await act(async () =>
      render(
        <WorkspaceFileInspector
          path="first.png"
          previewFile={previewFile}
          onClose={onClose}
        />,
        container,
      ),
    );
    await waitFor(() => elements(container, "img").length === 1);
    await act(async () => {
      render(
        <WorkspaceFileInspector
          path="second.png"
          previewFile={previewFile}
          onClose={onClose}
        />,
        container,
      );
      expect(elements(container, "img")).toHaveLength(0);
    });
    expect(revoked).toHaveBeenCalledWith("blob:fixture-1");
    await act(async () =>
      resolveNext?.(filePreview("second.png", "image/png")),
    );
    await waitFor(() => elements(container, "img").length === 1);
    expect(elements(container, "img")[0]?.getAttribute("alt")).toBe(
      "second.png",
    );
  });
});

describe("FileSourcePreview", () => {
  it("caps huge line sets, preserves CRLF and diff styling, and leaves input intact", async () => {
    const { container } = installDom();
    const text = [
      "+added",
      "-removed",
      ...Array.from({ length: 50_000 }, (_, i) => String(i)),
    ].join("\r\n");
    await act(async () =>
      render(<FileSourcePreview text={text} diff />, container),
    );
    expect(container.querySelectorAll("li")).toHaveLength(
      MAX_FILE_PREVIEW_LINES,
    );
    expect(container.querySelector("li.is-added")?.textContent).toBe("+added");
    expect(container.querySelector("li.is-removed")?.textContent).toBe(
      "-removed",
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.previewTruncated,
    );
    expect(text.endsWith("49999")).toBe(true);
  });

  it("bounds one long line without splitting a Unicode surrogate pair", () => {
    const text = "x".repeat(MAX_FILE_PREVIEW_CHARACTERS - 1) + "🚲tail";
    const bounded = limitFilePreviewText(text);
    expect(bounded.text.length).toBe(MAX_FILE_PREVIEW_CHARACTERS - 1);
    expect(bounded.text.endsWith("x")).toBe(true);
    expect(bounded.truncated).toBe(true);
    expect(limitFilePreviewText("small\r\ntext")).toEqual({
      text: "small\r\ntext",
      truncated: false,
    });
  });
});

function filePreview(
  path: string,
  contentType: string,
  text?: string,
): WorkspaceFilePreview {
  const blob = new Blob([text ?? "fixture bytes"], { type: contentType });
  return {
    path,
    filename: path,
    contentType,
    blob,
    sizeBytes: blob.size,
    sha256: "a".repeat(64),
    ...(text !== undefined ? { text } : {}),
  };
}

async function show(
  container: HTMLElement,
  preview: WorkspaceFilePreview,
  view: "preview" | "source" = "preview",
) {
  await act(async () =>
    render(<FilePreviewContent preview={preview} view={view} />, container),
  );
}

function installDom() {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("document", parsed.document);
  vi.stubGlobal("window", parsed.window);
  vi.stubGlobal("navigator", parsed.window.navigator);
  vi.stubGlobal("HTMLElement", parsed.window.HTMLElement);
  vi.stubGlobal("Event", parsed.window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let count = 0;
  const urls = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:fixture-${String(++count)}`);
  const revoked = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  const container = parsed.document.querySelector("#root") as HTMLElement;
  containers.push(container);
  return { container, urls, revoked };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  expect(predicate()).toBe(true);
}

function elements(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.localName === localName) matches.push(child);
    matches.push(...elements(child, localName));
  }
  return matches;
}

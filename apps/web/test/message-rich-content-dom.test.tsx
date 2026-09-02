import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageMarkdown } from "../src/message-markdown";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("rich answer content", () => {
  it("renders safe images, flowcharts, and inert HTML previews", async () => {
    const container = installDom();
    const answer = [
      "![Remote result](https://images.example.test/result.png)",
      "",
      "![Workspace result](assets/result.webp)",
      "",
      "![Rejected vector](javascript:alert(1).svg)",
      "",
      "```mermaid",
      "flowchart LR",
      "request[Request] --> model(Model)",
      "model --> answer((Answer))",
      "```",
      "",
      "```html",
      '<main onclick="alert(1)"><a href="https://example.test" ping="https://track.example.test">Preview</a><img src="https://images.example.test/tracker.png"><img src="data:image/png;base64,iVBORw0KGgo="><script>alert(2)</script></main>',
      "```",
      "",
      "<script>raw HTML is text</script>",
    ].join("\n");

    await act(async () => render(<MessageMarkdown text={answer} />, container));

    const images = elements(container, "img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("src")).toBe(
      "https://images.example.test/result.png",
    );
    expect(
      images[0]?.getAttribute("referrerpolicy") ??
        images[0]?.getAttribute("referrerPolicy"),
    ).toBe("no-referrer");
    expect(images[1]?.getAttribute("src")).toBe(
      "/api/workspace/file?path=assets%2Fresult.webp",
    );
    expect(container.textContent).toContain(
      "![Rejected vector](javascript:alert(1).svg)",
    );

    expect(elements(container, "figure")).toHaveLength(1);
    expect(elements(container, "svg")).toHaveLength(1);
    expect(container.textContent).toContain("Request");
    expect(container.textContent).toContain("Answer");

    const frame = elements(container, "iframe")[0];
    expect(frame?.getAttribute("sandbox")).toBe("");
    const document =
      frame?.getAttribute("srcdoc") ?? frame?.getAttribute("srcDoc") ?? "";
    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain("onclick");
    expect(document).not.toContain("href=");
    expect(document).not.toContain("ping=");
    expect(document).not.toContain("https://images.example.test/tracker.png");
    expect(document).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(document).not.toContain("<script");
    expect(document).toContain("Preview");
    expect(elements(container, "script")).toHaveLength(0);
    expect(container.textContent).toContain("raw HTML is text");
  });

  it("falls back to highlighted source for unsupported Mermaid syntax", async () => {
    const container = installDom();
    const source = "sequenceDiagram\nBrowser->>Server: request";
    await act(async () => {
      render(
        <MessageMarkdown text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
        container,
      );
    });

    expect(elements(container, "svg")).toHaveLength(0);
    expect(elements(container, "code")[0]?.textContent).toBe(source);
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
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}

function elements(root: Element, localName: string): Element[] {
  const output: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.localName === localName) output.push(child);
    output.push(...elements(child, localName));
  }
  return output;
}

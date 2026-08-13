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

describe("Message code highlighting DOM", () => {
  it("renders semantic spans while preserving exact code text", async () => {
    const container = installDom();
    const source = [
      'const script = "<script>alert(1)</script>";',
      "// untrusted HTML remains text",
      "if (script) return 42;",
    ].join("\n");
    await act(async () => {
      render(
        <MessageMarkdown text={`\`\`\`ts\n${source}\n\`\`\``} />,
        container,
      );
    });

    const code = findElementsByLocalName(container, "code")[0];
    expect(code?.textContent).toBe(source);
    expect(
      findByClass(container, "message-code-token is-keyword"),
    ).not.toHaveLength(0);
    expect(
      findByClass(container, "message-code-token is-string"),
    ).not.toHaveLength(0);
    expect(
      findByClass(container, "message-code-token is-comment"),
    ).not.toHaveLength(0);
    expect(findElementsByLocalName(container, "script")).toHaveLength(0);
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

function findByClass(root: Element, className: string): Element[] {
  return descendants(root).filter(
    (element) => element.getAttribute("class") === className,
  );
}

function findElementsByLocalName(root: Element, localName: string): Element[] {
  return descendants(root).filter(
    (element) =>
      typeof element.localName === "string" && element.localName === localName,
  );
}

function descendants(root: Element): Element[] {
  const output: Element[] = [];
  for (const child of Array.from(root.children)) {
    output.push(child, ...descendants(child));
  }
  return output;
}

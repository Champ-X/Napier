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

describe("Message workspace links", () => {
  it("links only exact authoritative artifact paths", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <MessageMarkdown
          text={[
            "Open [the report](artifacts/report.md).",
            "Review `artifacts/report.md` and `.env`.",
            "Read [docs](https://example.com/docs).",
            "Ignore [unknown](artifacts/unknown.md).",
          ].join("\n")}
          workspaceLinks={[
            {
              path: "artifacts/report.md",
              targetId: "conversation-artifact-plan_1-artifact_report-5",
            },
          ]}
        />,
        container,
      );
    });

    const links = findElementsByLocalName(container, "a");
    expect(
      links.map((link) => ({
        href: link.getAttribute("href"),
        className: link.getAttribute("class") || null,
        text: link.textContent,
        target: link.getAttribute("target"),
      })),
    ).toEqual([
      {
        href: "#conversation-artifact-plan_1-artifact_report-5",
        className: "message-workspace-link",
        text: "the report",
        target: null,
      },
      {
        href: "#conversation-artifact-plan_1-artifact_report-5",
        className: "message-workspace-link is-code",
        text: "artifacts/report.md",
        target: null,
      },
      {
        href: "https://example.com/docs",
        className: null,
        text: "docs",
        target: "_blank",
      },
    ]);
    expect(container.textContent).toContain(".env");
    expect(container.textContent).toContain(
      "[unknown](artifacts/unknown.md)",
    );
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

function findElementsByLocalName(
  root: Element,
  localName: string,
): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (
      typeof child.localName === "string" &&
      child.localName === localName
    ) {
      matches.push(child);
    }
    matches.push(...findElementsByLocalName(child, localName));
  }
  return matches;
}

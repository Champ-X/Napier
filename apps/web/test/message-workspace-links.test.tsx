import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageMarkdown } from "../src/message-markdown";
import type { ArtifactInspection } from "../src/artifact-inspection";

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
          citationLinks={[
            {
              citationId: "citation_fixture0001",
              targetId: "conversation-citation-citation_fixture0001-7",
              index: 1,
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
    expect(container.textContent).toContain("[unknown](artifacts/unknown.md)");
  });

  it("links only citation tokens backed by strict ledger evidence", async () => {
    const container = installDom();
    await act(async () => {
      render(
        <MessageMarkdown
          text={[
            "Supported claim. [citation:citation_fixture0001]",
            "Unbound claim. [citation:citation_unknown0001]",
          ].join("\n")}
          citationLinks={[
            {
              citationId: "citation_fixture0001",
              targetId: "conversation-citation-citation_fixture0001-7",
              index: 1,
            },
          ]}
        />,
        container,
      );
    });

    const links = findElementsByLocalName(container, "a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "#conversation-citation-citation_fixture0001-7",
    );
    expect(links[0]?.getAttribute("aria-label")).toBe("Citation 1");
    expect(links[0]?.textContent).toBe("[1]");
    expect(container.textContent).toContain("[citation:citation_unknown0001]");
  });

  it("opens an authoritative artifact from a bold inline file chip", async () => {
    const container = installDom();
    const onInspectArtifact = vi.fn<(inspection: ArtifactInspection) => void>();
    const artifact = {
      id: "artifact_report",
      path: "artifacts/report.html",
      kind: "file" as const,
      description: "Interactive report",
      status: "verified" as const,
      evidence: "verified",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    await act(async () => {
      render(
        <MessageMarkdown
          text="Done: **`artifacts/report.html`**"
          workspaceLinks={[
            {
              artifact,
              path: artifact.path,
              planId: "plan_1",
              threadId: "thread_1",
              targetId: "artifact-card-1",
            },
          ]}
          onInspectArtifact={onInspectArtifact}
        />,
        container,
      );
    });

    const chip = findElementsByLocalName(
      container,
      "a",
    )[0] as HTMLAnchorElement;
    await act(async () => chip.click());

    expect(chip.getAttribute("data-artifact-path")).toBe(artifact.path);
    expect(chip.textContent).toBe(artifact.path);
    expect(onInspectArtifact).toHaveBeenCalledWith({
      artifact,
      mode: "preview",
      planId: "plan_1",
      threadId: "thread_1",
    });
  });

  it("opens file references that exist in the live workspace but lack an artifact record", async () => {
    const container = installDom();
    const onOpenWorkspaceFile = vi.fn<(path: string) => void>();
    await act(async () => {
      render(
        <MessageMarkdown
          text={[
            "已完成 `index.html` 的配色重写。",
            "也可以打开 [完整页面](./slides/final.html)。",
            "不要链接 `#f7f3ec`、`.env` 或 `npm test`。",
          ].join("\n")}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />,
        container,
      );
    });

    const fileButtons = findElementsByLocalName(container, "button");
    expect(
      fileButtons.map((button) => ({
        path: button.getAttribute("data-workspace-path"),
        label: button.textContent,
        ariaLabel: button.getAttribute("aria-label"),
      })),
    ).toEqual([
      {
        path: "index.html",
        label: "index.html",
        ariaLabel: "Open preview: index.html",
      },
      {
        path: "./slides/final.html",
        label: "完整页面",
        ariaLabel: "Open preview: ./slides/final.html",
      },
    ]);

    await act(async () => fileButtons[0]?.click());
    await act(async () => fileButtons[1]?.click());
    expect(onOpenWorkspaceFile).toHaveBeenNthCalledWith(1, "index.html");
    expect(onOpenWorkspaceFile).toHaveBeenNthCalledWith(
      2,
      "./slides/final.html",
    );
    expect(container.textContent).toContain("#f7f3ec");
    expect(container.textContent).toContain(".env");
    expect(container.textContent).toContain("npm test");
  });

  it("promotes a referenced workspace image into an inline preview", async () => {
    const container = installDom();
    const onOpenWorkspaceFile = vi.fn<(path: string) => void>();
    await act(async () => {
      render(
        <MessageMarkdown
          text="已下载 `fifa2026-houston-poster.jpg` — 海报原图。"
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />,
        container,
      );
    });

    const image = findElementsByLocalName(container, "img")[0];
    expect(image?.getAttribute("src")).toBe(
      "/api/workspace/file?path=fifa2026-houston-poster.jpg",
    );
    expect(image?.getAttribute("alt")).toBe("fifa2026-houston-poster.jpg");
    expect(
      image?.parentElement?.getAttribute("data-workspace-image-path"),
    ).toBe("fifa2026-houston-poster.jpg");
    expect(findElementsByLocalName(container, "button")[0]?.textContent).toBe(
      "fifa2026-houston-poster.jpg",
    );
  });

  it("resolves a bare filename against the nearest directory reference in the same sentence", async () => {
    const container = installDom();
    const onOpenWorkspaceFile = vi.fn<(path: string) => void>();
    await act(async () => {
      render(
        <MessageMarkdown
          text="仅在 `napier-frontend-skill-smoke/` 内创建了单文件 `index.html`。"
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />,
        container,
      );
    });

    const fileButton = findElementsByLocalName(container, "button")[0];
    expect(fileButton?.getAttribute("data-workspace-path")).toBe(
      "napier-frontend-skill-smoke/index.html",
    );
    expect(fileButton?.textContent).toBe("index.html");
    await act(async () => fileButton?.click());
    expect(onOpenWorkspaceFile).toHaveBeenCalledWith(
      "napier-frontend-skill-smoke/index.html",
    );
  });

  it("does not carry directory context across a sentence boundary", async () => {
    const container = installDom();
    const onOpenWorkspaceFile = vi.fn<(path: string) => void>();
    await act(async () => {
      render(
        <MessageMarkdown
          text="检查目录 `archive/`。然后打开 `index.html`。"
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />,
        container,
      );
    });

    expect(
      findElementsByLocalName(container, "button")[0]?.getAttribute(
        "data-workspace-path",
      ),
    ).toBe("index.html");
  });

  it("opens a receipt-bound Skill resource through its canonical virtual path", async () => {
    const container = installDom();
    const onOpenWorkspaceFile = vi.fn<(path: string) => void>();
    const onOpenSkillResource = vi.fn();
    const reference = {
      skillName: "frontend-design",
      resourcePath: "references/visual-quality-gate.md",
      relativePath: "skills/frontend-design/references/visual-quality-gate.md",
      virtualPath:
        "/bundled/skills/frontend-design/references/visual-quality-gate.md",
      rootKind: "bundled_standard" as const,
      rawContentSha256: "a".repeat(64),
    };
    await act(async () => {
      render(
        <MessageMarkdown
          text="加载了 `frontend-design`，并按 `references/visual-quality-gate.md` 检查。"
          skillResourceLinks={[reference]}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          onOpenSkillResource={onOpenSkillResource}
        />,
        container,
      );
    });

    const fileButton = findElementsByLocalName(container, "button")[0];
    expect(fileButton?.getAttribute("data-skill-resource-path")).toBe(
      reference.virtualPath,
    );
    expect(fileButton?.textContent).toBe(reference.resourcePath);
    await act(async () => fileButton?.click());
    expect(onOpenSkillResource).toHaveBeenCalledWith(reference);
    expect(onOpenWorkspaceFile).not.toHaveBeenCalled();
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

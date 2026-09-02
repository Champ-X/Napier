import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks, projectDiffLines } from "../src/message-markdown";

describe("Message Markdown", () => {
  it("parses headings, lists, quotes, paragraphs, and fenced code", () => {
    expect(
      parseMarkdownBlocks(
        [
          "## Result",
          "",
          "- first",
          "- second",
          "",
          "> verified source",
          "",
          "| Check | Status |",
          "| --- | --- |",
          "| Typecheck | Pass |",
          "",
          "Use `npm test` before delivery.",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "heading", level: 2, value: "Result" },
      { kind: "list", ordered: false, items: ["first", "second"] },
      { kind: "quote", value: "verified source" },
      {
        kind: "table",
        headers: ["Check", "Status"],
        rows: [["Typecheck", "Pass"]],
      },
      { kind: "paragraph", value: "Use `npm test` before delivery." },
      { kind: "code", language: "ts", value: "const value = 1;" },
    ]);
  });

  it("preserves code as text and does not parse HTML", () => {
    const blocks = parseMarkdownBlocks(
      "```html\n<script>alert('unsafe')</script>\n```\n\n<div>plain text</div>",
    );
    expect(blocks).toEqual([
      {
        kind: "code",
        language: "html",
        value: "<script>alert('unsafe')</script>",
      },
      { kind: "paragraph", value: "<div>plain text</div>" },
    ]);
  });

  it("classifies diff lines without interpreting their contents as markup", () => {
    expect(
      projectDiffLines(
        [
          "diff --git a/app.ts b/app.ts",
          "--- a/app.ts",
          "+++ b/app.ts",
          "@@ -1,2 +1,2 @@",
          "-const oldValue = '<script>';",
          "+const newValue = '<strong>';",
          " unchanged",
          "\\ No newline at end of file",
        ].join("\n"),
      ),
    ).toEqual([
      { value: "diff --git a/app.ts b/app.ts", tone: "metadata" },
      { value: "--- a/app.ts", tone: "metadata" },
      { value: "+++ b/app.ts", tone: "metadata" },
      { value: "@@ -1,2 +1,2 @@", tone: "hunk" },
      { value: "-const oldValue = '<script>';", tone: "deletion" },
      { value: "+const newValue = '<strong>';", tone: "addition" },
      { value: " unchanged", tone: "context" },
      { value: "\\ No newline at end of file", tone: "metadata" },
    ]);
  });

  it("never injects raw HTML and restricts links to http(s)", async () => {
    const [markdownSource, inlineSource] = await Promise.all([
      readFile(new URL("../src/message-markdown.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/message-markdown-inline.tsx", import.meta.url),
        "utf8",
      ),
    ]);
    expect(markdownSource).not.toContain("dangerouslySetInnerHTML");
    expect(inlineSource).not.toContain("dangerouslySetInnerHTML");
    expect(inlineSource).toContain('url.protocol === "https:"');
    expect(inlineSource).toContain('url.protocol === "http:"');
    expect(inlineSource).toContain('rel="noreferrer noopener"');
    expect(markdownSource).toContain("message-table-wrap");
    expect(markdownSource).toContain("language-${language}");
    expect(markdownSource).toContain("message-diff-line");
  });
});

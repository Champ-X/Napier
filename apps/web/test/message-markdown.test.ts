import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks } from "../src/message-markdown";

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

  it("never injects raw HTML and restricts links to http(s)", async () => {
    const source = await readFile(
      new URL("../src/message-markdown.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).toContain('url.protocol === "https:"');
    expect(source).toContain('url.protocol === "http:"');
    expect(source).toContain('rel="noreferrer noopener"');
    expect(source).toContain("message-table-wrap");
    expect(source).toContain("language-${block.language.toLowerCase()}");
  });
});

import { describe, expect, it } from "vitest";

import {
  highlightMessageCode,
  type MessageCodeTokenTone,
} from "../src/message-code-highlighting";

describe("Message code highlighting", () => {
  it.each([
    [
      "typescript",
      [
        "const greeting: string = \"hello\";",
        "// untrusted <script>",
        "if (greeting) return 42;",
      ].join("\n"),
      ["keyword", "string", "comment", "number"],
    ],
    [
      "json",
      '{"name":"Napier","enabled":true,"count":3}',
      ["property", "string", "literal", "number"],
    ],
    [
      "bash",
      ["if test -f package.json; then", "  echo \"ready\"", "fi # done"].join(
        "\n",
      ),
      ["keyword", "string", "comment"],
    ],
    [
      "python",
      ["def run(value: str):", "    # comment", "    return value or None"].join(
        "\n",
      ),
      ["keyword", "comment", "literal"],
    ],
    [
      "css",
      '.card { color: #fff; width: 12px; content: "<tag>"; }',
      ["number", "property", "string"],
    ],
    [
      "html",
      '<main class="card"><!-- comment --><strong>Safe</strong></main>',
      ["tag", "comment"],
    ],
  ] as const)(
    "highlights %s while preserving exact source text",
    (language, source, expectedTones) => {
      const tokens = highlightMessageCode(source, language);
      expect(tokens).toBeDefined();
      expect(tokens!.map((token) => token.value).join("")).toBe(source);
      const tones = new Set(
        tokens!
          .map((token) => token.tone)
          .filter((tone): tone is MessageCodeTokenTone => tone !== undefined),
      );
      expect([...tones]).toEqual(expect.arrayContaining([...expectedTones]));
    },
  );

  it("leaves unknown languages and unlabelled code untouched", () => {
    expect(highlightMessageCode("SELECT * FROM users", "sql")).toBeUndefined();
    expect(highlightMessageCode("<script>unsafe()</script>", undefined)).toBe(
      undefined,
    );
  });

  it("keeps unterminated strings and comments as exact text", () => {
    for (const [language, source] of [
      ["typescript", 'const value = "unterminated'],
      ["typescript", "/* unterminated"],
      ["jsonc", "// trailing"],
      ["html", "<!-- unterminated"],
    ] as const) {
      const tokens = highlightMessageCode(source, language);
      expect(tokens?.map((token) => token.value).join("")).toBe(source);
    }
  });
});

import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  MAX_LSP_SYMBOL_DEPTH,
  MAX_LSP_SYMBOL_DISPLAY_BYTES,
  MAX_LSP_SYMBOL_RANGE_CHARS,
  MAX_LSP_SYMBOL_RESPONSE_NODES,
  parseLspDocumentSymbols,
} from "../src/lsp-symbol-parser.js";

const TARGET_URI = pathToFileURL("/workspace/source.ts").href;

describe("LSP document symbol parser", () => {
  it("normalizes hierarchical symbols with exact nested ranges", () => {
    const source = [
      "namespace Defaults {",
      '  export const formatter = "title";',
      "}",
      "",
      "class TitleFormatter {",
      '  constructor(private readonly prefix = "") {}',
      "  format(value: string): string {",
      "    const normalize = (input: string) => input.trim();",
      "    return `${this.prefix}${normalize(value)}`;",
      "  }",
      "}",
    ].join("\n");
    const response = [
      documentSymbol("TitleFormatter", 5, range(4, 0, 10, 1), {
        selectionRange: range(4, 6, 4, 20),
        detail: "class TitleFormatter",
        children: [
          documentSymbol("format", 6, range(6, 2, 9, 3), {
            selectionRange: range(6, 2, 6, 8),
            children: [
              documentSymbol("normalize", 14, range(7, 4, 7, 54), {
                selectionRange: range(7, 10, 7, 19),
              }),
            ],
          }),
          documentSymbol("constructor", 9, range(5, 2, 5, 46), {
            selectionRange: range(5, 2, 5, 13),
          }),
        ],
      }),
      documentSymbol("Defaults", 3, range(0, 0, 2, 1), {
        selectionRange: range(0, 10, 0, 18),
        children: [
          documentSymbol("formatter", 14, range(1, 2, 1, 35), {
            selectionRange: range(1, 15, 1, 24),
          }),
        ],
      }),
    ];

    const parsed = parseLspDocumentSymbols(response, {
      source,
      targetUri: TARGET_URI,
      maxSymbols: 80,
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        responseShape: "hierarchical",
        responseSymbolCount: 6,
        omittedSymbolCount: 0,
        truncated: false,
        maxDepth: 2,
        deprecatedSymbolCount: 0,
        kindCounts: {
          namespace: 1,
          constant: 2,
          class: 1,
          constructor: 1,
          method: 1,
        },
      }),
    );
    expect(
      parsed.symbols.map(({ name, depth, containerName }) => ({
        name,
        depth,
        containerName,
      })),
    ).toEqual([
      { name: "Defaults", depth: 0, containerName: undefined },
      { name: "formatter", depth: 1, containerName: "Defaults" },
      { name: "TitleFormatter", depth: 0, containerName: undefined },
      {
        name: "constructor",
        depth: 1,
        containerName: "TitleFormatter",
      },
      { name: "format", depth: 1, containerName: "TitleFormatter" },
      { name: "normalize", depth: 2, containerName: "format" },
    ]);
    expect(parsed.symbols.at(-1)).toEqual(
      expect.objectContaining({
        signaturePreview: "const normalize = (input: string) => input.trim();",
        rangeSha256: sha256(
          "const normalize = (input: string) => input.trim();",
        ),
        selectionRangeSha256: sha256("normalize"),
        symbolSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("normalizes flat SymbolInformation without inventing hierarchy depth", () => {
    const source = "export const formatter = 1;\n";
    const response = [
      {
        name: "formatter",
        kind: 14,
        tags: [1],
        deprecated: false,
        location: {
          uri: TARGET_URI,
          range: range(0, 13, 0, 22),
        },
        containerName: "Defaults",
      },
    ];

    const parsed = parseLspDocumentSymbols(response, {
      source,
      targetUri: TARGET_URI,
      maxSymbols: 80,
    });

    expect(parsed.responseShape).toBe("flat");
    expect(parsed.symbols).toEqual([
      expect.objectContaining({
        name: "formatter",
        kindLabel: "constant",
        containerName: "Defaults",
        depth: 0,
        deprecated: true,
        rangeSha256: sha256("formatter"),
      }),
    ]);
  });

  it("returns an explicit empty result for null and empty responses", () => {
    for (const response of [null, []]) {
      expect(
        parseLspDocumentSymbols(response, {
          source: "",
          targetUri: TARGET_URI,
          maxSymbols: 80,
        }),
      ).toEqual({
        responseShape: "empty",
        responseSymbolCount: 0,
        symbols: [],
        omittedSymbolCount: 0,
        truncated: false,
        displayBytes: 0,
        maxDepth: 0,
        deprecatedSymbolCount: 0,
        kindCounts: {},
      });
    }
  });

  it("sorts and deduplicates before applying the requested result limit", () => {
    const source = "const first = 1;\nconst second = 2;\n";
    const first = documentSymbol("first", 14, range(0, 6, 0, 11));
    const second = documentSymbol("second", 14, range(1, 6, 1, 12));
    const parsed = parseLspDocumentSymbols([second, first, first], {
      source,
      targetUri: TARGET_URI,
      maxSymbols: 1,
    });

    expect(parsed.responseSymbolCount).toBe(3);
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(["first"]);
    expect(parsed.omittedSymbolCount).toBe(1);
    expect(parsed.truncated).toBe(true);
  });

  it("caps aggregate live display content independently of maxSymbols", () => {
    const lines = Array.from(
      { length: 100 },
      (_, index) => `const symbol${index} = "${"x".repeat(230)}";`,
    );
    const response = lines.map((line, index) =>
      documentSymbol(
        `symbol${index}${"n".repeat(180)}`,
        14,
        range(index, 0, index, line.length),
        { detail: "d".repeat(300) },
      ),
    );
    const parsed = parseLspDocumentSymbols(response, {
      source: lines.join("\n"),
      targetUri: TARGET_URI,
      maxSymbols: 256,
    });

    expect(parsed.displayBytes).toBeLessThanOrEqual(
      MAX_LSP_SYMBOL_DISPLAY_BYTES,
    );
    expect(parsed.symbols.length).toBeGreaterThan(0);
    expect(parsed.symbols.length).toBeLessThan(response.length);
    expect(parsed.omittedSymbolCount).toBe(
      response.length - parsed.symbols.length,
    );
    expect(parsed.truncated).toBe(true);
  });

  it("rejects aggregate source-range amplification before materialization", () => {
    const source = "x".repeat(1024 * 1024);
    const response = Array.from({ length: 9 }, (_, index) => ({
      name: `value${index}`,
      kind: 14,
      location: {
        uri: TARGET_URI,
        range: range(0, 0, 0, source.length),
      },
    }));

    expect(() =>
      parseLspDocumentSymbols(response, {
        source,
        targetUri: TARGET_URI,
        maxSymbols: 80,
      }),
    ).toThrow(
      `exceed ${MAX_LSP_SYMBOL_RANGE_CHARS} aggregate source-range characters`,
    );
  });

  it("uses UTF-16 positions and preserves CRLF range content", () => {
    const line = 'const emoji = "😀";';
    const source = `${line}\r\nconst next = 1;\r\n`;
    const parsed = parseLspDocumentSymbols(
      [
        documentSymbol("emoji", 14, range(0, 0, 1, 0), {
          selectionRange: range(0, 6, 0, 11),
        }),
      ],
      {
        source,
        targetUri: TARGET_URI,
        maxSymbols: 80,
      },
    );

    expect(parsed.symbols[0]).toEqual(
      expect.objectContaining({
        selectionRangeSha256: sha256("emoji"),
        rangeSha256: sha256(`${line}\r\n`),
      }),
    );
  });

  it.each([
    {
      label: "unknown fields",
      response: [
        {
          ...documentSymbol("value", 14, range(0, 0, 0, 5)),
          data: {},
        },
      ],
      error: "hierarchical symbol is malformed",
    },
    {
      label: "selection ranges outside declarations",
      response: [
        documentSymbol("value", 14, range(0, 0, 0, 5), {
          selectionRange: range(0, 0, 0, 6),
        }),
      ],
      error: "ranges are malformed",
    },
    {
      label: "children outside parents",
      response: [
        documentSymbol("parent", 5, range(0, 0, 0, 5), {
          children: [documentSymbol("child", 6, range(0, 5, 0, 6))],
        }),
      ],
      error: "escapes its parent range",
    },
    {
      label: "unsupported kinds",
      response: [documentSymbol("value", 27, range(0, 0, 0, 5))],
      error: "kind is malformed",
    },
    {
      label: "unsupported tags",
      response: [
        {
          ...documentSymbol("value", 14, range(0, 0, 0, 5)),
          tags: [2],
        },
      ],
      error: "tags are malformed",
    },
    {
      label: "control characters",
      response: [documentSymbol("val\u0000ue", 14, range(0, 0, 0, 5))],
      error: "name is malformed",
    },
  ])("rejects malformed $label", ({ response, error }) => {
    expect(() =>
      parseLspDocumentSymbols(response, {
        source: "value",
        targetUri: TARGET_URI,
        maxSymbols: 80,
      }),
    ).toThrow(error);
  });

  it("rejects flat symbols that target another document", () => {
    expect(() =>
      parseLspDocumentSymbols(
        [
          {
            name: "value",
            kind: 14,
            location: {
              uri: pathToFileURL("/workspace/other.ts").href,
              range: range(0, 0, 0, 5),
            },
          },
        ],
        {
          source: "value",
          targetUri: TARGET_URI,
          maxSymbols: 80,
        },
      ),
    ).toThrow("targets another file");
  });

  it("enforces protocol node and nesting limits", () => {
    const tooMany = Array.from(
      { length: MAX_LSP_SYMBOL_RESPONSE_NODES + 1 },
      (_, index) => ({
        name: `value${index}`,
        kind: 14,
        location: { uri: TARGET_URI, range: range(0, 0, 0, 5) },
      }),
    );
    expect(() =>
      parseLspDocumentSymbols(tooMany, {
        source: "value",
        targetUri: TARGET_URI,
        maxSymbols: 80,
      }),
    ).toThrow("exceeds 1024 nodes");

    let nested = documentSymbol("leaf", 14, range(0, 0, 0, 5));
    for (let depth = 0; depth <= MAX_LSP_SYMBOL_DEPTH; depth += 1) {
      nested = documentSymbol(`parent${depth}`, 5, range(0, 0, 0, 5), {
        children: [nested],
      });
    }
    expect(() =>
      parseLspDocumentSymbols([nested], {
        source: "value",
        targetUri: TARGET_URI,
        maxSymbols: 80,
      }),
    ).toThrow("exceeds depth 32");
  });

  it("validates maxSymbols before parsing protocol content", () => {
    expect(() =>
      parseLspDocumentSymbols([], {
        source: "",
        targetUri: TARGET_URI,
        maxSymbols: 0,
      }),
    ).toThrow("positive integer");
    expect(() =>
      parseLspDocumentSymbols([], {
        source: "",
        targetUri: TARGET_URI,
        maxSymbols: 257,
      }),
    ).toThrow("cannot exceed 256");
  });
});

function documentSymbol(
  name: string,
  kind: number,
  symbolRange: ReturnType<typeof range>,
  options: {
    selectionRange?: ReturnType<typeof range>;
    detail?: string;
    children?: unknown[];
  } = {},
): Record<string, unknown> {
  return {
    name,
    ...(options.detail ? { detail: options.detail } : {}),
    kind,
    range: symbolRange,
    selectionRange: options.selectionRange ?? symbolRange,
    ...(options.children ? { children: options.children } : {}),
  };
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

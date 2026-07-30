import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertLspSymbolsToolOutputBytes,
  createLspSymbolsTool,
  lspSymbolsToolCallArgumentsLedgerProjection,
  lspSymbolsToolOutputLedgerProjection,
  MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES,
} from "../src/index.js";
import { createLspRenameWorkspace, range } from "./lsp-rename-test-fixture.js";
import { controlledLspSymbolsSandbox } from "./lsp-symbols-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP symbols Agent tool boundary", () => {
  it("returns live semantic names and exact ranges without changing source", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const lines = [
      "export class PrivateFormatter {",
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
      "}",
      "",
    ];
    const source = lines.join("\n");
    await writeFile(path.join(root, "private-formatter.ts"), source);
    const controlled = controlledLspSymbolsSandbox({
      symbols: () => [
        {
          name: "PrivateFormatter",
          detail: "PRIVATE_DETAIL",
          kind: 5,
          range: range(0, 0, 4, 1),
          selectionRange: range(0, 13, 0, 29),
          children: [
            {
              name: "format",
              kind: 6,
              range: range(1, 2, 3, 3),
              selectionRange: range(1, 2, 1, 8),
            },
          ],
        },
      ],
    });
    const tool = createLspSymbolsTool({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    });

    const result = await tool.execute("symbols-1", {
      path: "private-formatter.ts",
      maxSymbols: 12,
    });
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(output).toContain('SYMBOL 1 class "PrivateFormatter"');
    expect(output).toContain('Detail: "PRIVATE_DETAIL"');
    expect(output).toContain('SYMBOL 2 method "format"');
    expect(output).toContain('Container: "PrivateFormatter"');
    expect(output).toContain("Range: 2:3-4:4");
    expect(output).toContain("Ranges are 1-based UTF-16 positions");
    expect(output).toContain("No file changed.");
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        responseShape: "hierarchical",
        symbolCount: 2,
        omittedSymbolCount: 0,
        complete: true,
      }),
    );
    expect(JSON.stringify(result.details)).not.toContain("PrivateFormatter");
    expect(JSON.stringify(result.details)).not.toContain("PRIVATE_DETAIL");
    expect(
      await readFile(path.join(root, "private-formatter.ts"), "utf8"),
    ).toBe(source);
  });

  it("fails closed when a formatted result exceeds the output budget", () => {
    expect(() =>
      assertLspSymbolsToolOutputBytes(
        "x".repeat(MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES + 1),
      ),
    ).toThrow(
      `LSP symbols tool output exceeds ${MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES}`,
    );
    expect(() =>
      assertLspSymbolsToolOutputBytes(
        "x".repeat(MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES),
      ),
    ).not.toThrow();
  });

  it("keeps escape-amplified semantic output within the byte budget", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = "\\".repeat(240);
    await writeFile(path.join(root, "escaped.ts"), source);
    const controlled = controlledLspSymbolsSandbox({
      symbols: () =>
        Array.from({ length: 100 }, (_, index) => ({
          name: `symbol${index}${"\\".repeat(180)}`,
          detail: "\\".repeat(300),
          kind: 14,
          range: range(0, 0, 0, source.length),
          selectionRange: range(0, 0, 0, source.length),
        })),
    });
    const tool = createLspSymbolsTool({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    });

    const result = await tool.execute("symbols-escaped", {
      path: "escaped.ts",
      maxSymbols: 256,
    });
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(
      MAX_LSP_SYMBOL_TOOL_OUTPUT_BYTES,
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        truncated: true,
        complete: false,
        omittedSymbolCount: expect.any(Number),
      }),
    );
    expect(result.details.omittedSymbolCount).toBeGreaterThan(0);
  });

  it("projects paths, live names, signatures, and output as hashes only", () => {
    const target = "src/private-symbols.ts";
    const args = {
      path: target,
      maxSymbols: 17,
      timeoutMs: 2_000,
    };
    const call = lspSymbolsToolCallArgumentsLedgerProjection(args);
    const output = lspSymbolsToolOutputLedgerProjection(
      "PRIVATE_SYMBOL_OUTPUT",
      {
        details: { resultSha256: "a".repeat(64) },
      },
    );
    const durable = JSON.stringify({ call, output });

    expect(call).toEqual(
      expect.objectContaining({
        kind: "napier.redacted-tool-arguments",
        redacted: true,
        pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        maxSymbols: 17,
        timeoutMs: 2_000,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputBytes: 21,
        resultSha256: "a".repeat(64),
      }),
    );
    expect(durable).not.toContain(target);
    expect(durable).not.toContain("PRIVATE_SYMBOL_OUTPUT");
  });
});

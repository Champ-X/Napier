import { realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LSP_SYMBOLS,
  LspSymbolsRunner,
  sha256,
  type OsSandboxAdapter,
} from "../src/index.js";
import {
  createFakeLspAssets,
  createLspRenameWorkspace,
  directLspSandbox,
  range,
} from "./lsp-rename-test-fixture.js";
import { controlledLspSymbolsSandbox } from "./lsp-symbols-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP symbols runner", () => {
  it("returns real hierarchical TypeScript document symbols and exact ranges", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = [
      "export interface Formatter {",
      "  format(value: string): string;",
      "}",
      "",
      "export class TitleFormatter implements Formatter {",
      '  constructor(private readonly prefix = "") {}',
      "",
      "  format(value: string): string {",
      "    const normalize = (input: string) => input.trim();",
      "    return `${this.prefix}${normalize(value)}`;",
      "  }",
      "}",
      "",
    ].join("\n");
    await writeFile(path.join(root, "formatter.ts"), source);

    const result = await new LspSymbolsRunner({
      workspaceRoot: root,
      sandbox: directLspSandbox(),
    }).run({ path: "formatter.ts" });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        complete: true,
        truncated: false,
        responseShape: "hierarchical",
        language: "typescript",
        responseSymbolCount: expect.any(Number),
        symbolCount: expect.any(Number),
        omittedSymbolCount: 0,
        maxDepth: 2,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    expect(result.details.responseSymbolCount).toBeGreaterThanOrEqual(6);
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining([
        "Formatter",
        "format",
        "TitleFormatter",
        "constructor",
        "normalize",
        "prefix",
      ]),
    );
    const normalize = result.symbols.find(
      (symbol) => symbol.name === "normalize",
    );
    expect(normalize).toEqual(
      expect.objectContaining({
        kindLabel: "constant",
        depth: 2,
        containerName: "format",
        range: range(8, 10, 8, 53),
        rangeSha256: sha256(
          "normalize = (input: string) => input.trim()",
        ),
        selectionRangeSha256: sha256("normalize"),
      }),
    );
  }, 20_000);

  it("advertises hierarchical support and normalizes a flat fallback", async () => {
    const root = await createWorkspace();
    const target = await realpath(path.join(root, "source.ts"));
    let hierarchicalCapability = false;
    const controlled = controlledLspSymbolsSandbox({
      initialize: (params) => {
        const textDocument =
          record(params) &&
          record(params["capabilities"]) &&
          record(params["capabilities"]["textDocument"])
            ? params["capabilities"]["textDocument"]
            : {};
        const documentSymbol = record(textDocument["documentSymbol"])
          ? textDocument["documentSymbol"]
          : {};
        hierarchicalCapability =
          documentSymbol["hierarchicalDocumentSymbolSupport"] === true;
      },
      symbols: (params) => {
        expect(params).toEqual({
          textDocument: { uri: pathToFileURL(target).href },
        });
        return [
          {
            name: "value",
            kind: 14,
            location: {
              uri: pathToFileURL(target).href,
              range: range(0, 13, 0, 18),
            },
            containerName: "module",
          },
        ];
      },
    });

    const result = await runner(root, controlled.sandbox).run({
      path: "source.ts",
    });

    expect(hierarchicalCapability).toBe(true);
    expect(controlled.requestCount()).toBe(1);
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        responseShape: "flat",
        symbolCount: 1,
        maxDepth: 0,
      }),
    );
    expect(result.symbols[0]).toEqual(
      expect.objectContaining({
        name: "value",
        containerName: "module",
        depth: 0,
        rangeSha256: sha256("value"),
      }),
    );
  });

  it("returns an explicit not-found receipt and validates limits before launch", async () => {
    const root = await createWorkspace();
    const controlled = controlledLspSymbolsSandbox({
      symbols: () => null,
    });
    const result = await runner(root, controlled.sandbox).run({
      path: "source.ts",
      maxSymbols: 7,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        complete: true,
        truncated: false,
        responseShape: "empty",
        responseSymbolCount: 0,
        symbolCount: 0,
        omittedSymbolCount: 0,
      }),
    );

    let launches = 0;
    const noLaunch: OsSandboxAdapter = {
      id: "lsp-symbols-no-launch",
      async launch() {
        launches += 1;
        throw new Error("launch must not be reached");
      },
    };
    await expect(
      runner(root, noLaunch).run({ path: "source.ts", maxSymbols: 0 }),
    ).rejects.toThrow("positive integer");
    await expect(
      runner(root, noLaunch).run({ path: "source.ts", maxSymbols: 257 }),
    ).rejects.toThrow("cannot exceed 256");
    expect(launches).toBe(0);
  });

  it("fails closed on source and runtime drift", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const sourceDrift = controlledLspSymbolsSandbox({
      symbols: async () => {
        await writeFile(source, "export const value = 2;\n");
        return null;
      },
    });
    await expect(
      runner(root, sourceDrift.sandbox).run({ path: "source.ts" }),
    ).rejects.toThrow("LSP symbols target changed during execution");

    await writeFile(source, "export const value = 1;\n");
    const assets = await createFakeLspAssets(root);
    const runtimeDrift = controlledLspSymbolsSandbox({
      symbols: async () => {
        await writeFile(assets.languageServerPath, "drifted");
        return null;
      },
    });
    await expect(
      new LspSymbolsRunner({
        workspaceRoot: root,
        sandbox: runtimeDrift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({ path: "source.ts" }),
    ).rejects.toThrow("LSP symbols runtime assets changed during execution");
  });

  it("isolates concurrent sessions and terminates timeout and cancellation", async () => {
    const root = await createWorkspace();
    const response = [
      {
        name: "value",
        kind: 14,
        range: range(0, 0, 0, 23),
        selectionRange: range(0, 13, 0, 18),
      },
    ];
    const concurrent = controlledLspSymbolsSandbox({
      symbols: () => response,
    });
    const symbolRunner = runner(root, concurrent.sandbox);
    const results = await Promise.all([
      symbolRunner.run({ path: "source.ts" }),
      symbolRunner.run({ path: "source.ts" }),
    ]);
    expect(concurrent.requestCount()).toBe(2);
    expect(results[0]?.symbols).toEqual(results[1]?.symbols);
    expect(results[0]?.details.symbolSetSha256).toBe(
      results[1]?.details.symbolSetSha256,
    );

    const hanging = controlledLspSymbolsSandbox({
      symbols: () => new Promise(() => undefined),
    });
    await expect(
      runner(root, hanging.sandbox).run({
        path: "source.ts",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("LSP symbols timed out");
    expect(hanging.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledLspSymbolsSandbox({
      symbols: () => new Promise(() => undefined),
    });
    const controller = new AbortController();
    const pending = runner(root, cancelled.sandbox).run({
      path: "source.ts",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("LSP symbols were aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);
  }, 10_000);
});

async function createWorkspace(): Promise<string> {
  const root = await createLspRenameWorkspace(temporaryRoots);
  await writeFile(path.join(root, "source.ts"), "export const value = 1;\n");
  return root;
}

function runner(
  workspaceRoot: string,
  sandbox: OsSandboxAdapter,
): LspSymbolsRunner {
  return new LspSymbolsRunner({ workspaceRoot, sandbox });
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

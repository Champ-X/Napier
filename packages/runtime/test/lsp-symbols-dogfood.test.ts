import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  lspRangeText,
  LspSymbolsRunner,
  sha256,
} from "../src/index.js";
import { directLspSandbox } from "./lsp-rename-test-fixture.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP symbols dogfood", () => {
  it("patches a real semantic method range through CAS and passes TypeScript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-symbol-dogfood-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    const targetPath = "formatter.ts";
    const target = path.join(workspaceRoot, targetPath);
    const source = [
      "export class Formatter {",
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
      "}",
      "",
      'export const formatted = new Formatter().format(" value ");',
      "",
    ].join("\n");
    await mkdir(workspaceRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["*.ts"],
        }),
      ),
      writeFile(target, source),
    ]);
    const outline = await new LspSymbolsRunner({
      workspaceRoot,
      sandbox: directLspSandbox(),
    }).run({ path: targetPath });
    const method = outline.symbols.find(
      (symbol) => symbol.name === "format" && symbol.kindLabel === "method",
    );
    if (!method) {
      throw new Error("Real TypeScript did not return the format method");
    }
    const oldText = lspRangeText(source, method.range);
    if (!oldText) {
      throw new Error("Real TypeScript returned an empty method range");
    }
    const newText = oldText.replace(
      "return value.trim();",
      "return value.trim().toUpperCase();",
    );
    if (newText === oldText) {
      throw new Error("Semantic method range did not contain the target body");
    }
    const updated = source.replace(oldText, newText);

    const patch = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "replace",
      path: targetPath,
      expectedSha256: sha256(source),
      edits: [{ oldText, newText }],
    });
    const typecheck = await execFileAsync(
      process.execPath,
      [
        require.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--project",
        path.join(workspaceRoot, "tsconfig.json"),
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
      },
    );

    expect(method).toEqual(
      expect.objectContaining({
        depth: 1,
        containerName: "Formatter",
        rangeSha256: sha256(oldText),
        selectionRangeSha256: sha256("format"),
      }),
    );
    expect(patch).toEqual(
      expect.objectContaining({
        beforeSha256: sha256(source),
        afterSha256: sha256(updated),
      }),
    );
    expect(typecheck.stderr).toBe("");
    expect(await readFile(target, "utf8")).toBe(updated);
    expect(updated).toContain("value.trim().toUpperCase()");
  }, 20_000);
});

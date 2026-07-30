import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  LspCodeActionsRunner,
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

describe("LSP Code Actions dogfood", () => {
  it("applies the real preferred import through CAS and passes TypeScript", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-code-action-dogfood-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    const targetPath = "usage.ts";
    const target = path.join(workspaceRoot, targetPath);
    const source = 'export const title = formatTitle(" value ");\n';
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
      writeFile(
        path.join(workspaceRoot, "definition.ts"),
        [
          "export function formatTitle(value: string): string {",
          "  return value.trim();",
          "}",
          "",
        ].join("\n"),
      ),
      writeFile(target, source),
    ]);
    const preview = await new LspCodeActionsRunner({
      workspaceRoot,
      sandbox: directLspSandbox(),
    }).run({
      path: targetPath,
      line: 1,
      character: 22,
    });
    const preferred = preview.actions.find((action) => action.isPreferred);
    const edit = preferred?.files[0]?.edits[0];
    if (!preferred || !edit) {
      throw new Error("Real TypeScript did not return a preferred import edit");
    }
    expect(preferred.title).toContain("Add import");
    expect(edit).toEqual(
      expect.objectContaining({
        path: targetPath,
        fileSha256: sha256(source),
        startLine: 1,
        startCharacter: 1,
        endLine: 1,
        endCharacter: 1,
        oldText: "",
        newText: expect.stringContaining("formatTitle"),
      }),
    );
    const updated = `${edit.newText}${source}`;

    const patch = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "replace",
      path: targetPath,
      expectedSha256: edit.fileSha256,
      edits: [{ oldText: source, newText: updated }],
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

    expect(patch).toEqual(
      expect.objectContaining({
        beforeSha256: sha256(source),
        afterSha256: sha256(updated),
      }),
    );
    expect(typecheck.stderr).toBe("");
    expect(await readFile(target, "utf8")).toBe(updated);
    expect(updated).not.toContain("PRIVATE");
  }, 20_000);
});

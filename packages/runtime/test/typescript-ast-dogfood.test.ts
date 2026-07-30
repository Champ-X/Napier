import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  sha256,
  TypescriptAstRunner,
} from "../src/index.js";

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

describe("TypeScript AST dogfood", () => {
  it("applies a real AST-bound method edit through CAS and passes TypeScript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-ast-dogfood-"));
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
    const replacement = [
      "format(value: string): string {",
      "    return value.trim().toUpperCase();",
      "  }",
    ].join("\n");
    const updated = source.replace(
      [
        "format(value: string): string {",
        "    return value.trim();",
        "  }",
      ].join("\n"),
      replacement,
    );
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
    const runner = new TypescriptAstRunner(workspaceRoot);
    const selector = {
      kind: "method" as const,
      name: "format",
      ancestorKind: "class" as const,
      ancestorName: "Formatter",
    };
    const query = await runner.query({ path: targetPath, selector });
    const node = query.nodes[0];
    if (!node) throw new Error("Real TypeScript did not return the method");
    const preview = await runner.previewEdit({
      path: targetPath,
      expectedSha256: query.details.fileSha256,
      selector,
      nodeSha256: node.nodeSha256,
      operation: "replace",
      replacement,
    });

    const patch = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "replace",
      path: targetPath,
      expectedSha256: preview.details.fileSha256,
      edits: [
        {
          oldText: preview.applicationOldText,
          newText: preview.applicationNewText,
        },
      ],
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
    const afterQuery = await runner.query({ path: targetPath, selector });

    expect(query.details).toEqual(
      expect.objectContaining({
        status: "found",
        matchedNodeCount: 1,
        typescriptVersion: "5.9.3",
      }),
    );
    expect(preview.details).toEqual(
      expect.objectContaining({
        targetNodeSha256: node.nodeSha256,
        afterFileSha256: sha256(updated),
      }),
    );
    expect(patch).toEqual(
      expect.objectContaining({
        beforeSha256: sha256(source),
        afterSha256: sha256(updated),
      }),
    );
    expect(typecheck.stdout).toBe("");
    expect(typecheck.stderr).toBe("");
    expect(afterQuery.details.fileSha256).toBe(patch.afterSha256);
    expect(afterQuery.nodes[0]?.nodeSha256).not.toBe(node.nodeSha256);
    expect(await readFile(target, "utf8")).toBe(updated);
  }, 20_000);
});

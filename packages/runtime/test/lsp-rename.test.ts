import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { LspRenameRunner } from "../src/lsp-rename.js";
import {
  controlledLspRenameSandbox,
  createFakeLspAssets,
  createLspRenameWorkspace,
  directLspSandbox,
  range,
  textEdit,
} from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP rename runner", () => {
  it("previews a real multi-file TypeScript rename without writing", async () => {
    const root = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const paths = ["definition.ts", "first.ts", "second.ts"];
    const before = await Promise.all(
      paths.map((file) => readFile(path.join(root, file), "utf8")),
    );

    const result = await new LspRenameRunner({
      workspaceRoot: root,
      sandbox: directLspSandbox(),
    }).run({
      path: "definition.ts",
      line: 1,
      character: 17,
      newName: "canonicalizeTitle",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        complete: true,
        language: "typescript",
        fileCount: 3,
        editCount: 6,
        previewBytes: 186,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    expect(result.files.map((file) => file.path)).toEqual(paths);
    expect(result.files.flatMap((file) => file.edits)).toHaveLength(6);
    expect(
      new Set(
        result.files
          .flatMap((file) => file.edits)
          .map((edit) => `${edit.oldText}:${edit.newText}`),
      ),
    ).toEqual(new Set(["normalizeTitle:canonicalizeTitle"]));
    expect(
      await Promise.all(
        paths.map((file) => readFile(path.join(root, file), "utf8")),
      ),
    ).toEqual(before);
  }, 20_000);

  it("fails closed for external, protected, symlinked, or invalid ranges", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = path.join(root, "source.ts");
    const protectedTarget = path.join(root, "node_modules", "private.ts");
    const realTarget = path.join(root, "real-target.ts");
    const symlinkTarget = path.join(root, "alias-target.ts");
    const outsideRoot = await createLspRenameWorkspace(temporaryRoots);
    const outside = path.join(outsideRoot, "outside.ts");
    await mkdir(path.dirname(protectedTarget), { recursive: true });
    await writeFile(source, "export const currentName = 1;\n");
    await writeFile(realTarget, "export const currentName = 2;\n");
    await writeFile(outside, "export const currentName = 3;\n");
    await writeFile(protectedTarget, "export const currentName = 4;\n");
    await symlink("real-target.ts", symlinkTarget);

    for (const target of [
      await realpath(outside),
      await realpath(protectedTarget),
      symlinkTarget,
    ]) {
      await expect(
        renameWithResponse(root, {
          changes: {
            [pathToFileURL(target).href]: [textEdit("nextName", 0, 13, 0, 24)],
          },
        }),
      ).rejects.toThrow("unsupported or out-of-workspace");
    }
    await expect(
      renameWithResponse(root, {
        changes: {
          [pathToFileURL(await realpath(source)).href]: [
            textEdit("nextName", 0, 50, 0, 60),
          ],
        },
      }),
    ).rejects.toThrow("out-of-range workspace target");
  });

  it("returns not-found without issuing rename and detects source drift", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = path.join(root, "source.ts");
    await writeFile(source, "export const currentName = 1;\n");
    const empty = controlledLspRenameSandbox({
      prepare: () => null,
      rename: () => {
        throw new Error("rename must not be called");
      },
    });
    const result = await new LspRenameRunner({
      workspaceRoot: root,
      sandbox: empty.sandbox,
    }).run({
      path: "source.ts",
      line: 1,
      character: 14,
      newName: "nextName",
    });
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        complete: true,
        fileCount: 0,
        editCount: 0,
      }),
    );
    expect(empty.renameCount()).toBe(0);

    const drift = controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: async () => {
        await writeFile(source, "export const changedName = 1;\n");
        return null;
      },
    });
    await expect(
      new LspRenameRunner({
        workspaceRoot: root,
        sandbox: drift.sandbox,
      }).run({
        path: "source.ts",
        line: 1,
        character: 14,
        newName: "nextName",
      }),
    ).rejects.toThrow("LSP rename target changed during execution");
  });

  it("detects runtime drift before returning a preview", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = path.join(root, "source.ts");
    await writeFile(source, "export const currentName = 1;\n");
    const assets = await createFakeLspAssets(root);
    const drift = controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: async () => {
        await writeFile(assets.languageServerPath, "drifted");
        return null;
      },
    });

    await expect(
      new LspRenameRunner({
        workspaceRoot: root,
        sandbox: drift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({
        path: "source.ts",
        line: 1,
        character: 14,
        newName: "nextName",
      }),
    ).rejects.toThrow("LSP rename runtime assets changed during execution");
  });

  it("terminates timeout and cancellation while isolating concurrent sessions", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const source = path.join(root, "source.ts");
    await writeFile(source, "export const currentName = 1;\n");
    const hanging = controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: () => new Promise(() => undefined),
    });
    await expect(
      new LspRenameRunner({
        workspaceRoot: root,
        sandbox: hanging.sandbox,
      }).run({
        path: "source.ts",
        line: 1,
        character: 14,
        newName: "nextName",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("LSP rename timed out");
    expect(hanging.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: () => new Promise(() => undefined),
    });
    const controller = new AbortController();
    const pending = new LspRenameRunner({
      workspaceRoot: root,
      sandbox: cancelled.sandbox,
    }).run({
      path: "source.ts",
      line: 1,
      character: 14,
      newName: "nextName",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("LSP rename was aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);

    const response = {
      changes: {
        [pathToFileURL(await realpath(source)).href]: [
          textEdit("nextName", 0, 13, 0, 24),
        ],
      },
    };
    const concurrent = controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: () => response,
    });
    const runner = new LspRenameRunner({
      workspaceRoot: root,
      sandbox: concurrent.sandbox,
    });
    const results = await Promise.all([
      runner.run({
        path: "source.ts",
        line: 1,
        character: 14,
        newName: "nextName",
      }),
      runner.run({
        path: "source.ts",
        line: 1,
        character: 14,
        newName: "nextName",
      }),
    ]);
    expect(results.map((item) => item.details.status)).toEqual([
      "found",
      "found",
    ]);
    expect(results[0]?.details.editSetSha256).toBe(
      results[1]?.details.editSetSha256,
    );
  }, 10_000);
});

async function renameWithResponse(
  workspaceRoot: string,
  workspaceEdit: unknown,
) {
  return new LspRenameRunner({
    workspaceRoot,
    sandbox: controlledLspRenameSandbox({
      prepare: () => range(0, 13, 0, 24),
      rename: () => workspaceEdit,
    }).sandbox,
  }).run({
    path: "source.ts",
    line: 1,
    character: 14,
    newName: "nextName",
  });
}

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  LspRenameApplyDiagnostics,
  MAX_LSP_RENAME_DIAGNOSTIC_FILES,
} from "../src/lsp-rename-apply-diagnostics.js";
import type {
  LspProtocolExecutor,
  LspProtocolSessionResult,
} from "../src/lsp-protocol-session.js";
import type { LspRenameFile } from "../src/lsp-rename-workspace-edit.js";
import { controlledLspRenameSandbox } from "./lsp-rename-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP rename apply diagnostics", () => {
  it("marks an otherwise clean observation truncated when files are omitted", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-rename-diagnostics-"),
    );
    roots.push(workspaceRoot);
    const files: LspRenameFile[] = [];
    for (
      let index = 0;
      index < MAX_LSP_RENAME_DIAGNOSTIC_FILES + 1;
      index += 1
    ) {
      const relativePath = `file-${String(index).padStart(2, "0")}.ts`;
      const source = `export const value${String(index)} = ${String(index)};\n`;
      await writeFile(path.join(workspaceRoot, relativePath), source);
      files.push({
        path: relativePath,
        pathSha256: sha256(relativePath),
        fileSha256: sha256(source),
        edits: [],
      });
    }
    let persistentCalls = 0;
    const session: LspProtocolExecutor = {
      async execute<T>(): Promise<LspProtocolSessionResult<T>> {
        persistentCalls += 1;
        throw new Error(
          "persistent Session must not observe coordinated writes",
        );
      },
    };
    const diagnostics = new LspRenameApplyDiagnostics({
      workspaceRoot,
      sandbox: controlledLspRenameSandbox({}).sandbox,
      session,
    });

    const before = await diagnostics.observeBefore(files);
    const after = await diagnostics.observeAfter(
      before,
      files.map((file) => ({
        path: file.path,
        pathSha256: file.pathSha256,
        beforeSha256: file.fileSha256,
        expectedSha256: file.fileSha256,
      })),
    );

    expect(before.entries).toHaveLength(MAX_LSP_RENAME_DIAGNOSTIC_FILES);
    expect(persistentCalls).toBe(0);
    expect(before.omittedFileCount).toBe(1);
    expect(after.details).toEqual(
      expect.objectContaining({
        status: "truncated",
        truncated: true,
        fileCount: MAX_LSP_RENAME_DIAGNOSTIC_FILES,
        omittedFileCount: 1,
        beforeDiagnosticCount: 0,
        afterDiagnosticCount: 0,
      }),
    );
  }, 20_000);
});

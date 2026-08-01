import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  MAX_SUBAGENT_LIFECYCLE_DIAGNOSTIC_FILES,
  SubagentWorktreeLifecycleDiagnostics,
} from "../src/subagent-worktree-lifecycle-diagnostics.js";
import type { SubagentWorktreeChange } from "../src/subagent-worktree-diff.js";
import { controlledLspRenameSandbox } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree lifecycle diagnostics", () => {
  it("observes before-present and after-present lifecycle paths", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-lifecycle-diagnostics-"),
    );
    temporaryRoots.push(workspaceRoot);
    const deleted = "export const deleted = true;\n";
    const modifiedBefore = "export const modified = 1;\n";
    const modifiedAfter = "export const modified = 2;\n";
    const added = "export const added = true;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, "delete.ts"), deleted),
      writeFile(path.join(workspaceRoot, "modify.ts"), modifiedBefore),
    ]);
    const changes: SubagentWorktreeChange[] = [
      change("add", "add.ts", null, added),
      change("delete", "delete.ts", deleted, null),
      change("modify", "modify.ts", modifiedBefore, modifiedAfter),
    ];
    const diagnostics = new SubagentWorktreeLifecycleDiagnostics({
      workspaceRoot,
      sandbox: controlledLspRenameSandbox({}).sandbox,
    });

    const before = await diagnostics.observeBefore(changes);
    expect(before.entries).toHaveLength(3);
    expect(before.entries.filter((entry) => entry.before)).toHaveLength(2);

    await Promise.all([
      writeFile(path.join(workspaceRoot, "add.ts"), added),
      writeFile(path.join(workspaceRoot, "modify.ts"), modifiedAfter),
      unlink(path.join(workspaceRoot, "delete.ts")),
    ]);
    const after = await diagnostics.observeAfter(before);

    expect(after.details).toEqual(
      expect.objectContaining({
        status: "clean",
        fileCount: 3,
        omittedFileCount: 0,
        beforeDiagnosticCount: 0,
        afterDiagnosticCount: 0,
        introducedCount: 0,
        resolvedCount: 0,
        truncated: false,
        beforeResultSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        afterResultSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        deltaSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(after.summary).toContain("add.ts (add): clean");
    expect(after.summary).toContain("delete.ts (delete): clean");
    await expect(
      readFile(path.join(workspaceRoot, "delete.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds supported lifecycle files without claiming completeness", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-lifecycle-diagnostics-"),
    );
    temporaryRoots.push(workspaceRoot);
    const changes: SubagentWorktreeChange[] = [];
    for (
      let index = 0;
      index < MAX_SUBAGENT_LIFECYCLE_DIAGNOSTIC_FILES + 1;
      index += 1
    ) {
      const relativePath = `file-${String(index).padStart(2, "0")}.ts`;
      const source = `export const value${String(index)} = ${String(index)};\n`;
      await writeFile(path.join(workspaceRoot, relativePath), source);
      changes.push(change("delete", relativePath, source, null));
    }
    const diagnostics = new SubagentWorktreeLifecycleDiagnostics({
      workspaceRoot,
      sandbox: controlledLspRenameSandbox({}).sandbox,
    });

    const before = await diagnostics.observeBefore(changes);
    for (const entry of before.entries) {
      await unlink(path.join(workspaceRoot, entry.change.path));
    }
    const after = await diagnostics.observeAfter(before);

    expect(after.details).toEqual(
      expect.objectContaining({
        status: "truncated",
        fileCount: MAX_SUBAGENT_LIFECYCLE_DIAGNOSTIC_FILES,
        omittedFileCount: 1,
        truncated: true,
      }),
    );
  });
});

function change(
  operation: SubagentWorktreeChange["operation"],
  relativePath: string,
  beforeText: string | null,
  afterText: string | null,
): SubagentWorktreeChange {
  return {
    operation,
    path: relativePath,
    pathSha256: sha256(relativePath),
    beforeSha256: beforeText === null ? null : sha256(beforeText),
    afterSha256: afterText === null ? null : sha256(afterText),
    ...(beforeText === null ? {} : { beforeText }),
    ...(afterText === null ? {} : { afterText }),
  };
}

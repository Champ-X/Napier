import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LspRenameApplyDiagnosticsDetails } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type {
  LspRenameDiagnosticsObservation,
  LspRenameDiagnosticsState,
} from "../src/lsp-rename-apply-diagnostics.js";
import type { LspWorkspaceEditDiagnosticsAdapter } from "../src/lsp-workspace-edit-mutation.js";
import { SubagentWorktreeMutationManager } from "../src/subagent-worktree-mutation.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree mutation manager", () => {
  it("keeps candidate writes isolated until one-use coordinated apply", async () => {
    const harness = await createHarness();
    const manager = createManager(harness);
    const first = "export const first = 1;\n";
    const second = "export const second = 2;\n";
    await Promise.all([
      writeFile(path.join(harness.workspaceRoot, "src/first.ts"), first),
      writeFile(path.join(harness.workspaceRoot, "src/second.ts"), second),
    ]);
    const worktree = await manager.createWorktree("task_manager12", [
      "src/first.ts",
      "src/second.ts",
    ]);
    const tools = manager.createCoderTools(worktree);
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "search_files",
      "list_symbols",
      "inspect_data",
      "inspect_code",
      "read_symbol",
      "ast_query",
      "ast_edit_preview",
      "apply_patch",
      "candidate_file",
    ]);
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    await Promise.all([
      patch.execute("patch-first", {
        operation: "replace",
        path: "src/first.ts",
        expectedSha256: sha256(first),
        edits: [{ oldText: "first = 1", newText: "first = 10" }],
      }),
      patch.execute("patch-second", {
        operation: "replace",
        path: "src/second.ts",
        expectedSha256: sha256(second),
        edits: [{ oldText: "second = 2", newText: "second = 20" }],
      }),
    ]);
    await expect(
      patch.execute("patch-undeclared", {
        operation: "replace",
        path: "README.md",
        expectedSha256: "a".repeat(64),
        edits: [{ oldText: "a", newText: "b" }],
      }),
    ).rejects.toThrow("declared file paths");

    const preview = await manager.storePreview(worktree, "b".repeat(64));
    expect(preview).toEqual(
      expect.objectContaining({
        taskId: "task_manager12",
        changedFileCount: 2,
        changedPaths: ["src/first.ts", "src/second.ts"],
        changedFileSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        review: expect.stringContaining("- export const first = 1;"),
        reviewTruncated: false,
        candidateVerification: expect.objectContaining({
          attemptCount: 0,
          freshCount: 0,
          passedCount: 0,
          failedCount: 0,
          staleCount: 0,
        }),
      }),
    );
    expect(preview.review).toContain("+ export const first = 10;");
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/first.ts"), "utf8"),
    ).toBe(first);

    const applied = await manager.apply(preview.id);
    expect(applied.details).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-worktree-apply",
        schemaVersion: 1,
        status: "applied",
        postcondition: "verified",
        taskId: "task_manager12",
        fileCount: 2,
        candidateVerificationAttemptCount: 0,
        candidateVerificationFreshCount: 0,
        candidateVerificationPassedCount: 0,
        candidateVerificationFailedCount: 0,
        candidateVerificationStaleCount: 0,
        changedFileSetSha256: preview.changedFileSetSha256,
        diagnostics: expect.objectContaining({ status: "clean" }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/first.ts"), "utf8"),
    ).toContain("first = 10");
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "preview not found",
    );
  });

  it("consumes a stale preview without changing any candidate file", async () => {
    const harness = await createHarness();
    const manager = createManager(harness);
    const source = "export const value = 1;\n";
    await writeFile(path.join(harness.workspaceRoot, "src/value.ts"), source);
    const worktree = await manager.createWorktree("task_stale123", [
      "src/value.ts",
    ]);
    const patch = manager
      .createCoderTools(worktree)
      .find((tool) => tool.name === "apply_patch")!;
    await patch.execute("patch-value", {
      operation: "replace",
      path: "src/value.ts",
      expectedSha256: sha256(source),
      edits: [{ oldText: "value = 1", newText: "value = 2" }],
    });
    const preview = await manager.storePreview(worktree, "c".repeat(64));
    await writeFile(
      path.join(harness.workspaceRoot, "unrelated.txt"),
      "external drift\n",
    );

    await expect(manager.apply(preview.id)).rejects.toThrow(
      "conflicts with workspace drift",
    );
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/value.ts"), "utf8"),
    ).toBe(source);
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "preview not found",
    );
  });

  it("merges authorized add, delete, and rename lifecycle changes once", async () => {
    const harness = await createHarness();
    const manager = createManager(harness);
    const deleted = "export const deleted = true;\n";
    const moved = "export const moved = true;\n";
    const added = "export const added = true;\n";
    await Promise.all([
      writeFile(path.join(harness.workspaceRoot, "src/delete.ts"), deleted),
      writeFile(path.join(harness.workspaceRoot, "src/source.ts"), moved),
    ]);
    await chmod(path.join(harness.workspaceRoot, "src/source.ts"), 0o755);
    const worktree = await manager.createWorktree("task_lifecycle1", [
      "src/add.ts",
      "src/delete.ts",
      "src/renamed.ts",
      "src/source.ts",
    ]);
    const tools = manager.createCoderTools(worktree);
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const candidateFile = tools.find((tool) => tool.name === "candidate_file")!;

    await patch.execute("create-addition", {
      operation: "create",
      path: "src/add.ts",
      expectedSha256: null,
      content: added,
    });
    await candidateFile.execute("delete-file", {
      operation: "delete",
      path: "src/delete.ts",
      expectedSha256: sha256(deleted),
    });
    await candidateFile.execute("move-file", {
      operation: "move",
      sourcePath: "src/source.ts",
      destinationPath: "src/renamed.ts",
      expectedSourceSha256: sha256(moved),
      expectedDestinationSha256: null,
    });
    const preview = await manager.storePreview(worktree, "1".repeat(64));

    expect(preview).toEqual(
      expect.objectContaining({
        changedFileCount: 4,
        addedFileCount: 2,
        modifiedFileCount: 0,
        deletedFileCount: 2,
        renamedFileCount: 1,
        review: expect.stringContaining("Operation: add"),
      }),
    );
    await expect(
      readFile(path.join(harness.workspaceRoot, "src/add.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const applied = await manager.apply(preview.id);
    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 4,
        candidateAddedFileCount: 2,
        candidateModifiedFileCount: 0,
        candidateDeletedFileCount: 2,
        candidateRenamedFileCount: 1,
      }),
    );
    await expect(
      readFile(path.join(harness.workspaceRoot, "src/add.ts"), "utf8"),
    ).resolves.toBe(added);
    await expect(
      readFile(path.join(harness.workspaceRoot, "src/renamed.ts"), "utf8"),
    ).resolves.toBe(moved);
    expect(
      (await stat(path.join(harness.workspaceRoot, "src/renamed.ts"))).mode &
        0o777,
    ).toBe(0o755);
    await expect(
      readFile(path.join(harness.workspaceRoot, "src/delete.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(harness.workspaceRoot, "src/source.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rechecks complete source freshness after diagnostics and before commit", async () => {
    const harness = await createHarness();
    const diagnostics = diagnosticsAdapter();
    diagnostics.observeBefore = async () => {
      await writeFile(
        path.join(harness.workspaceRoot, "unrelated.txt"),
        "drift during diagnostics\n",
      );
      return { entries: [], omittedFileCount: 0 };
    };
    const manager = new SubagentWorktreeMutationManager({
      ...harness,
      ownerId: "worker_freshness_test",
      diagnostics,
    });
    const source = "export const value = 1;\n";
    await writeFile(path.join(harness.workspaceRoot, "src/value.ts"), source);
    const worktree = await manager.createWorktree("task_precommit1", [
      "src/value.ts",
    ]);
    const patch = manager
      .createCoderTools(worktree)
      .find((tool) => tool.name === "apply_patch")!;
    await patch.execute("patch-value", {
      operation: "replace",
      path: "src/value.ts",
      expectedSha256: sha256(source),
      edits: [{ oldText: "value = 1", newText: "value = 2" }],
    });
    const preview = await manager.storePreview(worktree, "d".repeat(64));

    await expect(manager.apply(preview.id)).rejects.toThrow(
      "conflicts with workspace drift",
    );
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/value.ts"), "utf8"),
    ).toBe(source);
  });

  it("returns a durable rolled-back outcome when commit fails before mutation", async () => {
    const harness = await createHarness();
    const manager = new SubagentWorktreeMutationManager({
      ...harness,
      ownerId: "worker_rollback_test",
      diagnostics: diagnosticsAdapter(),
      commitOptions: {
        async renameFile() {
          throw new Error("injected commit failure");
        },
      },
    });
    const source = "export const value = 1;\n";
    await writeFile(path.join(harness.workspaceRoot, "src/value.ts"), source);
    const worktree = await manager.createWorktree("task_rollback1", [
      "src/value.ts",
    ]);
    const patch = manager
      .createCoderTools(worktree)
      .find((tool) => tool.name === "apply_patch")!;
    await patch.execute("patch-value", {
      operation: "replace",
      path: "src/value.ts",
      expectedSha256: sha256(source),
      edits: [{ oldText: "value = 1", newText: "value = 2" }],
    });
    const preview = await manager.storePreview(worktree, "e".repeat(64));

    const result = await manager.apply(preview.id);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "rolled_back",
        postcondition: "verified",
        rollbackAttempted: true,
        rollbackVerified: true,
        committedFileCount: 0,
        restoredFileCount: 0,
      }),
    );
    expect(result.details).not.toHaveProperty("diagnostics");
    expect(result.summary).toContain("every changed file was restored");
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/value.ts"), "utf8"),
    ).toBe(source);
  });

  it("isolates concurrent candidates and invalidates previews across restart", async () => {
    const harness = await createHarness();
    const manager = createManager(harness);
    const source = "export const value = 1;\n";
    await writeFile(path.join(harness.workspaceRoot, "src/value.ts"), source);
    const [left, right] = await Promise.all([
      manager.createWorktree("task_left12345", ["src/value.ts"]),
      manager.createWorktree("task_right1234", ["src/value.ts"]),
    ]);
    const patchCandidate = async (
      worktree: typeof left,
      replacement: string,
    ): Promise<void> => {
      const patch = manager
        .createCoderTools(worktree)
        .find((tool) => tool.name === "apply_patch")!;
      await patch.execute(`patch-${replacement}`, {
        operation: "replace",
        path: "src/value.ts",
        expectedSha256: sha256(source),
        edits: [{ oldText: "value = 1", newText: `value = ${replacement}` }],
      });
    };
    await Promise.all([patchCandidate(left, "2"), patchCandidate(right, "3")]);
    const [leftPreview, rightPreview] = await Promise.all([
      manager.storePreview(left, "d".repeat(64)),
      manager.storePreview(right, "e".repeat(64)),
    ]);

    await expect(createManager(harness).apply(rightPreview.id)).rejects.toThrow(
      "preview not found",
    );
    await expect(manager.apply(leftPreview.id)).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ status: "applied" }),
      }),
    );
    await expect(manager.apply(rightPreview.id)).rejects.toThrow(
      "conflicts with workspace drift",
    );
    expect(
      await readFile(path.join(harness.workspaceRoot, "src/value.ts"), "utf8"),
    ).toContain("value = 2");
  });
});

function createManager(harness: {
  workspaceRoot: string;
  dataRoot: string;
}): SubagentWorktreeMutationManager {
  return new SubagentWorktreeMutationManager({
    ...harness,
    ownerId: "worker_mutation_test",
    diagnostics: diagnosticsAdapter(),
  });
}

function diagnosticsAdapter(): LspWorkspaceEditDiagnosticsAdapter<
  LspRenameDiagnosticsState,
  LspRenameDiagnosticsObservation
> {
  return {
    async observeBefore() {
      return { entries: [], omittedFileCount: 0 };
    },
    async observeAfter() {
      return { details: diagnosticsDetails(), summary: "Diagnostics: clean" };
    },
    unavailable() {
      return {
        details: { ...diagnosticsDetails(), status: "unavailable" },
        summary: "Diagnostics: unavailable",
      };
    },
  };
}

function diagnosticsDetails(): LspRenameApplyDiagnosticsDetails {
  const base = {
    kind: "napier.lsp-rename-apply-diagnostics" as const,
    schemaVersion: 1 as const,
    status: "clean" as const,
    fileCount: 0,
    omittedFileCount: 0,
    beforeDiagnosticCount: 0,
    afterDiagnosticCount: 0,
    beforeErrorCount: 0,
    afterErrorCount: 0,
    beforeWarningCount: 0,
    afterWarningCount: 0,
    introducedCount: 0,
    resolvedCount: 0,
    unchangedCount: 0,
    truncated: false,
    beforeResultSetSha256: sha256("before"),
    afterResultSetSha256: sha256("after"),
    deltaSetSha256: sha256("delta"),
    durationMs: 0,
  };
  return { ...base, resultSha256: sha256(JSON.stringify(base)) };
}

async function createHarness(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-manager-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  await writeFile(path.join(workspaceRoot, "README.md"), "workspace\n");
  return { root, workspaceRoot, dataRoot };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

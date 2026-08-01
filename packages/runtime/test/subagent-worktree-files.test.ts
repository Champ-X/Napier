import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  observeSubagentWorktreeSource,
  removeSubagentWorktree,
} from "../src/subagent-worktree-files.js";
import { applyWorkspacePatch } from "../src/tools.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree files", () => {
  it("forks current bytes and returns only declared multi-file changes", async () => {
    const { root, workspaceRoot, dataRoot } = await createWorkspace();
    temporaryRoots.push(root);
    const first = "export const first = 1;\n";
    const second = "export const second = 2;\n";
    await Promise.all([
      writeFile(path.join(workspaceRoot, "src/first.ts"), first),
      writeFile(path.join(workspaceRoot, "src/second.ts"), second),
      writeFile(path.join(workspaceRoot, "README.md"), "private context\n"),
    ]);
    const session = await createSubagentWorktree({
      workspaceRoot,
      dataRoot,
      ownerId: "worker_files_test",
      taskId: "task_12345678",
      writePaths: ["src/first.ts", "src/second.ts"],
    });

    await Promise.all([
      applyWorkspacePatch(session.root, dataRoot, {
        operation: "replace",
        path: "src/first.ts",
        expectedSha256: sha256(first),
        edits: [{ oldText: "first = 1", newText: "first = 10" }],
      }),
      applyWorkspacePatch(session.root, dataRoot, {
        operation: "replace",
        path: "src/second.ts",
        expectedSha256: sha256(second),
        edits: [{ oldText: "second = 2", newText: "second = 20" }],
      }),
    ]);
    const candidate = await finalizeSubagentWorktree(session);

    expect(candidate.changedPaths).toEqual(["src/first.ts", "src/second.ts"]);
    expect(candidate.files).toHaveLength(2);
    expect(candidate.changedFileSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await readFile(path.join(workspaceRoot, "src/first.ts"), "utf8"),
    ).toBe(first);
    await expect(
      observeSubagentWorktreeSource(session),
    ).resolves.toBeUndefined();
    await removeSubagentWorktree(session.root);
  });

  it("rejects undeclared writes, source drift, symlinks, and oversized files", async () => {
    const undeclared = await createWorkspace();
    temporaryRoots.push(undeclared.root);
    await Promise.all([
      writeFile(
        path.join(undeclared.workspaceRoot, "src/first.ts"),
        "export const first = 1;\n",
      ),
      writeFile(
        path.join(undeclared.workspaceRoot, "src/second.ts"),
        "export const second = 2;\n",
      ),
    ]);
    const undeclaredSession = await createSubagentWorktree({
      workspaceRoot: undeclared.workspaceRoot,
      dataRoot: undeclared.dataRoot,
      ownerId: "worker_files_test",
      taskId: "task_undeclared1",
      writePaths: ["src/first.ts"],
    });
    await writeFile(
      path.join(undeclaredSession.root, "src/second.ts"),
      "export const second = 3;\n",
    );
    await expect(finalizeSubagentWorktree(undeclaredSession)).rejects.toThrow(
      "outside its declared write paths",
    );

    const drifted = await createWorkspace();
    temporaryRoots.push(drifted.root);
    await writeFile(
      path.join(drifted.workspaceRoot, "src/value.ts"),
      "export const value = 1;\n",
    );
    const driftedSession = await createSubagentWorktree({
      workspaceRoot: drifted.workspaceRoot,
      dataRoot: drifted.dataRoot,
      ownerId: "worker_files_test",
      taskId: "task_drifted12",
      writePaths: ["src/value.ts"],
    });
    await writeFile(
      path.join(drifted.workspaceRoot, "unrelated.txt"),
      "concurrent writer\n",
    );
    await expect(observeSubagentWorktreeSource(driftedSession)).rejects.toThrow(
      "conflicts with workspace drift",
    );

    const linked = await createWorkspace();
    temporaryRoots.push(linked.root);
    await writeFile(
      path.join(linked.workspaceRoot, "outside.txt"),
      "outside\n",
    );
    await symlink(
      "../outside.txt",
      path.join(linked.workspaceRoot, "src/linked.txt"),
    );
    await expect(
      createSubagentWorktree({
        workspaceRoot: linked.workspaceRoot,
        dataRoot: linked.dataRoot,
        ownerId: "worker_files_test",
        taskId: "task_symlink12",
        writePaths: ["outside.txt"],
      }),
    ).rejects.toThrow("does not admit workspace symlinks");

    const oversized = await createWorkspace();
    temporaryRoots.push(oversized.root);
    await writeFile(
      path.join(oversized.workspaceRoot, "src/large.ts"),
      Buffer.alloc(1024 * 1024 + 1, 0x20),
    );
    await expect(
      createSubagentWorktree({
        workspaceRoot: oversized.workspaceRoot,
        dataRoot: oversized.dataRoot,
        ownerId: "worker_files_test",
        taskId: "task_oversized1",
        writePaths: ["src/large.ts"],
      }),
    ).rejects.toThrow("exceeds its limit");

    const recursive = await createWorkspace();
    temporaryRoots.push(recursive.root);
    const unsafeDataRoot = path.join(recursive.workspaceRoot, "runtime-data");
    await mkdir(unsafeDataRoot);
    await writeFile(
      path.join(recursive.workspaceRoot, "src/value.ts"),
      "export const value = 1;\n",
    );
    await expect(
      createSubagentWorktree({
        workspaceRoot: recursive.workspaceRoot,
        dataRoot: unsafeDataRoot,
        ownerId: "worker_files_test",
        taskId: "task_recursive1",
        writePaths: ["src/value.ts"],
      }),
    ).rejects.toThrow("outside or protected from workspace scans");
  });

  it("removes stale prior-worker directories before creating a new fork", async () => {
    const harness = await createWorkspace();
    temporaryRoots.push(harness.root);
    const source = "export const value = 1;\n";
    await writeFile(path.join(harness.workspaceRoot, "src/value.ts"), source);
    const staleFile = path.join(
      harness.dataRoot,
      "subagent-worktrees/worker_old/task_stale/private.txt",
    );
    await mkdir(path.dirname(staleFile), { recursive: true });
    await writeFile(staleFile, "stale private candidate\n");

    const session = await createSubagentWorktree({
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
      ownerId: "worker_new_test",
      taskId: "task_cleanup12",
      writePaths: ["src/value.ts"],
    });

    await expect(readFile(staleFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const parallel = await createSubagentWorktree({
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
      ownerId: "worker_parallel_test",
      taskId: "task_parallel1",
      writePaths: ["src/value.ts"],
    });
    expect(
      await readFile(path.join(session.root, "src/value.ts"), "utf8"),
    ).toBe(source);
    await removeSubagentWorktree(session.root);
    await removeSubagentWorktree(parallel.root);

    const ownerManifest = path.join(
      harness.dataRoot,
      "subagent-worktrees/worker_new_test/owner.json",
    );
    const forgedManifest = path.join(harness.root, "forged-owner.json");
    await Promise.all([
      rm(ownerManifest),
      writeFile(forgedManifest, `${JSON.stringify({ pid: process.pid })}\n`),
    ]);
    await symlink(forgedManifest, ownerManifest);
    await expect(
      createSubagentWorktree({
        workspaceRoot: harness.workspaceRoot,
        dataRoot: harness.dataRoot,
        ownerId: "worker_new_test",
        taskId: "task_manifest1",
        writePaths: ["src/value.ts"],
      }),
    ).rejects.toThrow("owner manifest is unsafe");
  });
});

async function createWorkspace(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-subagent-worktree-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  return { root, workspaceRoot, dataRoot };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

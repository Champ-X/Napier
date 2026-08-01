import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { commitWorkspaceChanges } from "../src/workspace-change-commit.js";
import type { WorkspaceChange } from "../src/workspace-change-model.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coordinated workspace change commit", () => {
  it("atomically adds, modifies, and deletes one bounded file set", async () => {
    const fixture = await createFixture();
    const outcome = await commitWorkspaceChanges({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sourcePreviewResultSha256: "a".repeat(64),
      changes: fixture.changes,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 3,
        addedFileCount: 1,
        modifiedFileCount: 1,
        deletedFileCount: 1,
        committedFileCount: 3,
        rollbackAttempted: false,
        durable: true,
      }),
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/add.ts"), "utf8"),
    ).resolves.toBe("export const added = true;\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/modify.ts"), "utf8"),
    ).resolves.toBe("export const modified = 2;\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/delete.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expectNoRecoveryFiles(fixture.workspaceRoot);
  });

  it("restores mixed lifecycle changes when a later commit fails", async () => {
    const fixture = await createFixture();
    let stagedRenames = 0;
    const outcome = await commitWorkspaceChanges({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      sourcePreviewResultSha256: "b".repeat(64),
      changes: fixture.changes,
      async renameFile(source, destination) {
        if (source.endsWith(".tmp") && ++stagedRenames === 1) {
          throw new Error("PRIVATE_MIXED_COMMIT_FAILURE");
        }
        await rename(source, destination);
      },
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "rolled_back",
        postcondition: "verified",
        committedFileCount: 2,
        restoredFileCount: 2,
        rollbackAttempted: true,
        rollbackVerified: true,
        errorSha256: sha256("PRIVATE_MIXED_COMMIT_FAILURE"),
      }),
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/add.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/modify.ts"), "utf8"),
    ).resolves.toBe("export const modified = 1;\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/delete.ts"), "utf8"),
    ).resolves.toBe("export const deleted = true;\n");
    expect(JSON.stringify(outcome)).not.toContain("PRIVATE");
    await expectNoRecoveryFiles(fixture.workspaceRoot);
  });

  it("cancels a mixed lifecycle plan before its first side effect", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    let backups = 0;
    await expect(
      commitWorkspaceChanges({
        workspaceRoot: fixture.workspaceRoot,
        dataRoot: fixture.dataRoot,
        sourcePreviewResultSha256: "f".repeat(64),
        changes: fixture.changes,
        signal: controller.signal,
        async linkFile(source, destination) {
          await link(source, destination);
          if (destination.endsWith(".bak") && ++backups === 2) {
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow("aborted before commit");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/add.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/modify.ts"), "utf8"),
    ).resolves.toBe("export const modified = 1;\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "src/delete.ts"), "utf8"),
    ).resolves.toBe("export const deleted = true;\n");
    await expectNoRecoveryFiles(fixture.workspaceRoot);
  });

  it("rejects occupied additions and stale existing files before mutation", async () => {
    const occupied = await createFixture();
    await writeFile(
      path.join(occupied.workspaceRoot, "src/add.ts"),
      "external addition\n",
    );
    await expect(
      commitWorkspaceChanges({
        workspaceRoot: occupied.workspaceRoot,
        dataRoot: occupied.dataRoot,
        sourcePreviewResultSha256: "c".repeat(64),
        changes: occupied.changes,
      }),
    ).rejects.toThrow("create target already exists");
    await expect(
      readFile(path.join(occupied.workspaceRoot, "src/modify.ts"), "utf8"),
    ).resolves.toBe("export const modified = 1;\n");

    const stale = await createFixture();
    await writeFile(
      path.join(stale.workspaceRoot, "src/delete.ts"),
      "external change\n",
    );
    await expect(
      commitWorkspaceChanges({
        workspaceRoot: stale.workspaceRoot,
        dataRoot: stale.dataRoot,
        sourcePreviewResultSha256: "d".repeat(64),
        changes: stale.changes,
      }),
    ).rejects.toThrow("preview is stale");
    await expect(
      readFile(path.join(stale.workspaceRoot, "src/add.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const raced = await createFixture();
    const outcome = await commitWorkspaceChanges({
      workspaceRoot: raced.workspaceRoot,
      dataRoot: raced.dataRoot,
      sourcePreviewResultSha256: "e".repeat(64),
      changes: raced.changes,
      async linkFile(source, destination) {
        if (destination.endsWith("src/add.ts")) {
          await writeFile(destination, "external winner\n");
        }
        await link(source, destination);
      },
    });
    expect(outcome).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        committedFileCount: 0,
        rollbackAttempted: true,
        rollbackVerified: false,
      }),
    );
    await expect(
      readFile(path.join(raced.workspaceRoot, "src/add.ts"), "utf8"),
    ).resolves.toBe("external winner\n");

    const linked = await createFixture();
    const outside = path.join(path.dirname(linked.workspaceRoot), "outside.ts");
    await writeFile(outside, "outside\n");
    await symlink(outside, path.join(linked.workspaceRoot, "src/add.ts"));
    await expect(
      commitWorkspaceChanges({
        workspaceRoot: linked.workspaceRoot,
        dataRoot: linked.dataRoot,
        sourcePreviewResultSha256: "9".repeat(64),
        changes: linked.changes,
      }),
    ).rejects.toThrow("not canonical");
    await expect(
      readFile(path.join(linked.workspaceRoot, "src/modify.ts"), "utf8"),
    ).resolves.toBe("export const modified = 1;\n");
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
  changes: WorkspaceChange[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workspace-change-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  const modifiedBefore = "export const modified = 1;\n";
  const modifiedAfter = "export const modified = 2;\n";
  const deleted = "export const deleted = true;\n";
  const added = "export const added = true;\n";
  await Promise.all([
    writeFile(path.join(workspaceRoot, "src/modify.ts"), modifiedBefore),
    writeFile(path.join(workspaceRoot, "src/delete.ts"), deleted),
  ]);
  const changes: WorkspaceChange[] = [
    {
      path: "src/add.ts",
      pathSha256: sha256("src/add.ts"),
      beforeSha256: null,
      afterSha256: sha256(added),
      content: added,
    },
    {
      path: "src/delete.ts",
      pathSha256: sha256("src/delete.ts"),
      beforeSha256: sha256(deleted),
      afterSha256: null,
    },
    {
      path: "src/modify.ts",
      pathSha256: sha256("src/modify.ts"),
      beforeSha256: sha256(modifiedBefore),
      afterSha256: sha256(modifiedAfter),
      content: modifiedAfter,
    },
  ];
  return { workspaceRoot, dataRoot, changes };
}

async function expectNoRecoveryFiles(workspaceRoot: string): Promise<void> {
  const entries = await readdir(path.join(workspaceRoot, "src"));
  expect(entries.some((entry) => entry.includes(".napier-change-"))).toBe(
    false,
  );
}

import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspacePathSnapshot,
  diffWorkspaceSnapshots,
} from "../src/workspace-snapshot.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace snapshots", () => {
  it("detects added, modified, and removed files without following excluded roots", async () => {
    const root = await createWorkspace();
    await Promise.all([
      writeFile(path.join(root, "modified.txt"), "before"),
      writeFile(path.join(root, "removed.txt"), "remove me"),
      mkdir(path.join(root, ".git")),
      mkdir(path.join(root, "node_modules")),
    ]);
    await Promise.all([
      writeFile(path.join(root, ".git/config"), "ignored git"),
      writeFile(path.join(root, "node_modules/ignored.js"), "ignored module"),
      symlink(path.join(root, "modified.txt"), path.join(root, "linked.txt")),
    ]);
    const before = await createWorkspacePathSnapshot(root, root);

    await Promise.all([
      writeFile(path.join(root, "modified.txt"), "after"),
      writeFile(path.join(root, "added.txt"), "new"),
      unlink(path.join(root, "removed.txt")),
      writeFile(path.join(root, ".git/config"), "ignored drift"),
    ]);
    const after = await createWorkspacePathSnapshot(root, root);
    const delta = diffWorkspaceSnapshots(before, after);

    expect(delta).toEqual(
      expect.objectContaining({
        status: "changed",
        changedFileCount: 3,
        changedPathSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(delta.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["added", "added.txt"],
      ["modified", "modified.txt"],
      ["removed", "removed.txt"],
    ]);
    expect(JSON.stringify(before)).not.toContain(".git");
    expect(JSON.stringify(before)).not.toContain("node_modules");
    expect(JSON.stringify(before)).not.toContain("linked.txt");
  });

  it("optionally tracks empty directory creation and removal without changing default snapshots", async () => {
    const root = await createWorkspace();
    const defaultBefore = await createWorkspacePathSnapshot(root, root);
    const directoryBefore = await createWorkspacePathSnapshot(root, root, {
      includeDirectories: true,
    });
    const emptyDirectory = path.join(root, "generated", "empty");
    await mkdir(emptyDirectory, { recursive: true });

    const defaultAfter = await createWorkspacePathSnapshot(root, root);
    const directoryAfter = await createWorkspacePathSnapshot(root, root, {
      includeDirectories: true,
    });
    expect(defaultAfter.sha256).toBe(defaultBefore.sha256);
    expect(diffWorkspaceSnapshots(defaultBefore, defaultAfter).status).toBe(
      "unchanged",
    );
    expect(diffWorkspaceSnapshots(directoryBefore, directoryAfter)).toEqual(
      expect.objectContaining({
        status: "changed",
        changedFileCount: 2,
        entries: [
          expect.objectContaining({
            kind: "added",
            path: "generated",
            entryKind: "directory",
          }),
          expect.objectContaining({
            kind: "added",
            path: "generated/empty",
            entryKind: "directory",
          }),
        ],
      }),
    );

    await rm(emptyDirectory, { recursive: true });
    const directoryRemoved = await createWorkspacePathSnapshot(root, root, {
      includeDirectories: true,
    });
    expect(diffWorkspaceSnapshots(directoryAfter, directoryRemoved)).toEqual(
      expect.objectContaining({
        status: "changed",
        changedFileCount: 1,
        entries: [
          expect.objectContaining({
            kind: "removed",
            path: "generated/empty",
            entryKind: "directory",
          }),
        ],
      }),
    );
  });

  it("tracks symlink identity without following or exposing its target", async () => {
    const root = await createWorkspace();
    const outside = await createWorkspace();
    const secret = path.join(outside, "private.txt");
    await writeFile(secret, "PRIVATE_TARGET_BODY");
    const defaultBefore = await createWorkspacePathSnapshot(root, root);
    const scopedBefore = await createWorkspacePathSnapshot(root, root, {
      includeDirectories: true,
    });
    await symlink(secret, path.join(root, "linked.txt"));

    const defaultAfter = await createWorkspacePathSnapshot(root, root);
    const scopedAfter = await createWorkspacePathSnapshot(root, root, {
      includeDirectories: true,
    });
    expect(defaultAfter.sha256).toBe(defaultBefore.sha256);
    expect(diffWorkspaceSnapshots(scopedBefore, scopedAfter)).toEqual(
      expect.objectContaining({
        status: "changed",
        changedFileCount: 1,
        entries: [
          expect.objectContaining({
            kind: "added",
            path: "linked.txt",
            entryKind: "symlink",
            afterSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ],
      }),
    );
    expect(JSON.stringify(scopedAfter)).not.toContain(outside);
    expect(JSON.stringify(scopedAfter)).not.toContain("PRIVATE_TARGET_BODY");
  });

  it("reports unchanged complete snapshots and indeterminate truncated snapshots", async () => {
    const root = await createWorkspace();
    await Promise.all([
      writeFile(path.join(root, "a.txt"), "a"),
      writeFile(path.join(root, "b.txt"), "b"),
    ]);
    const complete = await createWorkspacePathSnapshot(root, root);
    expect(diffWorkspaceSnapshots(complete, complete)).toEqual(
      expect.objectContaining({
        status: "unchanged",
        changedFileCount: 0,
        entries: [],
      }),
    );

    const truncated = await createWorkspacePathSnapshot(root, root, {
      maxFiles: 1,
    });
    expect(truncated.truncated).toBe(true);
    expect(diffWorkspaceSnapshots(truncated, complete)).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        changedFileCount: 0,
        entriesTruncated: false,
        entries: [],
      }),
    );
  });

  it("bounds local path details without weakening the complete change summary", async () => {
    const root = await createWorkspace();
    const before = await createWorkspacePathSnapshot(root, root);
    await Promise.all([
      writeFile(path.join(root, "a.txt"), "a"),
      writeFile(path.join(root, "b.txt"), "b"),
      writeFile(path.join(root, "c.txt"), "c"),
    ]);
    const after = await createWorkspacePathSnapshot(root, root);
    const delta = diffWorkspaceSnapshots(before, after, 2);

    expect(delta).toEqual(
      expect.objectContaining({
        status: "changed",
        changedFileCount: 3,
        changedPathSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        entriesTruncated: true,
      }),
    );
    expect(delta.entries.map((entry) => entry.path)).toEqual([
      "a.txt",
      "b.txt",
    ]);
  });

  it("rejects a snapshot target outside the workspace", async () => {
    const root = await createWorkspace();
    await expect(
      createWorkspacePathSnapshot(root, path.dirname(root)),
    ).rejects.toThrow("escapes the workspace");
    const outside = await createWorkspace();
    await symlink(outside, path.join(root, "outside-link"));
    await expect(
      createWorkspacePathSnapshot(root, path.join(root, "outside-link")),
    ).rejects.toThrow("escapes the workspace");
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-snapshot-test-"));
  temporaryRoots.push(root);
  return root;
}

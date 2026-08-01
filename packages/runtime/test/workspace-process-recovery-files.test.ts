import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  captureWorkspaceProcessRecoveryScopes,
  cleanupWorkspaceProcessRollbackArtifacts,
  removeWorkspaceProcessRecovery,
  restoreWorkspaceProcessRecoveryScopes,
  verifyWorkspaceProcessRecoveryScopes,
} from "../src/workspace-process-recovery-files.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace Process recovery file transaction", () => {
  it("removes a partial stage when recovery copying fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const recoveryRoot = path.join(root, "recovery");
    const recoveryDirectory = path.join(recoveryRoot, "process_test");
    const target = path.join(workspaceRoot, "target.txt");
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(recoveryRoot),
    ]);
    await writeFile(target, "before");
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: [target],
      relativePaths: ["target.txt"],
      maximumEntries: 100,
      maximumBytes: 1_024,
      pathSha256: sha256,
    });
    await writeFile(target, "after");
    const renameEntry = vi.fn(rename);

    const outcome = await restoreWorkspaceProcessRecoveryScopes({
      workspaceRoot,
      recoveryDirectory,
      rollbackId: "processrollback_stage",
      scopes: captured.scopes,
      renameEntry,
      stageEntry: async (_source, destination) => {
        await writeFile(destination, "partial");
        throw new Error("injected staging failure");
      },
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "reverted",
        restoredScopeCount: 0,
        durable: true,
        cancellationObserved: false,
        error: expect.any(Error),
      }),
    );
    expect(renameEntry).not.toHaveBeenCalled();
    expect(await readFile(target, "utf8")).toBe("after");
    expect(
      (await readdir(workspaceRoot, { recursive: true })).some((entry) =>
        String(entry).includes(".napier-process-rollback-"),
      ),
    ).toBe(false);
    await expect(
      verifyWorkspaceProcessRecoveryScopes({
        recoveryDirectory,
        scopes: captured.scopes,
      }),
    ).resolves.toBeUndefined();
  });

  it("cleans staged scopes when cancellation reaches the commit barrier", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const recoveryRoot = path.join(root, "recovery");
    const recoveryDirectory = path.join(recoveryRoot, "process_test");
    const target = path.join(workspaceRoot, "target.txt");
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(recoveryRoot),
    ]);
    await writeFile(target, "before");
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: [target],
      relativePaths: ["target.txt"],
      maximumEntries: 100,
      maximumBytes: 1_024,
      pathSha256: sha256,
    });
    await writeFile(target, "after");
    const controller = new AbortController();
    const renameEntry = vi.fn(rename);

    const outcome = await restoreWorkspaceProcessRecoveryScopes({
      workspaceRoot,
      recoveryDirectory,
      rollbackId: "processrollback_cancel",
      scopes: captured.scopes,
      signal: controller.signal,
      renameEntry,
      beforeCommit: () => controller.abort(),
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "reverted",
        restoredScopeCount: 0,
        durable: true,
        cancellationObserved: true,
        error: expect.any(Error),
      }),
    );
    expect(renameEntry).not.toHaveBeenCalled();
    expect(await readFile(target, "utf8")).toBe("after");
    expect(
      (await readdir(workspaceRoot, { recursive: true })).some((entry) =>
        String(entry).includes(".napier-process-rollback-"),
      ),
    ).toBe(false);
    await expect(
      verifyWorkspaceProcessRecoveryScopes({
        recoveryDirectory,
        scopes: captured.scopes,
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves restrictive directory permissions across capture and restore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const recoveryRoot = path.join(root, "recovery");
    const recoveryDirectory = path.join(recoveryRoot, "process_test");
    const target = path.join(workspaceRoot, "target");
    await Promise.all([
      mkdir(target, { recursive: true }),
      mkdir(recoveryRoot),
    ]);
    await writeFile(path.join(target, "value.txt"), "before");
    await chmod(target, 0o555);
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: [target],
      relativePaths: ["target"],
      maximumEntries: 100,
      maximumBytes: 1_024,
      pathSha256: sha256,
    });
    expect(
      (await lstat(path.join(recoveryDirectory, "scope-00"))).mode & 0o777,
    ).toBe(0o555);
    await chmod(target, 0o755);
    await writeFile(path.join(target, "value.txt"), "after");

    const outcome = await restoreWorkspaceProcessRecoveryScopes({
      workspaceRoot,
      recoveryDirectory,
      rollbackId: "processrollback_mode",
      scopes: captured.scopes,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "restored",
        restoredScopeCount: 1,
        durable: true,
      }),
    );
    expect((await lstat(target)).mode & 0o777).toBe(0o555);
    expect(await readFile(path.join(target, "value.txt"), "utf8")).toBe(
      "before",
    );
    await chmod(target, 0o755);
    await cleanupWorkspaceProcessRollbackArtifacts(outcome.cleanupTargets);
    await removeWorkspaceProcessRecovery(recoveryDirectory);
  });

  it("keeps recovery blocked when restored scopes cannot be made durable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const recoveryRoot = path.join(root, "recovery");
    const recoveryDirectory = path.join(recoveryRoot, "process_test");
    const target = path.join(workspaceRoot, "target.txt");
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(recoveryRoot),
    ]);
    await writeFile(target, "before");
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: [target],
      relativePaths: ["target.txt"],
      maximumEntries: 100,
      maximumBytes: 1_024,
      pathSha256: sha256,
    });
    await writeFile(target, "after");

    const outcome = await restoreWorkspaceProcessRecoveryScopes({
      workspaceRoot,
      recoveryDirectory,
      rollbackId: "processrollback_durability",
      scopes: captured.scopes,
      syncParents: async () => false,
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        restoredScopeCount: 1,
        durable: false,
        cancellationObserved: false,
        error: expect.any(Error),
      }),
    );
    expect(await readFile(target, "utf8")).toBe("before");
    await expect(
      verifyWorkspaceProcessRecoveryScopes({
        recoveryDirectory,
        scopes: captured.scopes,
      }),
    ).resolves.toBeUndefined();
    await cleanupWorkspaceProcessRollbackArtifacts(outcome.cleanupTargets);
  });

  it("reverses every committed scope when a later atomic swap fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const recoveryRoot = path.join(root, "recovery");
    const recoveryDirectory = path.join(recoveryRoot, "process_test");
    const first = path.join(workspaceRoot, "first");
    const second = path.join(workspaceRoot, "second");
    await Promise.all([
      mkdir(first, { recursive: true }),
      mkdir(second, { recursive: true }),
      mkdir(recoveryRoot),
    ]);
    await Promise.all([
      writeFile(path.join(first, "value.txt"), "before-one"),
      writeFile(path.join(second, "value.txt"), "before-two"),
    ]);
    const captured = await captureWorkspaceProcessRecoveryScopes({
      recoveryDirectory,
      absolutePaths: [first, second],
      relativePaths: ["first", "second"],
      maximumEntries: 100,
      maximumBytes: 1_024,
      pathSha256: sha256,
    });
    await Promise.all([
      writeFile(path.join(first, "value.txt"), "after-one"),
      writeFile(path.join(second, "value.txt"), "after-two"),
    ]);
    let renameCount = 0;
    const renameEntry = vi.fn(async (source: string, destination: string) => {
      renameCount += 1;
      if (renameCount === 4) {
        throw new Error("injected second-scope commit failure");
      }
      await rename(source, destination);
    });

    const outcome = await restoreWorkspaceProcessRecoveryScopes({
      workspaceRoot,
      recoveryDirectory,
      rollbackId: "processrollback_test",
      scopes: captured.scopes,
      renameEntry,
    });
    expect(outcome).toEqual(
      expect.objectContaining({
        status: "reverted",
        restoredScopeCount: 0,
        durable: true,
        cancellationObserved: false,
        error: expect.any(Error),
      }),
    );
    await cleanupWorkspaceProcessRollbackArtifacts(outcome.cleanupTargets);
    expect(await readFile(path.join(first, "value.txt"), "utf8")).toBe(
      "after-one",
    );
    expect(await readFile(path.join(second, "value.txt"), "utf8")).toBe(
      "after-two",
    );
    expect(
      (await readdir(workspaceRoot, { recursive: true })).some((entry) =>
        String(entry).includes(".napier-process-rollback-"),
      ),
    ).toBe(false);
    await expect(
      verifyWorkspaceProcessRecoveryScopes({
        recoveryDirectory,
        scopes: captured.scopes,
      }),
    ).resolves.toBeUndefined();
    expect(renameEntry).toHaveBeenCalledTimes(7);
  });
});

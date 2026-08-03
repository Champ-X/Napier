import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitCommitMutationManager } from "../src/git-commit.js";
import {
  finalizeGitMergeOperationState,
  GIT_MERGE_OPERATION_FILES,
  isolateGitMergeOperationState,
  rollbackGitMergeOperationState,
  snapshotGitCommitOperationState,
  type GitMergeCompletionFileOperations,
} from "../src/git-commit-operation.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";
import { syncDirectory } from "../src/workspace-file-scope.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Git merge completion recovery", () => {
  it("restores one interrupted cleanup before constructing a new preview", async () => {
    const fixture = await createRepository();
    const mergeParent = await prepareResolvedMerge(fixture.workspaceRoot);
    const expected = await simulateInterruptedCleanup(fixture.workspaceRoot);
    const manager = managerFor(fixture);

    const preview = await manager.preview("thread_recovery", "run_recovery", {
      message: "merge: recovered operation",
    });

    expect(preview.details.mergeParentCommitSha1).toBe(mergeParent);
    for (const [name, content] of expected) {
      await expect(
        readFile(path.join(fixture.workspaceRoot, ".git", name)),
      ).resolves.toEqual(content);
    }
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([]);
  }, 30_000);

  it("fails closed without restoring from a corrupted backup", async () => {
    const fixture = await createRepository();
    await prepareResolvedMerge(fixture.workspaceRoot);
    const expected = await simulateInterruptedCleanup(fixture.workspaceRoot);
    await writeFile(
      path.join(
        fixture.workspaceRoot,
        ".git/napier-stage/merge-cleanup-Ab12Cd/backup/MERGE_HEAD",
      ),
      `${"0".repeat(40)}\n`,
    );
    const manager = managerFor(fixture);

    await expect(
      manager.preview("thread_corrupt", "run_corrupt", {
        message: "merge: must fail closed",
      }),
    ).rejects.toThrow("Git merge cleanup recovery failed");

    for (const name of expected.keys()) {
      await expect(
        readFile(path.join(fixture.workspaceRoot, ".git", name)),
      ).rejects.toThrow();
    }
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual(["merge-cleanup-Ab12Cd"]);
  }, 30_000);

  it("garbage-collects a durable completed transaction before preview", async () => {
    const fixture = await createRepository();
    const transaction = await isolatedTransaction(fixture);
    expect(
      await finalizeGitMergeOperationState(transaction, {
        ...realCompletionOperations(),
        rm: async () => {
          throw new Error("injected retained completed transaction");
        },
      }),
    ).toBe(true);
    const root = path.join(fixture.workspaceRoot, ".git/napier-stage");
    const manager = managerFor(fixture);

    const preview = await manager.preview("thread_complete", "run_complete", {
      message: "feat: collect completed cleanup",
    });

    expect(preview.details.status).toBe("ready");
    await expect(readdir(root)).resolves.toEqual([]);
  }, 30_000);

  it("distinguishes pre-boundary failures from post-boundary garbage", async () => {
    const renameFixture = await createRepository();
    const renameTransaction = await isolatedTransaction(renameFixture);
    expect(
      await finalizeGitMergeOperationState(renameTransaction, {
        ...realCompletionOperations(),
        rename: async () => {
          throw new Error("injected rename failure");
        },
      }),
    ).toBe(false);
    await expect(
      rollbackGitMergeOperationState(renameTransaction),
    ).resolves.toBe(true);

    const syncFixture = await createRepository();
    const syncTransaction = await isolatedTransaction(syncFixture);
    expect(
      await finalizeGitMergeOperationState(syncTransaction, {
        ...realCompletionOperations(),
        syncDirectory: async () => {
          throw new Error("injected sync failure");
        },
      }),
    ).toBe(false);
    await expect(rollbackGitMergeOperationState(syncTransaction)).resolves.toBe(
      true,
    );

    const garbageFixture = await createRepository();
    const garbageTransaction = await isolatedTransaction(garbageFixture);
    expect(
      await finalizeGitMergeOperationState(garbageTransaction, {
        ...realCompletionOperations(),
        rm: async () => {
          throw new Error("injected garbage collection failure");
        },
      }),
    ).toBe(true);
    await expect(
      snapshotGitCommitOperationState({
        root: garbageFixture.workspaceRoot,
        gitDirectory: path.join(garbageFixture.workspaceRoot, ".git"),
      }),
    ).resolves.toEqual(expect.objectContaining({ kind: "ordinary" }));
    await expect(
      readdir(path.join(garbageFixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([path.basename(garbageTransaction.directory)]);
  }, 30_000);
});

async function isolatedTransaction(fixture: {
  workspaceRoot: string;
}): Promise<
  NonNullable<Awaited<ReturnType<typeof isolateGitMergeOperationState>>>
> {
  await prepareResolvedMerge(fixture.workspaceRoot);
  const canonicalRoot = await realpath(fixture.workspaceRoot);
  const repository = {
    root: canonicalRoot,
    gitDirectory: path.join(canonicalRoot, ".git"),
  };
  await mkdir(path.join(repository.gitDirectory, "napier-stage"), {
    mode: 0o700,
  });
  const expected = await snapshotGitCommitOperationState(repository);
  const transaction = await isolateGitMergeOperationState({
    repository,
    expected,
  });
  if (!transaction) throw new Error("Expected merge cleanup transaction");
  return transaction;
}

function realCompletionOperations(): GitMergeCompletionFileOperations {
  return {
    rename,
    rm: (target, options) => rm(target, options),
    syncDirectory,
  };
}

async function simulateInterruptedCleanup(
  workspaceRoot: string,
): Promise<Map<string, Buffer>> {
  const gitDirectory = path.join(workspaceRoot, ".git");
  const root = path.join(gitDirectory, "napier-stage");
  const directory = path.join(root, "merge-cleanup-Ab12Cd");
  const backup = path.join(directory, "backup");
  const isolated = path.join(directory, "isolated");
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await mkdir(isolated, { mode: 0o700 });
  for (const target of [root, directory, backup, isolated]) {
    await chmod(target, 0o700);
  }
  const expected = new Map<string, Buffer>();
  for (const name of GIT_MERGE_OPERATION_FILES) {
    const source = path.join(gitDirectory, name);
    const info = await lstat(source).catch(() => undefined);
    if (!info) continue;
    const content = await readFile(source);
    expected.set(name, content);
    const backupPath = path.join(backup, name);
    await writeFile(backupPath, content, { mode: info.mode & 0o777 });
    await chmod(backupPath, info.mode & 0o777);
    await rename(source, path.join(isolated, name));
  }
  return expected;
}

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-recovery-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_BEFORE\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
  await fixtureCommit(workspaceRoot, "fixture");
  return { root, workspaceRoot };
}

async function prepareResolvedMerge(workspaceRoot: string): Promise<string> {
  await git(workspaceRoot, ["branch", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_OURS\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
  await fixtureCommit(workspaceRoot, "ours");
  await git(workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_THEIRS\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
  await fixtureCommit(workspaceRoot, "theirs");
  const mergeParent = (
    await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["checkout", "--quiet", "main"]);
  await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "merge",
      "feature",
    ],
    { cwd: workspaceRoot, env: gitEnvironment() },
  ).catch(() => undefined);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_RESOLVED\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
  return mergeParent;
}

function managerFor(fixture: {
  root: string;
  workspaceRoot: string;
}): GitCommitMutationManager {
  return new GitCommitMutationManager({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: path.join(fixture.root, "data"),
    sandbox: directSandbox(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: gitEnvironment(),
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: gitEnvironment(),
    })
  ).stdout;
}

async function fixtureCommit(cwd: string, message: string): Promise<void> {
  await git(cwd, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function directSandbox(): OsSandboxAdapter & {
  launches: SandboxLaunchRequest[];
} {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-recovery-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      return childProcess(
        spawn(request.command, request.args, {
          cwd: request.cwd,
          env: {
            ...request.env,
            HOME: path.join(request.workspaceRoot, ".napier-test-home"),
            TMPDIR: request.workspaceRoot,
          },
          detached: true,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
    },
  };
}

function childProcess(child: ChildProcess): SandboxedProcess {
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: null }));
  });
  return {
    stdin: child.stdin!,
    stdout: child.stdout!,
    stderr: child.stderr!,
    exit,
    terminate: async () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
      await exit;
    },
  };
}

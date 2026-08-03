import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitBranchSwitchMutationManager } from "../src/git-branch-switch.js";
import { cleanupGitBranchCheckoutDirectory } from "../src/git-branch-switch-checkout-files.js";
import { prepareGitBranchCheckout } from "../src/git-branch-switch-checkout-prepare.js";
import {
  applyGitBranchCheckoutWorktree,
  createGitBranchCheckoutTransaction,
  installGitBranchCheckoutTargetIndex,
} from "../src/git-branch-switch-checkout-transaction.js";
import {
  resolveGitRepository,
  snapshotGitRepository,
} from "../src/git-repository.js";
import { snapshotGitHeadReflog } from "../src/git-ref-files.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("divergent Git branch checkout recovery", () => {
  it("rolls back an interrupted pre-HEAD worktree and index on next preview", async () => {
    const fixture = await createDivergentFixture();
    const sandbox = directSandbox();
    const repository = await resolveGitRepository(fixture.workspaceRoot);
    const repositoryState = await snapshotGitRepository(repository);
    const headReflogState = await snapshotGitHeadReflog(repository);
    const prepared = await prepareGitBranchCheckout({
      options: { workspaceRoot: fixture.workspaceRoot, sandbox },
      repository,
      repositoryState,
      configOutput: "",
      sourceCommitSha1: fixture.sourceCommit,
      targetCommitSha1: fixture.targetCommit,
      deadline: Date.now() + 15_000,
    });
    if (!prepared.checkout) throw new Error("Expected divergent checkout");
    const transaction = await createGitBranchCheckoutTransaction({
      repository,
      targetRef: "refs/heads/feature/divergent",
      headReflogState,
      repositoryState,
      prepared: prepared.checkout,
    });
    expect(await applyGitBranchCheckoutWorktree(transaction)).toBe(true);
    expect(
      await installGitBranchCheckoutTargetIndex({
        transaction,
        verifyCurrentState: async () => undefined,
      }),
    ).toBe(true);
    await cleanupGitBranchCheckoutDirectory(
      prepared.checkout.temporaryDirectory,
    );
    expect(await currentBranch(fixture.workspaceRoot)).toBe("main");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "TRACKED.txt"), "utf8"),
    ).resolves.toBe("target\n");

    const preview = await managerFor(fixture, directSandbox()).preview(
      "thread_recover_source",
      "run_recover_source",
      { targetBranchName: "feature/divergent" },
    );

    expect(preview.details).toEqual(
      expect.objectContaining({
        checkoutRequired: true,
        recoveryAction: "rolled_back",
      }),
    );
    expect(await currentBranch(fixture.workspaceRoot)).toBe("main");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "TRACKED.txt"), "utf8"),
    ).resolves.toBe("source\n");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "status",
        "--porcelain=v2",
        "--untracked-files=all",
      ]),
    ).toBe("");
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")),
    ).resolves.toEqual([]);
  }, 30_000);

  it("finishes a complete target state after the ref process is reported failed", async () => {
    const fixture = await createDivergentFixture();
    const manager = managerFor(
      fixture,
      directSandbox({ reportSwitchFailure: true }),
    );
    const preview = await manager.preview("thread_target", "run_target", {
      targetBranchName: "feature/divergent",
    });

    const result = await manager.apply(
      "thread_target",
      "run_target",
      preview.id,
    );

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        switchStatus: "failed",
        durable: false,
      }),
    );
    expect(await currentBranch(fixture.workspaceRoot)).toBe(
      "feature/divergent",
    );
    expect(
      (await readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")))
        .length,
    ).toBe(1);
    await git(fixture.workspaceRoot, ["branch", "recovery/next"]);

    const recovered = await managerFor(fixture, directSandbox()).preview(
      "thread_recover_target",
      "run_recover_target",
      { targetBranchName: "recovery/next" },
    );

    expect(recovered.details.recoveryAction).toBe("completed");
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")),
    ).resolves.toEqual([]);
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "status",
        "--porcelain=v2",
        "--untracked-files=all",
      ]),
    ).toBe("");
  }, 30_000);

  it("rolls back target files and index when the target ref loses its CAS", async () => {
    const fixture = await createDivergentFixture();
    const manager = managerFor(
      fixture,
      directSandbox({
        beforeSwitch: () =>
          git(fixture.workspaceRoot, [
            "update-ref",
            "refs/heads/feature/divergent",
            fixture.sourceCommit,
            fixture.targetCommit,
          ]),
      }),
    );
    const preview = await manager.preview("thread_cas", "run_cas", {
      targetBranchName: "feature/divergent",
    });

    const result = await manager.apply("thread_cas", "run_cas", preview.id);

    expect(result.details.status).toBe("indeterminate");
    expect(await currentBranch(fixture.workspaceRoot)).toBe("main");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "TRACKED.txt"), "utf8"),
    ).resolves.toBe("source\n");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "status",
        "--porcelain=v2",
        "--untracked-files=all",
      ]),
    ).toBe("");
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")),
    ).resolves.toEqual([]);
  }, 30_000);

  it("fails closed without deleting a transaction whose backup changed", async () => {
    const fixture = await createDivergentFixture();
    const manager = managerFor(
      fixture,
      directSandbox({ reportSwitchFailure: true }),
    );
    const preview = await manager.preview("thread_corrupt", "run_corrupt", {
      targetBranchName: "feature/divergent",
    });
    await manager.apply("thread_corrupt", "run_corrupt", preview.id);
    const root = path.join(fixture.workspaceRoot, ".git/napier-switch");
    const active = (await readdir(root)).find((name) =>
      /^checkout-[A-Za-z0-9]{6}$/u.test(name),
    );
    if (!active) throw new Error("Expected active checkout transaction");
    const backup = (await readdir(path.join(root, active, "backup")))[0];
    if (!backup) throw new Error("Expected checkout backup");
    await writeFile(path.join(root, active, "backup", backup), "corrupt\n");

    await expect(
      managerFor(fixture, directSandbox()).preview(
        "thread_corrupt_recovery",
        "run_corrupt_recovery",
        { targetBranchName: "feature/divergent" },
      ),
    ).rejects.toThrow("Git branch checkout recovery failed");

    expect(await currentBranch(fixture.workspaceRoot)).toBe(
      "feature/divergent",
    );
    await expect(readdir(root)).resolves.toEqual([active]);
  }, 30_000);

  it("rejects dirty, converted, attributed, and binary checkout state", async () => {
    const dirty = await createDivergentFixture();
    await writeFile(path.join(dirty.workspaceRoot, "TRACKED.txt"), "dirty\n");
    await expect(
      managerFor(dirty, directSandbox()).preview("thread_dirty", "run_dirty", {
        targetBranchName: "feature/divergent",
      }),
    ).rejects.toThrow("requires a clean repository");

    const converted = await createDivergentFixture();
    await git(converted.workspaceRoot, ["config", "core.autocrlf", "false"]);
    await expect(
      managerFor(converted, directSandbox()).preview(
        "thread_config",
        "run_config",
        { targetBranchName: "feature/divergent" },
      ),
    ).rejects.toThrow("conversion config is unsupported");

    const attributed = await createDivergentFixture();
    await writeFile(
      path.join(attributed.workspaceRoot, ".gitattributes"),
      "*.txt text\n",
    );
    await git(attributed.workspaceRoot, ["add", ".gitattributes"]);
    await fixtureCommit(attributed.workspaceRoot, "attributes");
    await expect(
      managerFor(attributed, directSandbox()).preview(
        "thread_attributes",
        "run_attributes",
        { targetBranchName: "feature/divergent" },
      ),
    ).rejects.toThrow("attributes are unsupported");

    const binary = await createDivergentFixture();
    await git(binary.workspaceRoot, [
      "checkout",
      "--quiet",
      "feature/divergent",
    ]);
    await writeFile(
      path.join(binary.workspaceRoot, "TRACKED.txt"),
      Buffer.from([0, 1, 2, 3]),
    );
    await git(binary.workspaceRoot, ["add", "TRACKED.txt"]);
    await fixtureCommit(binary.workspaceRoot, "binary target");
    await git(binary.workspaceRoot, ["checkout", "--quiet", "main"]);
    await expect(
      managerFor(binary, directSandbox()).preview(
        "thread_binary",
        "run_binary",
        { targetBranchName: "feature/divergent" },
      ),
    ).rejects.toThrow("complete UTF-8 text only");
  }, 30_000);

  it("fails before a transaction when a reviewed parent becomes a symlink", async () => {
    const fixture = await createDivergentFixture();
    const nested = path.join(fixture.workspaceRoot, "nested");
    await mkdir(nested);
    await writeFile(path.join(nested, "FILE.txt"), "source nested\n");
    await git(fixture.workspaceRoot, ["add", "nested/FILE.txt"]);
    await fixtureCommit(fixture.workspaceRoot, "nested source");
    const manager = managerFor(fixture, directSandbox());
    const preview = await manager.preview(
      "thread_parent_drift",
      "run_parent_drift",
      { targetBranchName: "feature/divergent" },
    );
    const saved = path.join(fixture.root, "saved-nested");
    const external = path.join(fixture.root, "external-nested");
    await rename(nested, saved);
    await mkdir(external);
    await writeFile(path.join(external, "FILE.txt"), "external\n");
    await symlink(external, nested);

    await expect(
      manager.apply("thread_parent_drift", "run_parent_drift", preview.id),
    ).rejects.toThrow();

    await expect(
      readFile(path.join(external, "FILE.txt"), "utf8"),
    ).resolves.toBe("external\n");
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")),
    ).resolves.toEqual([]);
  }, 30_000);

  it("preserves dirty state when different commits have the same tree", async () => {
    const fixture = await createDivergentFixture();
    const tree = (
      await gitOutput(fixture.workspaceRoot, [
        "rev-parse",
        `${fixture.sourceCommit}^{tree}`,
      ])
    ).trim();
    const target = (
      await gitOutput(fixture.workspaceRoot, [
        "-c",
        "user.name=Napier Test",
        "-c",
        "user.email=napier@example.invalid",
        "commit-tree",
        tree,
        "-p",
        fixture.sourceCommit,
        "-m",
        "same tree",
      ])
    ).trim();
    await git(fixture.workspaceRoot, [
      "update-ref",
      "refs/heads/feature/divergent",
      target,
      fixture.targetCommit,
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "staged\n",
    );
    await git(fixture.workspaceRoot, ["add", "TRACKED.txt"]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "unstaged\n",
    );
    const indexBefore = await readFile(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const worktreeBefore = await readFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
    );
    const manager = managerFor(fixture, directSandbox());

    const preview = await manager.preview("thread_same_tree", "run_same_tree", {
      targetBranchName: "feature/divergent",
    });
    const result = await manager.apply(
      "thread_same_tree",
      "run_same_tree",
      preview.id,
    );

    expect(preview.details).toEqual(
      expect.objectContaining({
        sourceCommitSha1: fixture.sourceCommit,
        commitSha1: target,
        checkoutRequired: false,
        fileCount: 0,
      }),
    );
    expect(result.details.status).toBe("applied");
    expect(await currentBranch(fixture.workspaceRoot)).toBe(
      "feature/divergent",
    );
    await expect(
      readFile(path.join(fixture.workspaceRoot, ".git/index")),
    ).resolves.toEqual(indexBefore);
    await expect(
      readFile(path.join(fixture.workspaceRoot, "TRACKED.txt")),
    ).resolves.toEqual(worktreeBefore);
  }, 30_000);
});

async function createDivergentFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  sourceCommit: string;
  targetCommit: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-switch-recovery-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "source\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
  await fixtureCommit(workspaceRoot, "source");
  const sourceCommit = (
    await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["branch", "feature/divergent"]);
  await git(workspaceRoot, ["checkout", "--quiet", "feature/divergent"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "target\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
  await fixtureCommit(workspaceRoot, "target");
  const targetCommit = (
    await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["checkout", "--quiet", "main"]);
  return { root, workspaceRoot, sourceCommit, targetCommit };
}

function managerFor(
  fixture: { root: string; workspaceRoot: string },
  sandbox: OsSandboxAdapter,
): GitBranchSwitchMutationManager {
  return new GitBranchSwitchMutationManager({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: path.join(fixture.root, "data"),
    sandbox,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function currentBranch(workspaceRoot: string): Promise<string> {
  return (
    await gitOutput(workspaceRoot, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
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

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function directSandbox(
  options: {
    reportSwitchFailure?: boolean;
    beforeSwitch?: () => Promise<void>;
  } = {},
): OsSandboxAdapter & { launches: SandboxLaunchRequest[] } {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-switch-recovery-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      if (
        options.beforeSwitch &&
        request.args.includes("update-ref") &&
        request.args.includes("--stdin")
      ) {
        await options.beforeSwitch();
      }
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: {
          ...request.env,
          HOME: path.join(request.workspaceRoot, ".napier-test-home"),
          TMPDIR: request.workspaceRoot,
        },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const process = childProcess(child);
      if (
        options.reportSwitchFailure &&
        request.args.includes("update-ref") &&
        request.args.includes("--stdin")
      ) {
        return {
          ...process,
          exit: process.exit.then(() => ({ code: 1, signal: null })),
        };
      }
      return process;
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

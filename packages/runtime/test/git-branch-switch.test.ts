import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  appendFile,
  chmod,
  lstat,
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

import { EXECUTION_PLAN_WORKFLOW_TOOL_NAMES } from "@napier/contracts";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { GitBranchSwitchMutationManager } from "../src/git-branch-switch.js";
import { assessToolCall } from "../src/policy.js";
import { DEFAULT_AGENT_ENABLED_TOOLS } from "../src/read-only-tool-names.js";
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

describe("preview-bound same-commit Git branch switch", () => {
  it("atomically attaches HEAD while preserving dirty index and worktree state", async () => {
    const fixture = await createRepository();
    await git(fixture.workspaceRoot, ["branch", "feature/reviewed"]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "staged\n",
    );
    await git(fixture.workspaceRoot, ["add", "TRACKED.txt"]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "unstaged\n",
    );
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const before = await workspaceState(fixture.workspaceRoot);
    const hookMarker = path.join(fixture.workspaceRoot, "HOOK_RAN");
    const hookPath = path.join(
      fixture.workspaceRoot,
      ".git/hooks/reference-transaction",
    );
    await writeFile(hookPath, "#!/bin/sh\nprintf ran > HOOK_RAN\nexit 1\n");
    await chmod(hookPath, 0o700);

    const preview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "feature/reviewed",
    });

    expect(preview).toEqual(
      expect.objectContaining({
        targetBranchName: "feature/reviewed",
        details: expect.objectContaining({
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          commitSha1: before.headCommit,
          durable: false,
        }),
      }),
    );
    expect(await workspaceState(fixture.workspaceRoot)).toEqual(before);
    await expect(
      manager.apply("thread_a", "run_other", preview.id),
    ).rejects.toThrow("not found");

    const applied = await manager.apply("thread_a", "run_a", preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        status: "applied",
        postcondition: "verified",
        switchStatus: "succeeded",
        commitSha1: before.headCommit,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: true,
      }),
    );
    const after = await workspaceState(fixture.workspaceRoot);
    expect(after).toEqual({
      ...before,
      currentBranch: "feature/reviewed",
      headFileSha256: expect.not.stringMatching(before.headFileSha256),
      headReflogSha256: expect.not.stringMatching(before.headReflogSha256),
    });
    await expect(readFile(hookMarker, "utf8")).rejects.toThrow();
    const lastReflog = (
      await readFile(path.join(fixture.workspaceRoot, ".git/logs/HEAD"), "utf8")
    )
      .trimEnd()
      .split("\n")
      .at(-1);
    expect(lastReflog).toMatch(
      new RegExp(
        `^${before.headCommit} ${before.headCommit} .+\\tnapier switch branch$`,
        "u",
      ),
    );
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("not found");
    const launch = sandbox.launches.find(
      (request) =>
        request.args.includes("update-ref") && request.args.includes("--stdin"),
    );
    expect(launch?.args).toEqual(
      expect.arrayContaining([
        "core.hooksPath=/dev/null",
        "update-ref",
        "--no-deref",
        "--stdin",
      ]),
    );
    expect(launch?.workspaceWritePaths).toEqual([
      path.join(launch!.workspaceRoot, ".git"),
    ]);
  }, 30_000);

  it("switches one bounded clean worktree to a divergent local branch", async () => {
    const fixture = await createRepository();
    await writeFile(path.join(fixture.workspaceRoot, "DELETE.txt"), "delete\n");
    await git(fixture.workspaceRoot, ["add", "DELETE.txt"]);
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "source",
    ]);
    const sourceCommit = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    await git(fixture.workspaceRoot, ["branch", "feature/divergent"]);
    await git(fixture.workspaceRoot, [
      "checkout",
      "--quiet",
      "feature/divergent",
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "target\n",
    );
    await writeFile(path.join(fixture.workspaceRoot, "ADDED.txt"), "added\n");
    await git(fixture.workspaceRoot, ["add", "TRACKED.txt", "ADDED.txt"]);
    await git(fixture.workspaceRoot, ["rm", "--quiet", "DELETE.txt"]);
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "target",
    ]);
    const targetCommit = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const targetTree = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD^{tree}"])
    ).trim();
    await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const before = await workspaceState(fixture.workspaceRoot);

    const preview = await manager.preview("thread_divergent", "run_divergent", {
      targetBranchName: "feature/divergent",
    });

    expect(preview.details).toEqual(
      expect.objectContaining({
        status: "ready",
        sourceCommitSha1: sourceCommit,
        commitSha1: targetCommit,
        checkoutRequired: true,
        fileCount: 3,
        proposedIndexSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(preview.patch).toContain("diff --git");
    expect(preview.patch).toContain("+target");
    expect(preview.patch).toContain("+added");
    expect(await workspaceState(fixture.workspaceRoot)).toEqual(before);

    const applied = await manager.apply(
      "thread_divergent",
      "run_divergent",
      preview.id,
    );

    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        sourceCommitSha1: sourceCommit,
        commitSha1: targetCommit,
        checkoutRequired: true,
        durable: true,
      }),
    );
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/divergent");
    expect(
      (await gitOutput(fixture.workspaceRoot, ["write-tree"])).trim(),
    ).toBe(targetTree);
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "status",
        "--porcelain=v2",
        "--untracked-files=all",
      ]),
    ).toBe("");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "TRACKED.txt"), "utf8"),
    ).resolves.toBe("target\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "ADDED.txt"), "utf8"),
    ).resolves.toBe("added\n");
    await expect(
      readFile(path.join(fixture.workspaceRoot, "DELETE.txt")),
    ).rejects.toThrow();
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-switch")),
    ).resolves.toEqual([]);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, ["rev-parse", "refs/heads/main"])
      ).trim(),
    ).toBe(sourceCommit);
    expect(
      sandbox.launches.some(
        (request) =>
          request.args.includes("read-tree") &&
          request.workspaceWritePaths?.some((value) =>
            value.includes("/.git/napier-switch/preview-"),
          ),
      ),
    ).toBe(true);
  }, 30_000);

  it("rejects current, missing, stale, unsafe, and symlinked targets", async () => {
    const fixture = await createRepository();
    const manager = managerFor(fixture, directSandbox());
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "main",
      }),
    ).rejects.toThrow("already current");
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "missing",
      }),
    ).rejects.toThrow("target branch is unavailable");

    await git(fixture.workspaceRoot, ["branch", "divergent"]);
    const parent = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const tree = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD^{tree}"])
    ).trim();
    const divergent = (
      await gitOutput(fixture.workspaceRoot, [
        "-c",
        "user.name=Napier Test",
        "-c",
        "user.email=napier@example.invalid",
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        "divergent",
      ])
    ).trim();
    await git(fixture.workspaceRoot, [
      "update-ref",
      "refs/heads/divergent",
      divergent,
      parent,
    ]);
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "divergent",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          sourceCommitSha1: parent,
          commitSha1: divergent,
          checkoutRequired: false,
          fileCount: 0,
        }),
      }),
    );

    await git(fixture.workspaceRoot, ["branch", "feature/stale"]);
    const headPath = path.join(fixture.workspaceRoot, ".git/HEAD");
    await writeFile(headPath, "ref: refs/heads/bad name\n");
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "feature/stale",
      }),
    ).rejects.toThrow("current HEAD is unavailable");
    await writeFile(headPath, "ref: refs/heads/main\n");

    const external = path.join(fixture.root, "external-ref");
    await mkdir(external);
    await symlink(
      external,
      path.join(fixture.workspaceRoot, ".git/refs/heads/symlinked"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "symlinked/target",
      }),
    ).rejects.toThrow("ancestor is not canonical");
    await symlink(
      "feature/stale",
      path.join(fixture.workspaceRoot, ".git/refs/heads/alias"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "alias",
      }),
    ).rejects.toThrow("ref file is not canonical");

    const headLogPath = path.join(fixture.workspaceRoot, ".git/logs/HEAD");
    const originalMode = (await lstat(headLogPath)).mode & 0o777;
    const modePreview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "feature/stale",
    });
    await chmod(headLogPath, originalMode === 0o600 ? 0o644 : 0o600);
    await expect(
      manager.apply("thread_a", "run_a", modePreview.id),
    ).rejects.toThrow("preview is stale");
    await chmod(headLogPath, originalMode);

    const preview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "feature/stale",
    });
    await appendFile(
      headLogPath,
      `${parent} ${parent} Test <test@example.invalid> 0 +0000\tstale\n`,
    );
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("preview is stale");

    await git(fixture.workspaceRoot, [
      "config",
      "core.sharedRepository",
      "group",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "feature/stale",
      }),
    ).rejects.toThrow("unsafe execution configuration");
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "core.sharedRepository",
    ]);
    const headLog = path.join(fixture.workspaceRoot, ".git/logs/HEAD");
    const savedLog = path.join(fixture.root, "saved-head-log");
    await rename(headLog, savedLog);
    await symlink(savedLog, headLog);
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "feature/stale",
      }),
    ).rejects.toThrow();
  }, 30_000);

  it("rejects Git without transactional symbolic-ref support before preview", async () => {
    const fixture = await createRepository();
    await git(fixture.workspaceRoot, ["branch", "feature/unsupported-git"]);
    const sandbox = directSandbox({ gitVersion: "git version 2.45.4" });
    const manager = managerFor(fixture, sandbox);

    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "feature/unsupported-git",
      }),
    ).rejects.toThrow("requires Git 2.46.0 or newer");
    expect(
      sandbox.launches.some(
        (request) =>
          request.args.includes("update-ref") &&
          request.args.includes("--stdin"),
      ),
    ).toBe(false);
  });

  it("atomically rejects target and source symref races", async () => {
    const targetFixture = await createRepository();
    await git(targetFixture.workspaceRoot, ["branch", "feature/target-race"]);
    const original = (
      await gitOutput(targetFixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const moved = await createSiblingCommit(
      targetFixture.workspaceRoot,
      original,
    );
    const targetManager = managerFor(
      targetFixture,
      directSandbox({
        beforeSwitch: async () => {
          await git(targetFixture.workspaceRoot, [
            "update-ref",
            "refs/heads/feature/target-race",
            moved,
            original,
          ]);
        },
      }),
    );
    const targetPreview = await targetManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/target-race",
    });

    const targetResult = await targetManager.apply(
      "thread_a",
      "run_a",
      targetPreview.id,
    );

    expect(targetResult.details.status).toBe("indeterminate");
    expect(
      (
        await gitOutput(targetFixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("main");
    expect(
      (
        await gitOutput(targetFixture.workspaceRoot, [
          "rev-parse",
          "feature/target-race",
        ])
      ).trim(),
    ).toBe(moved);

    const sourceFixture = await createRepository();
    await git(sourceFixture.workspaceRoot, ["branch", "feature/source-race"]);
    await git(sourceFixture.workspaceRoot, ["branch", "other"]);
    const sourceManager = managerFor(
      sourceFixture,
      directSandbox({
        beforeSwitch: async () => {
          await git(sourceFixture.workspaceRoot, [
            "symbolic-ref",
            "HEAD",
            "refs/heads/other",
          ]);
        },
      }),
    );
    const sourcePreview = await sourceManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/source-race",
    });

    const sourceResult = await sourceManager.apply(
      "thread_a",
      "run_a",
      sourcePreview.id,
    );

    expect(sourceResult.details.status).toBe("indeterminate");
    expect(
      (
        await gitOutput(sourceFixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/source-race");

    const sourceOidFixture = await createRepository();
    await git(sourceOidFixture.workspaceRoot, [
      "branch",
      "feature/source-oid-race",
    ]);
    const sourceOidOriginal = (
      await gitOutput(sourceOidFixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const sourceOidMoved = await createSiblingCommit(
      sourceOidFixture.workspaceRoot,
      sourceOidOriginal,
    );
    const sourceOidManager = managerFor(
      sourceOidFixture,
      directSandbox({
        beforeSwitch: async () => {
          await git(sourceOidFixture.workspaceRoot, [
            "update-ref",
            "refs/heads/main",
            sourceOidMoved,
            sourceOidOriginal,
          ]);
        },
      }),
    );
    const sourceOidPreview = await sourceOidManager.preview(
      "thread_a",
      "run_a",
      { targetBranchName: "feature/source-oid-race" },
    );

    const sourceOidResult = await sourceOidManager.apply(
      "thread_a",
      "run_a",
      sourceOidPreview.id,
    );

    expect(sourceOidResult.details.status).toBe("indeterminate");
    expect(
      (
        await gitOutput(sourceOidFixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("main");
    expect(
      (
        await gitOutput(sourceOidFixture.workspaceRoot, ["rev-parse", "main"])
      ).trim(),
    ).toBe(sourceOidMoved);

    const symlinkFixture = await createRepository();
    await git(symlinkFixture.workspaceRoot, ["branch", "feature/symlink-race"]);
    const symlinkCommit = (
      await gitOutput(symlinkFixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const symlinkManager = managerFor(
      symlinkFixture,
      directSandbox({
        beforeSwitch: async () => {
          const refDirectory = path.join(
            symlinkFixture.workspaceRoot,
            ".git/refs/heads/feature",
          );
          await rename(
            refDirectory,
            path.join(symlinkFixture.root, "saved-feature-refs"),
          );
          const external = path.join(symlinkFixture.root, "external-refs");
          await mkdir(external);
          await writeFile(
            path.join(external, "symlink-race"),
            `${symlinkCommit}\n`,
          );
          await symlink(external, refDirectory);
        },
      }),
    );
    const symlinkPreview = await symlinkManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/symlink-race",
    });

    const symlinkResult = await symlinkManager.apply(
      "thread_a",
      "run_a",
      symlinkPreview.id,
    );

    expect(symlinkResult.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        durable: false,
      }),
    );
  }, 30_000);

  it("settles reported failure, deadline, and CAS-boundary cancellation", async () => {
    const failureFixture = await createRepository();
    await git(failureFixture.workspaceRoot, ["branch", "feature/uncertain"]);
    const failedManager = managerFor(
      failureFixture,
      directSandbox({ reportSwitchFailure: true }),
    );
    const failedPreview = await failedManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/uncertain",
    });
    const failed = await failedManager.apply(
      "thread_a",
      "run_a",
      failedPreview.id,
    );
    expect(failed.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        switchStatus: "failed",
        durable: false,
      }),
    );
    expect(
      (
        await gitOutput(failureFixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/uncertain");

    const deadlineFixture = await createRepository();
    await git(deadlineFixture.workspaceRoot, ["branch", "feature/deadline"]);
    const deadlineManager = managerFor(
      deadlineFixture,
      directSandbox({ stallSettlementAfterSwitch: true }),
    );
    const deadlinePreview = await deadlineManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/deadline",
    });
    const startedAt = Date.now();
    const deadline = await deadlineManager.apply(
      "thread_a",
      "run_a",
      deadlinePreview.id,
      1_000,
    );
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(deadline.details.status).toBe("indeterminate");

    const cancelFixture = await createRepository();
    await git(cancelFixture.workspaceRoot, ["branch", "feature/cancel"]);
    const controller = new AbortController();
    const cancelManager = managerFor(
      cancelFixture,
      directSandbox({ afterSwitchExit: () => controller.abort() }),
    );
    const cancelPreview = await cancelManager.preview("thread_a", "run_a", {
      targetBranchName: "feature/cancel",
    });
    const cancelled = await cancelManager.apply(
      "thread_a",
      "run_a",
      cancelPreview.id,
      10_000,
      controller.signal,
    );
    expect(cancelled.details.cancellationObserved).toBe(true);
    expect(["applied", "indeterminate"]).toContain(cancelled.details.status);
    expect(
      (
        await gitOutput(cancelFixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/cancel");
  }, 30_000);

  it("attaches detached HEAD and registers high-risk policy", async () => {
    const fixture = await createRepository();
    await git(fixture.workspaceRoot, ["branch", "feature/attach"]);
    const commit = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    await git(fixture.workspaceRoot, [
      "checkout",
      "--detach",
      "--quiet",
      commit,
    ]);
    const manager = managerFor(fixture, directSandbox());
    const preview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "feature/attach",
    });

    const result = await manager.apply("thread_a", "run_a", preview.id);

    expect(result.details.status).toBe("applied");
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/attach");
    expect(
      assessToolCall(
        "workspace",
        "git_branch_switch_preview",
        { targetBranchName: "feature/policy" },
        fixture.workspaceRoot,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "high" }));
    expect(
      assessToolCall(
        "workspace",
        "git_branch_switch_apply",
        { previewId: "gitswitchpreview_12345678" },
        fixture.workspaceRoot,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "high" }));
    expect(
      assessToolCall(
        "observe",
        "git_branch_switch_preview",
        { targetBranchName: "feature/policy" },
        fixture.workspaceRoot,
      ).allowed,
    ).toBe(false);
    expect(builtInToolEffect("git_branch_switch_preview")).toBe("write");
    expect(builtInToolEffect("git_branch_switch_apply")).toBe("write");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining([
        "git_branch_switch_preview",
        "git_branch_switch_apply",
      ]),
    );
    expect(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "git_branch_switch_preview",
        "git_branch_switch_apply",
      ]),
    );
  }, 30_000);
});

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

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-switch-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "before\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
  await git(workspaceRoot, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return { root, workspaceRoot };
}

async function createSiblingCommit(
  workspaceRoot: string,
  parent: string,
): Promise<string> {
  const tree = (
    await gitOutput(workspaceRoot, ["rev-parse", `${parent}^{tree}`])
  ).trim();
  return (
    await gitOutput(workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      "sibling",
    ])
  ).trim();
}

async function workspaceState(workspaceRoot: string) {
  return {
    currentBranch: (
      await gitOutput(workspaceRoot, ["symbolic-ref", "--short", "HEAD"])
    ).trim(),
    headCommit: (await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])).trim(),
    headFileSha256: await sha256File(path.join(workspaceRoot, ".git/HEAD")),
    headReflogSha256: await sha256File(
      path.join(workspaceRoot, ".git/logs/HEAD"),
    ),
    indexSha256: await sha256File(path.join(workspaceRoot, ".git/index")),
    worktreeSha256: await sha256File(path.join(workspaceRoot, "TRACKED.txt")),
    objects: await objectSet(workspaceRoot),
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
  ).stdout;
}

function directSandbox(
  options: {
    beforeSwitch?: () => Promise<void>;
    reportSwitchFailure?: boolean;
    stallSettlementAfterSwitch?: boolean;
    afterSwitchExit?: () => void;
    gitVersion?: string;
  } = {},
): OsSandboxAdapter & { launches: SandboxLaunchRequest[] } {
  const launches: SandboxLaunchRequest[] = [];
  let switchStarted = false;
  return {
    id: "direct-git-switch-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      const switchRequest =
        request.args.includes("update-ref") && request.args.includes("--stdin");
      if (switchRequest) {
        await options.beforeSwitch?.();
        switchStarted = true;
      }
      const stall =
        options.stallSettlementAfterSwitch &&
        switchStarted &&
        request.args.includes("rev-parse");
      const versionRequest =
        options.gitVersion !== undefined &&
        request.args.length === 1 &&
        request.args[0] === "--version";
      const child = spawn(
        stall
          ? "/bin/sleep"
          : versionRequest
            ? "/usr/bin/printf"
            : request.command,
        stall
          ? ["10"]
          : versionRequest
            ? ["%s\n", options.gitVersion!]
            : request.args,
        {
          cwd: request.cwd,
          env: {
            ...request.env,
            HOME: path.join(request.workspaceRoot, ".napier-test-home"),
            TMPDIR: request.workspaceRoot,
          },
          detached: true,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const process = childProcess(child);
      const observed =
        switchRequest && options.afterSwitchExit
          ? {
              ...process,
              exit: process.exit.then((result) => {
                options.afterSwitchExit?.();
                return result;
              }),
            }
          : process;
      if (switchRequest && options.reportSwitchFailure) {
        return {
          ...observed,
          exit: observed.exit.then(() => ({ code: 1, signal: null })),
        };
      }
      return observed;
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

async function objectSet(workspaceRoot: string): Promise<string[]> {
  const root = path.join(workspaceRoot, ".git/objects");
  const result: string[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory() || !/^[a-f0-9]{2}$/u.test(directory.name)) {
      continue;
    }
    for (const file of await readdir(path.join(root, directory.name))) {
      result.push(`${directory.name}${file}`);
    }
  }
  return result.sort();
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

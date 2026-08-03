import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { EXECUTION_PLAN_WORKFLOW_TOOL_NAMES } from "@napier/contracts";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { GIT_REVIEW_REFLOG_MESSAGE } from "../src/git-review-model.js";
import { GitReviewMutationManager } from "../src/git-review.js";
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

describe("preview-bound Git review promotion", () => {
  it("reviews and durably fast-forwards one target while preserving workspace state", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const sourceCommit = await commit(fixture.workspaceRoot, "HEAD");
    const targetCommit = await commit(fixture.workspaceRoot, "main");
    await writeFile(
      path.join(fixture.workspaceRoot, "DIRTY.txt"),
      "PRIVATE_DIRTY\n",
    );
    await git(fixture.workspaceRoot, ["add", "DIRTY.txt"]);
    await writeFile(
      path.join(fixture.workspaceRoot, "TRACKED.txt"),
      "reviewed\nPRIVATE_UNSTAGED\n",
    );
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const objectsBefore = await objectSet(fixture.workspaceRoot);
    const headBefore = await readFile(
      path.join(fixture.workspaceRoot, ".git/HEAD"),
    );
    const headReflogBefore = await readFile(
      path.join(fixture.workspaceRoot, ".git/logs/HEAD"),
    );
    const targetReflogPath = path.join(
      fixture.workspaceRoot,
      ".git/logs/refs/heads/main",
    );
    const targetReflogBefore = await readFile(targetReflogPath);

    const preview = await manager.preview("thread_review", "run_review", {
      targetBranchName: "main",
    });

    expect(preview).toEqual(
      expect.objectContaining({
        sourceBranchName: "feature/reviewed",
        targetBranchName: "main",
        patch: expect.stringContaining("+reviewed"),
        details: expect.objectContaining({
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          sourceCommitSha1: sourceCommit,
          targetCommitSha1: targetCommit,
          commitCount: 2,
          fileCount: 2,
          durable: false,
        }),
      }),
    );
    expect(await commit(fixture.workspaceRoot, "main")).toBe(targetCommit);
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);
    expect(await readFile(targetReflogPath)).toEqual(targetReflogBefore);

    const applied = await manager.apply(
      "thread_review",
      "run_review",
      preview.id,
    );

    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        sourceCommitSha1: sourceCommit,
        targetCommitSha1: targetCommit,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: true,
      }),
    );
    expect(await commit(fixture.workspaceRoot, "main")).toBe(sourceCommit);
    expect(await commit(fixture.workspaceRoot, "HEAD")).toBe(sourceCommit);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/reviewed");
    expect(
      await readFile(path.join(fixture.workspaceRoot, ".git/HEAD")),
    ).toEqual(headBefore);
    expect(
      await readFile(path.join(fixture.workspaceRoot, ".git/logs/HEAD")),
    ).toEqual(headReflogBefore);
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);
    const targetReflogAfter = await readFile(targetReflogPath, "utf8");
    expect(
      targetReflogAfter.slice(targetReflogBefore.length).split("\n"),
    ).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${targetCommit} ${sourceCommit} .+\\t${GIT_REVIEW_REFLOG_MESSAGE}$`,
          "u",
        ),
      ),
      "",
    ]);
    await expect(
      manager.apply("thread_review", "run_review", preview.id),
    ).rejects.toThrow("not found");

    const update = sandbox.launches.find(
      (request) =>
        request.args.includes("update-ref") &&
        request.args.includes("refs/heads/main"),
    );
    expect(update?.args).toEqual(
      expect.arrayContaining([
        "update-ref",
        "--no-deref",
        "-m",
        GIT_REVIEW_REFLOG_MESSAGE,
        "refs/heads/main",
        sourceCommit,
        targetCommit,
      ]),
    );
    expect(update?.workspaceWritePaths).toEqual([
      path.join(update!.workspaceRoot, ".git/refs/heads"),
      path.join(update!.workspaceRoot, ".git/logs"),
    ]);
  }, 30_000);

  it("rejects detached, missing, equal, non-ancestor, binary, and stale reviews", async () => {
    const fixture = await createRepository();
    const manager = managerFor(fixture, directSandbox());
    await expect(
      manager.preview("thread_a", "run_a", {
        targetBranchName: "feature/reviewed",
      }),
    ).rejects.toThrow("differ");
    await expect(
      manager.preview("thread_a", "run_a", { targetBranchName: "missing" }),
    ).rejects.toThrow();

    const sourceCommit = await commit(fixture.workspaceRoot, "HEAD");
    await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
    await writeFile(
      path.join(fixture.workspaceRoot, "MAIN_ONLY.txt"),
      "main\n",
    );
    await git(fixture.workspaceRoot, ["add", "MAIN_ONLY.txt"]);
    await commitFixture(fixture.workspaceRoot, "main diverged");
    await git(fixture.workspaceRoot, [
      "checkout",
      "--quiet",
      "feature/reviewed",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", { targetBranchName: "main" }),
    ).rejects.toThrow("not a source ancestor");
    await git(fixture.workspaceRoot, [
      "update-ref",
      "refs/heads/main",
      `${sourceCommit}^`,
    ]);

    await writeFile(
      path.join(fixture.workspaceRoot, "BINARY.bin"),
      Buffer.from([0, 1, 2, 3]),
    );
    await git(fixture.workspaceRoot, ["add", "BINARY.bin"]);
    await commitFixture(fixture.workspaceRoot, "binary");
    await expect(
      manager.preview("thread_a", "run_a", { targetBranchName: "main" }),
    ).rejects.toThrow();

    await git(fixture.workspaceRoot, [
      "reset",
      "--hard",
      "--quiet",
      sourceCommit,
    ]);
    const preview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "main",
    });
    await writeFile(path.join(fixture.workspaceRoot, "INDEX.txt"), "index\n");
    await git(fixture.workspaceRoot, ["add", "INDEX.txt"]);
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("stale");

    await git(fixture.workspaceRoot, [
      "reset",
      "--hard",
      "--quiet",
      sourceCommit,
    ]);
    const linkedWorktree = path.join(fixture.root, "linked-worktree");
    await git(fixture.workspaceRoot, [
      "worktree",
      "add",
      "--quiet",
      linkedWorktree,
      "main",
    ]);
    await expect(
      manager.preview("thread_linked", "run_linked", {
        targetBranchName: "main",
      }),
    ).rejects.toThrow("linked worktrees are unsupported");
    await git(fixture.workspaceRoot, [
      "worktree",
      "remove",
      "--force",
      linkedWorktree,
    ]);
    const detachedPreview = await manager.preview("thread_b", "run_b", {
      targetBranchName: "main",
    });
    expect(detachedPreview.details.status).toBe("ready");
    await git(fixture.workspaceRoot, ["checkout", "--detach", "--quiet"]);
    await expect(
      manager.preview("thread_b", "run_c", { targetBranchName: "main" }),
    ).rejects.toThrow("attached local source");
  }, 30_000);

  it("fails closed on target CAS loss and extra reflog appends", async () => {
    const fixture = await createRepository();
    const oldTarget = await commit(fixture.workspaceRoot, "main");
    const source = await commit(fixture.workspaceRoot, "HEAD");
    await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
    await writeFile(path.join(fixture.workspaceRoot, "RACE.txt"), "race\n");
    await git(fixture.workspaceRoot, ["add", "RACE.txt"]);
    await commitFixture(fixture.workspaceRoot, "racing target");
    const racingTarget = await commit(fixture.workspaceRoot, "HEAD");
    await git(fixture.workspaceRoot, ["reset", "--hard", "--quiet", oldTarget]);
    await git(fixture.workspaceRoot, [
      "checkout",
      "--quiet",
      "feature/reviewed",
    ]);
    const raceSandbox = directSandbox({
      beforeUpdate: async () => {
        await git(fixture.workspaceRoot, [
          "update-ref",
          "refs/heads/main",
          racingTarget,
          oldTarget,
        ]);
      },
    });
    const raceManager = managerFor(fixture, raceSandbox);
    const racePreview = await raceManager.preview("thread_a", "run_a", {
      targetBranchName: "main",
    });
    const raceResult = await raceManager.apply(
      "thread_a",
      "run_a",
      racePreview.id,
    );
    expect(raceResult.details.status).toBe("indeterminate");
    expect(await commit(fixture.workspaceRoot, "main")).toBe(racingTarget);
    expect(await commit(fixture.workspaceRoot, "HEAD")).toBe(source);
    await git(fixture.workspaceRoot, [
      "update-ref",
      "refs/heads/main",
      oldTarget,
      racingTarget,
    ]);

    await git(fixture.workspaceRoot, ["branch", "victim", "main"]);
    const symbolicManager = managerFor(
      fixture,
      directSandbox({
        beforeUpdate: async () => {
          await git(fixture.workspaceRoot, [
            "symbolic-ref",
            "refs/heads/main",
            "refs/heads/victim",
          ]);
        },
      }),
    );
    const symbolicPreview = await symbolicManager.preview(
      "thread_symbolic_race",
      "run_symbolic_race",
      { targetBranchName: "main" },
    );
    const symbolicResult = await symbolicManager.apply(
      "thread_symbolic_race",
      "run_symbolic_race",
      symbolicPreview.id,
    );
    expect(symbolicResult.details.status).toBe("indeterminate");
    expect(await commit(fixture.workspaceRoot, "victim")).toBe(oldTarget);
    expect(await commit(fixture.workspaceRoot, "main")).toBe(source);
    await expect(
      gitOutput(fixture.workspaceRoot, ["symbolic-ref", "refs/heads/main"]),
    ).rejects.toThrow();
    await git(fixture.workspaceRoot, [
      "update-ref",
      "--no-deref",
      "refs/heads/main",
      oldTarget,
    ]);

    const reflogManager = managerFor(
      fixture,
      directSandbox({
        beforeUpdate: async () => {
          await appendFile(
            path.join(fixture.workspaceRoot, ".git/logs/refs/heads/main"),
            `${oldTarget} ${oldTarget} Napier <napier@example.invalid> 0 +0000\\textra\n`,
          );
        },
      }),
    );
    const reflogPreview = await reflogManager.preview("thread_b", "run_b", {
      targetBranchName: "main",
    });
    const reflogResult = await reflogManager.apply(
      "thread_b",
      "run_b",
      reflogPreview.id,
    );
    expect(reflogResult.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        refUpdateStatus: "succeeded",
        durable: false,
      }),
    );
    expect(await commit(fixture.workspaceRoot, "main")).toBe(source);
  }, 30_000);

  it("reviews every linear commit while rejecting symbolic refs and merge ranges", async () => {
    const fixture = await createRepository();
    const manager = managerFor(fixture, directSandbox());
    const hidden = path.join(fixture.workspaceRoot, "HIDDEN.txt");
    await writeFile(hidden, "PRIVATE_INTERMEDIATE_HISTORY\n");
    await git(fixture.workspaceRoot, ["add", "HIDDEN.txt"]);
    await commitFixture(fixture.workspaceRoot, "intermediate add");
    await rm(hidden);
    await git(fixture.workspaceRoot, ["add", "HIDDEN.txt"]);
    await commitFixture(fixture.workspaceRoot, "intermediate delete");
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "reviewed empty metadata commit",
    ]);

    const preview = await manager.preview("thread_linear", "run_linear", {
      targetBranchName: "main",
    });

    expect(preview.details.commitCount).toBe(5);
    expect(preview.patch).toContain("+PRIVATE_INTERMEDIATE_HISTORY");
    expect(preview.patch).toContain("-PRIVATE_INTERMEDIATE_HISTORY");
    expect(preview.patch).toContain("(no tree delta)");
    expect(preview.patch.match(/^commit [a-f0-9]{40}$/gmu)).toHaveLength(5);

    await git(fixture.workspaceRoot, [
      "symbolic-ref",
      "refs/heads/symbolic-target",
      "refs/heads/main",
    ]);
    await copyFile(
      path.join(fixture.workspaceRoot, ".git/logs/refs/heads/main"),
      path.join(fixture.workspaceRoot, ".git/logs/refs/heads/symbolic-target"),
    );
    await expect(
      manager.preview("thread_symbolic", "run_symbolic", {
        targetBranchName: "symbolic-target",
      }),
    ).rejects.toThrow("direct local branch refs");

    const mergeFixture = await createRepository();
    await git(mergeFixture.workspaceRoot, [
      "checkout",
      "--quiet",
      "-b",
      "side",
    ]);
    await writeFile(
      path.join(mergeFixture.workspaceRoot, "SIDE.txt"),
      "side\n",
    );
    await git(mergeFixture.workspaceRoot, ["add", "SIDE.txt"]);
    await commitFixture(mergeFixture.workspaceRoot, "side");
    await git(mergeFixture.workspaceRoot, [
      "checkout",
      "--quiet",
      "feature/reviewed",
    ]);
    await writeFile(
      path.join(mergeFixture.workspaceRoot, "MAINLINE.txt"),
      "mainline\n",
    );
    await git(mergeFixture.workspaceRoot, ["add", "MAINLINE.txt"]);
    await commitFixture(mergeFixture.workspaceRoot, "mainline");
    await git(mergeFixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "merge",
      "--quiet",
      "--no-ff",
      "-m",
      "merge side",
      "side",
    ]);
    await expect(
      managerFor(mergeFixture, directSandbox()).preview(
        "thread_merge",
        "run_merge",
        { targetBranchName: "main" },
      ),
    ).rejects.toThrow("linear non-merge");
  }, 30_000);

  it("settles reported ref failure and exposes controlled policy effects", async () => {
    const fixture = await createRepository();
    const manager = managerFor(
      fixture,
      directSandbox({ reportUpdateFailure: true }),
    );
    const preview = await manager.preview("thread_a", "run_a", {
      targetBranchName: "main",
    });

    const result = await manager.apply("thread_a", "run_a", preview.id);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        refUpdateStatus: "failed",
        durable: false,
      }),
    );
    expect(await commit(fixture.workspaceRoot, "main")).toBe(
      preview.details.sourceCommitSha1,
    );
    expect(
      assessToolCall(
        "workspace",
        "git_review_preview",
        { targetBranchName: "main" },
        fixture.workspaceRoot,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "medium" }));
    expect(
      assessToolCall(
        "workspace",
        "git_review_apply",
        { previewId: "gitreviewpreview_12345678" },
        fixture.workspaceRoot,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "high" }));
    expect(
      assessToolCall(
        "observe",
        "git_review_preview",
        { targetBranchName: "main" },
        fixture.workspaceRoot,
      ).allowed,
    ).toBe(false);
    expect(builtInToolEffect("git_review_preview")).toBe("read");
    expect(builtInToolEffect("git_review_apply")).toBe("write");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining(["git_review_preview", "git_review_apply"]),
    );
    expect(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES).toEqual(
      expect.arrayContaining(["git_review_preview", "git_review_apply"]),
    );
  }, 30_000);

  it("waits for sibling Git inspections before returning one parallel failure", async () => {
    const fixture = await createRepository();
    const manager = managerFor(
      fixture,
      directSandbox({ failRawAndDelayPatch: true }),
    );
    const startedAt = Date.now();

    await expect(
      manager.preview("thread_settle", "run_settle", {
        targetBranchName: "main",
      }),
    ).rejects.toThrow("injected raw failure");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  }, 10_000);
});

function managerFor(
  fixture: { root: string; workspaceRoot: string },
  sandbox: OsSandboxAdapter,
): GitReviewMutationManager {
  return new GitReviewMutationManager({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: path.join(fixture.root, "data"),
    sandbox,
    now: () => new Date("2026-08-03T00:00:00.000Z"),
  });
}

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-review-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "before\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
  await commitFixture(workspaceRoot, "baseline");
  await git(workspaceRoot, ["checkout", "--quiet", "-b", "feature/reviewed"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "reviewed\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
  await commitFixture(workspaceRoot, "reviewed one");
  await writeFile(path.join(workspaceRoot, "ADDED.txt"), "added\n");
  await git(workspaceRoot, ["add", "ADDED.txt"]);
  await commitFixture(workspaceRoot, "reviewed two");
  return { root, workspaceRoot };
}

async function commitFixture(cwd: string, message: string): Promise<void> {
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

async function commit(cwd: string, revision: string): Promise<string> {
  return (await gitOutput(cwd, ["rev-parse", `${revision}^{commit}`])).trim();
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
    reportUpdateFailure?: boolean;
    beforeUpdate?: () => Promise<void>;
    failRawAndDelayPatch?: boolean;
  } = {},
): OsSandboxAdapter & { launches: SandboxLaunchRequest[] } {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-review-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      if (options.failRawAndDelayPatch && request.args.includes("--raw")) {
        throw new Error("injected raw failure");
      }
      const isPromotion =
        request.args.includes("update-ref") &&
        request.args.includes(GIT_REVIEW_REFLOG_MESSAGE);
      if (isPromotion) await options.beforeUpdate?.();
      const delayPatch =
        options.failRawAndDelayPatch && request.args.includes("--patch");
      const child = spawn(
        delayPatch ? "/bin/sleep" : request.command,
        delayPatch ? ["0.2"] : request.args,
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
      if (isPromotion && options.reportUpdateFailure) {
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

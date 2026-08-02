import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { EXECUTION_PLAN_WORKFLOW_TOOL_NAMES } from "@napier/contracts";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { GitCommitMutationManager } from "../src/git-commit.js";
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

describe("preview-bound atomic Git commit", () => {
  it("constructs privately then atomically commits the exact staged index", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_AFTER\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_NEW.txt"),
      "PRIVATE_NEW\n",
    );
    await git(fixture.workspaceRoot, [
      "add",
      "PRIVATE_TRACKED.txt",
      "PRIVATE_NEW.txt",
    ]);
    const headBefore = await gitOutput(fixture.workspaceRoot, [
      "rev-parse",
      "HEAD",
    ]);
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const objectsBefore = await objectSet(fixture.workspaceRoot);

    const preview = await manager.preview("thread_private", "run_private", {
      message: "feat(core): commit reviewed files\r\n\r\nBound body",
      contextLines: 0,
    });

    expect(preview.branchRef).toBe("refs/heads/main");
    expect(preview.message).toBe(
      "feat(core): commit reviewed files\n\nBound body\n",
    );
    expect(preview.stagedPatch).toContain("+PRIVATE_AFTER");
    expect(preview.stagedPatch).toContain("+PRIVATE_NEW");
    expect(preview.details).toEqual(
      expect.objectContaining({
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        fileCount: 2,
        parentCommitSha1: headBefore.trim(),
        proposedCommitSha1: expect.stringMatching(/^[a-f0-9]{40}$/u),
        commitTimestampSeconds: 1_767_225_600,
        durable: false,
      }),
    );
    expect(await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])).toBe(
      headBefore,
    );
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([]);
    const hookMarker = path.join(fixture.workspaceRoot, "PRIVATE_HOOK_RAN");
    const hookPath = path.join(
      fixture.workspaceRoot,
      ".git/hooks/reference-transaction",
    );
    await writeFile(
      hookPath,
      "#!/bin/sh\nprintf hook-ran > PRIVATE_HOOK_RAN\nexit 1\n",
    );
    await chmod(hookPath, 0o700);

    const applied = await manager.apply(
      "thread_private",
      "run_private",
      preview.id,
    );

    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        proposedCommitSha1: preview.details.proposedCommitSha1,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: true,
      }),
    );
    expect(
      (await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])).trim(),
    ).toBe(preview.details.proposedCommitSha1);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, ["log", "-1", "--format=%B"])
      ).trimEnd(),
    ).toBe(preview.message.trimEnd());
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "log",
        "-1",
        "--format=%an <%ae> %at",
      ]),
    ).toBe("Napier Agent <napier@localhost> 1767225600\n");
    expect(
      await gitOutput(fixture.workspaceRoot, ["diff", "--cached", "HEAD"]),
    ).toBe("");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    await expect(
      manager.apply("thread_private", "run_private", preview.id),
    ).rejects.toThrow("not found");
    await expect(readFile(hookMarker, "utf8")).rejects.toThrow();

    const update = sandbox.launches.find((request) =>
      request.args.includes("update-ref"),
    );
    expect(update?.workspaceWritePaths).toEqual([
      path.join(update!.workspaceRoot, ".git/refs/heads"),
      path.join(update!.workspaceRoot, ".git/logs"),
    ]);
    expect(update?.args).toEqual(
      expect.arrayContaining([
        "core.hooksPath=/dev/null",
        "update-ref",
        "refs/heads/main",
        preview.details.proposedCommitSha1,
        headBefore.trim(),
      ]),
    );
    for (const launch of sandbox.launches.filter((request) =>
      request.args.includes("commit-tree"),
    )) {
      expect(launch.workspaceWritePaths?.[0]).toMatch(
        /\/\.git\/napier-stage\/commit-/u,
      );
      expect(launch.args.join("\n")).not.toContain(preview.message);
    }
  }, 30_000);

  it("rejects empty, stale, detached, active-operation, and unsafe previews", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    await expect(
      manager.preview("thread_a", "run_a", { message: "empty" }),
    ).rejects.toThrow("non-empty staged patch");
    const gitlinkTarget = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    await git(fixture.workspaceRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${gitlinkTarget},PRIVATE_SUBMODULE`,
    ]);
    await expect(
      manager.preview("thread_a", "run_a", { message: "feat: gitlink" }),
    ).rejects.toThrow("unsupported staged entries");
    await git(fixture.workspaceRoot, [
      "reset",
      "--quiet",
      "HEAD",
      "--",
      "PRIVATE_SUBMODULE",
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_AFTER\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    const preview = await manager.preview("thread_a", "run_a", {
      message: "feat: stale commit",
    });
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_SECOND.txt"),
      "PRIVATE_SECOND\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_SECOND.txt"]);
    const headBefore = await gitOutput(fixture.workspaceRoot, [
      "rev-parse",
      "HEAD",
    ]);
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("stale");
    expect(await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])).toBe(
      headBefore,
    );

    await git(fixture.workspaceRoot, [
      "config",
      "core.sharedRepository",
      "group",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", { message: "feat: unsafe" }),
    ).rejects.toThrow("unsafe execution configuration");
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "core.sharedRepository",
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, ".git/MERGE_HEAD"),
      headBefore.trim(),
    );
    await expect(
      manager.preview("thread_a", "run_a", { message: "feat: merge" }),
    ).rejects.toThrow("another Git operation");
    await unlink(path.join(fixture.workspaceRoot, ".git/MERGE_HEAD"));
    await git(fixture.workspaceRoot, ["checkout", "--detach", "--quiet"]);
    await expect(
      manager.preview("thread_a", "run_a", { message: "feat: detached" }),
    ).rejects.toThrow("attached local branch");
    await expect(
      manager.preview("thread_a", "run_a", { message: "\u0000private" }),
    ).rejects.toThrow("message is invalid");
  }, 30_000);

  it("settles a completed ref write reported as failed as indeterminate", async () => {
    const fixture = await createRepository();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_AFTER\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    const sandbox = directSandbox({ reportUpdateFailure: true });
    const manager = managerFor(fixture, sandbox);
    const preview = await manager.preview("thread_a", "run_a", {
      message: "feat: uncertain update",
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
    expect(
      (await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])).trim(),
    ).toBe(preview.details.proposedCommitSha1);
  }, 30_000);

  it("updates only the previewed branch when HEAD switches before ref CAS", async () => {
    const fixture = await createRepository();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_AFTER\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    await git(fixture.workspaceRoot, ["branch", "other"]);
    const parent = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const sandbox = directSandbox({
      beforeUpdate: async () => {
        await git(fixture.workspaceRoot, [
          "symbolic-ref",
          "HEAD",
          "refs/heads/other",
        ]);
      },
    });
    const manager = managerFor(fixture, sandbox);
    const preview = await manager.preview("thread_a", "run_a", {
      message: "feat: exact branch CAS",
    });

    const result = await manager.apply("thread_a", "run_a", preview.id);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        refUpdateStatus: "succeeded",
        durable: false,
      }),
    );
    expect(
      (await gitOutput(fixture.workspaceRoot, ["rev-parse", "main"])).trim(),
    ).toBe(preview.details.proposedCommitSha1);
    expect(
      (await gitOutput(fixture.workspaceRoot, ["rev-parse", "other"])).trim(),
    ).toBe(parent);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "reflog",
          "show",
          "--format=%H",
          "-1",
          "main",
        ])
      ).trim(),
    ).toBe(preview.details.proposedCommitSha1);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("other");
  }, 30_000);

  it("requires non-observe policy and marks ref application high risk", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "workspace",
        "git_commit_preview",
        { message: "feat: preview" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "private-object Git commit preview",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "git_commit_apply",
        { previewId: "gitcommitpreview_12345678" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
        reason: "fresh preview-bound atomic Git ref update",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "git_commit_preview",
        { message: "feat: preview" },
        workspace,
      ).allowed,
    ).toBe(false);
    expect(builtInToolEffect("git_commit_preview")).toBe("read");
    expect(builtInToolEffect("git_commit_apply")).toBe("write");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining(["git_commit_preview", "git_commit_apply"]),
    );
    expect(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES).toEqual(
      expect.arrayContaining(["git_commit_preview", "git_commit_apply"]),
    );
  });
});

function managerFor(
  fixture: { root: string; workspaceRoot: string },
  sandbox: OsSandboxAdapter,
): GitCommitMutationManager {
  return new GitCommitMutationManager({
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-commit-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_BEFORE\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
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
  } = {},
): OsSandboxAdapter & { launches: SandboxLaunchRequest[] } {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-commit-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      if (request.args.includes("update-ref")) {
        await options.beforeUpdate?.();
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
      if (options.reportUpdateFailure && request.args.includes("update-ref")) {
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

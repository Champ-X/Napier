import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
import { GitBranchMutationManager } from "../src/git-branch.js";
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

describe("preview-bound Git branch creation", () => {
  it("creates one durable branch at exact HEAD without switching workspace state", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const headBefore = await gitOutput(fixture.workspaceRoot, [
      "rev-parse",
      "HEAD",
    ]);
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const objectsBefore = await objectSet(fixture.workspaceRoot);
    const headReflogBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/logs/HEAD"),
    );

    const preview = await manager.preview("thread_a", "run_a", {
      branchName: "feature/reviewed",
    });

    expect(preview).toEqual(
      expect.objectContaining({
        branchName: "feature/reviewed",
        details: expect.objectContaining({
          operation: "create",
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          targetCommitSha1: headBefore.trim(),
          durable: false,
        }),
      }),
    );
    await expect(
      gitOutput(fixture.workspaceRoot, [
        "show-ref",
        "--verify",
        "refs/heads/feature/reviewed",
      ]),
    ).rejects.toThrow();
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);
    await expect(
      manager.apply("thread_a", "run_other", preview.id),
    ).rejects.toThrow("not found");

    const applied = await manager.apply("thread_a", "run_a", preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        targetCommitSha1: headBefore.trim(),
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: true,
      }),
    );
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "rev-parse",
          "refs/heads/feature/reviewed",
        ])
      ).trim(),
    ).toBe(headBefore.trim());
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("main");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/logs/HEAD")),
    ).toBe(headReflogBefore);
    const branchReflog = await readFile(
      path.join(fixture.workspaceRoot, ".git/logs/refs/heads/feature/reviewed"),
      "utf8",
    );
    expect(branchReflog.trimEnd().split("\n").at(-1)).toMatch(
      new RegExp(`^${"0".repeat(40)} ${headBefore.trim()} `, "u"),
    );
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("not found");

    const update = sandbox.launches.find((request) =>
      request.args.includes("update-ref"),
    );
    expect(update?.args).toEqual(
      expect.arrayContaining([
        "core.hooksPath=/dev/null",
        "update-ref",
        "refs/heads/feature/reviewed",
        headBefore.trim(),
        "0".repeat(40),
      ]),
    );
    expect(update?.workspaceWritePaths).toEqual([
      path.join(update!.workspaceRoot, ".git/refs/heads"),
      path.join(update!.workspaceRoot, ".git/logs"),
    ]);
  }, 30_000);

  it("rejects invalid, existing, stale, unsafe, and symlinked branch state", async () => {
    const fixture = await createRepository();
    const manager = managerFor(fixture, directSandbox());
    for (const branchName of [
      "../escape",
      "feature//bad",
      "feature/../bad",
      ".hidden",
      "bad.lock",
      "bad name",
      "bad@name",
    ]) {
      await expect(
        manager.preview("thread_a", "run_a", { branchName }),
      ).rejects.toThrow("name is invalid");
    }
    await expect(
      manager.preview("thread_a", "run_a", { branchName: "main" }),
    ).rejects.toThrow("already exists");
    await git(fixture.workspaceRoot, ["branch", "packed"]);
    await git(fixture.workspaceRoot, ["pack-refs", "--all", "--prune"]);
    await expect(
      manager.preview("thread_a", "run_a", { branchName: "packed" }),
    ).rejects.toThrow("already exists");

    const preview = await manager.preview("thread_a", "run_a", {
      branchName: "feature/stale",
    });
    await writeFile(path.join(fixture.workspaceRoot, "STALE.txt"), "stale\n");
    await git(fixture.workspaceRoot, ["add", "STALE.txt"]);
    await expect(
      manager.apply("thread_a", "run_a", preview.id),
    ).rejects.toThrow("preview is stale");
    await expect(
      gitOutput(fixture.workspaceRoot, [
        "show-ref",
        "--verify",
        "refs/heads/feature/stale",
      ]),
    ).rejects.toThrow();

    await git(fixture.workspaceRoot, [
      "config",
      "core.sharedRepository",
      "group",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", {
        branchName: "feature/unsafe",
      }),
    ).rejects.toThrow("unsafe execution configuration");
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "core.sharedRepository",
    ]);
    const external = path.join(fixture.root, "external");
    await mkdir(external);
    const alternates = path.join(
      fixture.workspaceRoot,
      ".git/objects/info/alternates",
    );
    await writeFile(alternates, `${external}\n`);
    await expect(
      manager.preview("thread_a", "run_a", {
        branchName: "feature/alternates",
      }),
    ).rejects.toThrow("alternates are unsupported");
    await rm(alternates);
    await symlink(
      external,
      path.join(fixture.workspaceRoot, ".git/refs/heads/symlinked"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        branchName: "symlinked/escape",
      }),
    ).rejects.toThrow("ancestor is not canonical");
  }, 30_000);

  it("keeps the exact target but reports a concurrent HEAD switch as indeterminate", async () => {
    const fixture = await createRepository();
    await git(fixture.workspaceRoot, ["branch", "other"]);
    const target = (
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
      branchName: "feature/race",
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
      (
        await gitOutput(fixture.workspaceRoot, [
          "rev-parse",
          "refs/heads/feature/race",
        ])
      ).trim(),
    ).toBe(target);
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

  it("settles a created ref reported as failed and registers high-risk policy", async () => {
    const fixture = await createRepository();
    const manager = managerFor(
      fixture,
      directSandbox({ reportUpdateFailure: true }),
    );
    const preview = await manager.preview("thread_a", "run_a", {
      branchName: "feature/uncertain",
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
      assessToolCall(
        "workspace",
        "git_branch_create_preview",
        { branchName: "feature/policy" },
        fixture.workspaceRoot,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "git_branch_create_apply",
        { previewId: "gitbranchpreview_12345678" },
        fixture.workspaceRoot,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "git_branch_create_preview",
        { branchName: "feature/policy" },
        fixture.workspaceRoot,
      ).allowed,
    ).toBe(false);
    expect(builtInToolEffect("git_branch_create_preview")).toBe("read");
    expect(builtInToolEffect("git_branch_create_apply")).toBe("write");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining([
        "git_branch_create_preview",
        "git_branch_create_apply",
      ]),
    );
    expect(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "git_branch_create_preview",
        "git_branch_create_apply",
      ]),
    );
  }, 30_000);

  it("bounds post-CAS settlement by the remaining apply deadline", async () => {
    const fixture = await createRepository();
    const manager = managerFor(
      fixture,
      directSandbox({ stallSettlementAfterUpdate: true }),
    );
    const preview = await manager.preview("thread_a", "run_a", {
      branchName: "feature/bounded-settlement",
    });
    const startedAt = Date.now();

    const result = await manager.apply("thread_a", "run_a", preview.id, 1_000);

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        refUpdateStatus: "succeeded",
        durable: false,
      }),
    );
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "rev-parse",
          "refs/heads/feature/bounded-settlement",
        ])
      ).trim(),
    ).toBe(preview.details.targetCommitSha1);
  }, 10_000);

  it("settles a completed ref after cancellation arrives at the CAS boundary", async () => {
    const fixture = await createRepository();
    const controller = new AbortController();
    const manager = managerFor(
      fixture,
      directSandbox({
        afterUpdateExit: () => controller.abort(),
      }),
    );
    const preview = await manager.preview("thread_a", "run_a", {
      branchName: "feature/cancelled-settlement",
    });

    const result = await manager.apply(
      "thread_a",
      "run_a",
      preview.id,
      10_000,
      controller.signal,
    );

    expect(result.details.cancellationObserved).toBe(true);
    expect(["applied", "indeterminate"]).toContain(result.details.status);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "rev-parse",
          "refs/heads/feature/cancelled-settlement",
        ])
      ).trim(),
    ).toBe(preview.details.targetCommitSha1);
  }, 10_000);
});

function managerFor(
  fixture: { root: string; workspaceRoot: string },
  sandbox: OsSandboxAdapter,
): GitBranchMutationManager {
  return new GitBranchMutationManager({
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-branch-"));
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
    stallSettlementAfterUpdate?: boolean;
    afterUpdateExit?: () => void;
  } = {},
): OsSandboxAdapter & { launches: SandboxLaunchRequest[] } {
  const launches: SandboxLaunchRequest[] = [];
  let updateStarted = false;
  return {
    id: "direct-git-branch-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
      if (request.args.includes("update-ref")) {
        await options.beforeUpdate?.();
        updateStarted = true;
      }
      const stall =
        options.stallSettlementAfterUpdate &&
        updateStarted &&
        request.args.includes("rev-parse");
      const child = spawn(
        stall ? "/bin/sleep" : request.command,
        stall ? ["10"] : request.args,
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
      const observedProcess =
        request.args.includes("update-ref") && options.afterUpdateExit
          ? {
              ...process,
              exit: process.exit.then((result) => {
                options.afterUpdateExit?.();
                return result;
              }),
            }
          : process;
      if (options.reportUpdateFailure && request.args.includes("update-ref")) {
        return {
          ...observedProcess,
          exit: observedProcess.exit.then(() => ({
            code: 1,
            signal: null,
          })),
        };
      }
      return observedProcess;
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

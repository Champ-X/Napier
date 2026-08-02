import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
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
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  createGitInspectTool,
  gitInspectToolCallArgumentsLedgerProjection,
  gitInspectToolOutputLedgerProjection,
} from "../src/git-inspect-tool.js";
import { GitInspectRunner } from "../src/git-inspect.js";
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

describe("git_inspect", () => {
  it("returns bounded status and working/staged hunks without changing Git metadata", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const tool = createGitInspectTool({
      workspaceRoot: fixture.workspaceRoot,
      sandbox,
    });
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_AFTER\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_UNTRACKED.txt"),
      "PRIVATE_UNTRACKED_BODY\n",
    );
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );

    const status = await tool.execute("git-status", { action: "status" });
    const working = await tool.execute("git-working", {
      action: "diff",
      scope: "working",
      path: "PRIVATE_TRACKED.txt",
      contextLines: 0,
    });

    expect(status.content[0]?.text).toContain("PRIVATE_TRACKED.txt");
    expect(status.content[0]?.text).toContain("PRIVATE_UNTRACKED.txt");
    expect(status.details).toEqual(
      expect.objectContaining({
        kind: "napier.git-inspection",
        schemaVersion: 1,
        action: "status",
        statusEntryCount: 2,
        fileCount: 0,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(working.content[0]?.text).toContain("-PRIVATE_BEFORE");
    expect(working.content[0]?.text).toContain("+PRIVATE_AFTER");
    expect(working.details).toEqual(
      expect.objectContaining({
        action: "diff",
        scope: "working",
        contextLines: 0,
        fileCount: 1,
        hunkCount: 1,
        addedLineCount: 1,
        deletedLineCount: 1,
      }),
    );
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    const literalPathspec = await tool.execute("git-literal-pathspec", {
      action: "diff",
      scope: "working",
      path: ":(glob)*.txt",
    });
    expect(literalPathspec.content[0]?.text).not.toContain("PRIVATE_AFTER");
    expect(literalPathspec.details.fileCount).toBe(0);

    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    const staged = await tool.execute("git-staged", {
      action: "diff",
      scope: "staged",
      path: "PRIVATE_TRACKED.txt",
    });
    expect(staged.content[0]?.text).toContain("GIT STAGED DIFF");
    expect(staged.content[0]?.text).toContain("+PRIVATE_AFTER");
    expect(staged.details).toEqual(
      expect.objectContaining({
        scope: "staged",
        fileCount: 1,
        hunkCount: 1,
      }),
    );

    for (const request of sandbox.launches) {
      expect(request).toEqual(
        expect.objectContaining({
          command: "/usr/bin/git",
          approvedCapabilities: ["process.spawn", "workspace.read"],
        }),
      );
      expect(request.args).toEqual(
        expect.arrayContaining([
          "--no-pager",
          "--no-optional-locks",
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
        ]),
      );
      expect(request.args.join("\n")).not.toContain("PRIVATE_AFTER");
      expect(request.env).toEqual(
        expect.objectContaining({
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_LITERAL_PATHSPECS: "1",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
        }),
      );
    }

    const call = gitInspectToolCallArgumentsLedgerProjection({
      action: "diff",
      scope: "working",
      path: "PRIVATE_TRACKED.txt",
      contextLines: 0,
    });
    const output = gitInspectToolOutputLedgerProjection(
      working.content[0]?.text ?? "",
      { details: working.details },
    );
    const durable = JSON.stringify({ call, output });
    for (const privateValue of [
      "PRIVATE_TRACKED",
      "PRIVATE_BEFORE",
      "PRIVATE_AFTER",
      "GIT WORKING DIFF",
    ]) {
      expect(durable).not.toContain(privateValue);
    }
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.git-inspection",
          action: "diff",
          fileCount: 1,
        }),
      }),
    );
  }, 30_000);

  it("rejects unsupported metadata boundaries, protected paths, and drift", async () => {
    const noRepository = await temporaryRoot("napier-git-none-");
    const sandbox = directSandbox();
    await expect(
      new GitInspectRunner({
        workspaceRoot: noRepository,
        sandbox,
      }).inspect({ action: "status" }),
    ).rejects.toThrow("not a supported Git repository");

    const external = await temporaryRoot("napier-git-external-");
    await mkdir(path.join(external, "objects"));
    const symlinkRoot = await temporaryRoot("napier-git-symlink-");
    await symlink(external, path.join(symlinkRoot, ".git"));
    await expect(
      new GitInspectRunner({
        workspaceRoot: symlinkRoot,
        sandbox,
      }).inspect({ action: "status" }),
    ).rejects.toThrow("not a supported Git repository");

    const gitFileRoot = await temporaryRoot("napier-git-file-");
    await writeFile(path.join(gitFileRoot, ".git"), `gitdir: ${external}\n`);
    await expect(
      new GitInspectRunner({
        workspaceRoot: gitFileRoot,
        sandbox,
      }).inspect({ action: "status" }),
    ).rejects.toThrow("not a supported Git repository");

    const fixture = await createRepository();
    const runner = new GitInspectRunner({
      workspaceRoot: fixture.workspaceRoot,
      sandbox,
    });
    await expect(
      runner.inspect({
        action: "diff",
        scope: "working",
        path: "../PRIVATE_OUTSIDE.txt",
      }),
    ).rejects.toThrow("path escapes the workspace");
    await expect(
      runner.inspect({
        action: "diff",
        scope: "working",
        path: ".git/config",
      }),
    ).rejects.toThrow("path escapes the workspace");

    await writeFile(path.join(fixture.workspaceRoot, ".git/index.lock"), "");
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "active index lock",
    );
    await rm(path.join(fixture.workspaceRoot, ".git/index.lock"));

    await git(fixture.workspaceRoot, [
      "config",
      "filter.leak.clean",
      "/usr/bin/git show HEAD:PRIVATE_TRACKED.txt",
    ]);
    await expect(
      runner.inspect({
        action: "diff",
        scope: "working",
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("unsafe execution configuration");
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "filter.leak.clean",
    ]);
    await git(fixture.workspaceRoot, [
      "config",
      "include.path",
      "../PRIVATE_CONFIG",
    ]);
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "unsafe execution configuration",
    );
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "include.path",
    ]);
    await git(fixture.workspaceRoot, [
      "config",
      "extensions.worktreeConfig",
      "true",
    ]);
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "unsafe execution configuration",
    );
    await git(fixture.workspaceRoot, [
      "config",
      "--worktree",
      "filter.leak.clean",
      "/usr/bin/git show HEAD:PRIVATE_TRACKED.txt",
    ]);
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "unsupported metadata extensions",
    );
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "extensions.worktreeConfig",
    ]);
    await rm(path.join(fixture.workspaceRoot, ".git/config.worktree"));
    await writeFile(
      path.join(fixture.workspaceRoot, ".git/sharedindex.PRIVATE"),
      "PRIVATE_SHARED_INDEX",
    );
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "unsupported metadata extensions",
    );
    await rm(path.join(fixture.workspaceRoot, ".git/sharedindex.PRIVATE"));
    await writeFile(
      path.join(fixture.workspaceRoot, ".git/info/sparse-checkout"),
      "PRIVATE_*\n",
    );
    await expect(runner.inspect({ action: "status" })).rejects.toThrow(
      "unsupported metadata extensions",
    );
    await rm(path.join(fixture.workspaceRoot, ".git/info/sparse-checkout"));

    const drifting = fakeSandbox(async () => {
      await writeFile(
        path.join(fixture.workspaceRoot, ".git/config"),
        "[core]\nrepositoryformatversion = 0\nbare = false\nPRIVATE_DRIFT = true\n",
      );
    });
    await expect(
      new GitInspectRunner({
        workspaceRoot: fixture.workspaceRoot,
        sandbox: drifting,
      }).inspect({ action: "status" }),
    ).rejects.toThrow("metadata changed during inspection");

    const cappedFixture = await createRepository();
    await writeFile(
      path.join(cappedFixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      `${"x".repeat(128 * 1024 + 1)}\n`,
    );
    await expect(
      new GitInspectRunner({
        workspaceRoot: cappedFixture.workspaceRoot,
        sandbox,
      }).inspect({
        action: "diff",
        scope: "working",
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("output exceeds its bounded limit");

    await expect(
      new GitInspectRunner({
        workspaceRoot: cappedFixture.workspaceRoot,
        sandbox: fakeSandbox(
          () => new Promise((resolve) => setTimeout(resolve, 1_050)),
        ),
      }).inspect({ action: "status", timeoutMs: 1_000 }),
    ).rejects.toThrow("timed out");
  }, 30_000);

  it("is a medium-risk read effect enabled for ordinary workspace agents", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall("workspace", "git_inspect", { action: "status" }, workspace),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "read-only sandboxed command execution",
      }),
    );
    expect(
      assessToolCall("observe", "git_inspect", { action: "status" }, workspace),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "the active agent policy does not allow process execution",
      }),
    );
    expect(builtInToolEffect("git_inspect")).toBe("read");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toContain("git_inspect");
  });
});

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await temporaryRoot("napier-git-inspect-");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
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

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
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

function directSandbox(): OsSandboxAdapter & {
  launches: SandboxLaunchRequest[];
} {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-test",
    launches,
    async launch(request) {
      launches.push(structuredClone(request));
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
      return childProcess(child);
    },
  };
}

function fakeSandbox(
  onLaunch: () => Promise<void>,
): OsSandboxAdapter {
  return {
    id: "fake-git-test",
    async launch() {
      await onLaunch();
      const stdout = new (await import("node:stream")).PassThrough();
      const stderr = new (await import("node:stream")).PassThrough();
      const stdin = new (await import("node:stream")).PassThrough();
      stdout.end("");
      stderr.end("");
      return {
        stdin,
        stdout,
        stderr,
        exit: Promise.resolve({ code: 0, signal: null }),
        terminate: async () => undefined,
      };
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

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

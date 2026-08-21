import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { gitPathSetSha256 } from "../src/git-path-set.js";
import {
  parseGitConflictIndex,
  parseGitConflictIndexSet,
} from "../src/git-conflict-index.js";
import {
  createGitInspectTool,
  gitInspectToolCallArgumentsLedgerProjection,
  gitInspectToolOutputLedgerProjection,
} from "../src/git-inspect-tool.js";
import { GitInspectRunner } from "../src/git-inspect.js";
import { GitStageMutationManager } from "../src/git-stage.js";
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

describe("Git conflict inspection", () => {
  it("inspects complete stages and resolves through atomic staging", async () => {
    const fixture = await createConflictFixture("text");
    const sandbox = directSandbox();
    const tool = createGitInspectTool({
      workspaceRoot: fixture.workspaceRoot,
      sandbox,
    });
    const indexBefore = await readFile(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    expect(parseGitConflictIndex(indexBefore, "CONFLICT.txt")).toHaveLength(3);
    const parsedSet = parseGitConflictIndexSet(indexBefore, [
      "ABSENT.txt",
      "CONFLICT.txt",
    ]);
    expect(parsedSet.get("ABSENT.txt")).toEqual([]);
    expect(parsedSet.get("CONFLICT.txt")).toHaveLength(3);
    const tamperedIndex = Buffer.from(indexBefore);
    tamperedIndex[20] = (tamperedIndex[20] ?? 0) ^ 1;
    expect(() => parseGitConflictIndex(tamperedIndex, "CONFLICT.txt")).toThrow(
      "index is invalid",
    );
    const versionFour = Buffer.from(indexBefore);
    versionFour.writeUInt32BE(4, 4);
    refreshIndexChecksum(versionFour);
    expect(() => parseGitConflictIndex(versionFour, "CONFLICT.txt")).toThrow(
      "version is unsupported",
    );

    const inspected = await tool.execute("inspect-conflict", {
      action: "conflict",
      path: "CONFLICT.txt",
    });

    const text = inspected.content[0]?.text ?? "";
    for (const expected of [
      "GIT CONFLICT",
      "PRIVATE_BASE",
      "PRIVATE_OURS",
      "PRIVATE_THEIRS",
      "<<<<<<< HEAD",
      "BASE stage=1",
      "OURS stage=2",
      "THEIRS stage=3",
    ]) {
      expect(text).toContain(expected);
    }
    expect(inspected.details).toEqual(
      expect.objectContaining({
        kind: "napier.git-inspection",
        schemaVersion: 1,
        action: "conflict",
        conflictKind: "both_modified",
        conflictStageCount: 3,
        basePresent: true,
        oursPresent: true,
        theirsPresent: true,
        worktreePresent: true,
        fileCount: 1,
        hunkCount: 0,
        conflictEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      await readFile(path.join(fixture.workspaceRoot, ".git/index")),
    ).toEqual(indexBefore);
    expect(
      sandbox.launches.some((launch) => launch.args.includes("ls-files")),
    ).toBe(false);
    expect(
      sandbox.launches.filter((launch) => launch.args.includes("cat-file")),
    ).toHaveLength(3);
    for (const launch of sandbox.launches) {
      expect(launch.approvedCapabilities).toEqual([
        "process.spawn",
        "workspace.read",
      ]);
      expect(launch.args.join("\n")).not.toContain("PRIVATE_");
    }

    const durable = JSON.stringify({
      call: gitInspectToolCallArgumentsLedgerProjection({
        action: "conflict",
        path: "CONFLICT.txt",
      }),
      output: gitInspectToolOutputLedgerProjection(text, {
        details: inspected.details,
      }),
    });
    for (const privateValue of [
      "CONFLICT.txt",
      "PRIVATE_BASE",
      "PRIVATE_OURS",
      "PRIVATE_THEIRS",
      "<<<<<<<",
    ]) {
      expect(durable).not.toContain(privateValue);
    }
    const invalidDetails = {
      ...inspected.details,
      conflictStageCount: 2,
      basePresent: false,
    };
    const { resultSha256: _resultSha256, ...invalidContent } = invalidDetails;
    invalidDetails.resultSha256 = sha256(canonicalJson(invalidContent));
    expect(
      gitInspectToolOutputLedgerProjection(text, {
        details: invalidDetails,
      }),
    ).not.toHaveProperty("details");

    const normalized = await new GitInspectRunner({
      workspaceRoot: fixture.workspaceRoot,
      sandbox,
    }).inspect({
      action: "conflict",
      path: "sub/../CONFLICT.txt",
    });
    expect(normalized.details.pathSha256).toBe(sha256("CONFLICT.txt"));
    expect(normalized.output).toContain("Path: CONFLICT.txt");
    expect(
      gitInspectToolCallArgumentsLedgerProjection({
        action: "conflict",
        path: "sub/../CONFLICT.txt",
      }),
    ).toEqual(
      expect.objectContaining({
        pathSha256: sha256("CONFLICT.txt"),
        pathBytes: Buffer.byteLength("CONFLICT.txt"),
      }),
    );

    await writeFile(
      path.join(fixture.workspaceRoot, "CONFLICT.txt"),
      "PRIVATE_RESOLVED\n",
    );
    const manager = new GitStageMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: path.join(fixture.root, "data"),
      sandbox,
    });
    const preview = await manager.preview("thread_a", "run_a", {
      path: "CONFLICT.txt",
    });
    expect(preview.patch).toContain("PRIVATE_RESOLVED");

    const applied = await manager.apply("thread_a", "run_a", preview.id);

    expect(applied.details.status).toBe("applied");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "ls-files",
        "--unmerged",
        "--",
        "CONFLICT.txt",
      ]),
    ).toBe("");
    await expect(
      new GitInspectRunner({
        workspaceRoot: fixture.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("does not have a supported unmerged conflict");
  }, 30_000);

  it("rejects non-conflicts, binary, oversized, and symlinked conflict text", async () => {
    const clean = await createRepository();
    const sandbox = directSandbox();
    const cleanRunner = new GitInspectRunner({
      workspaceRoot: clean.workspaceRoot,
      sandbox,
    });
    await expect(
      cleanRunner.inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("does not have a supported unmerged conflict");
    await expect(
      cleanRunner.inspect({
        action: "conflict",
        path: "../CONFLICT.txt",
      }),
    ).rejects.toThrow("path escapes the workspace");

    const binary = await createConflictFixture("binary");
    await expect(
      new GitInspectRunner({
        workspaceRoot: binary.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("not bounded UTF-8 text");

    const oversized = await createConflictFixture("oversized");
    await expect(
      new GitInspectRunner({
        workspaceRoot: oversized.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("not bounded UTF-8 text");

    const controlled = await createConflictFixture("control");
    await expect(
      new GitInspectRunner({
        workspaceRoot: controlled.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("not bounded UTF-8 text");

    const carriage = await createConflictFixture("carriage");
    await expect(
      new GitInspectRunner({
        workspaceRoot: carriage.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("not bounded UTF-8 text");

    const delayed = await createConflictFixture("binary");
    await writeFile(
      path.join(delayed.workspaceRoot, "CONFLICT.txt"),
      "BOUNDED_WORKTREE\n",
    );
    const delayStarted = Date.now();
    await expect(
      new GitInspectRunner({
        workspaceRoot: delayed.workspaceRoot,
        sandbox: delayedFirstBlobSandbox(250),
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("Git conflict blob inspection failed");
    expect(Date.now() - delayStarted).toBeGreaterThanOrEqual(200);

    const processFailure = await createConflictFixture("text");
    await expect(
      new GitInspectRunner({
        workspaceRoot: processFailure.workspaceRoot,
        sandbox: failingBlobSandbox(),
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("Git conflict blob inspection failed");

    const symlinked = await createConflictFixture("text");
    const external = path.join(symlinked.root, "PRIVATE_EXTERNAL.txt");
    await writeFile(external, "PRIVATE_EXTERNAL\n");
    await rm(path.join(symlinked.workspaceRoot, "CONFLICT.txt"));
    await symlink(external, path.join(symlinked.workspaceRoot, "CONFLICT.txt"));
    await expect(
      new GitInspectRunner({
        workspaceRoot: symlinked.workspaceRoot,
        sandbox,
      }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
    ).rejects.toThrow("not canonical");

    const fifo = await createConflictFixture("text");
    const fifoPath = path.join(fifo.workspaceRoot, "CONFLICT.txt");
    await rm(fifoPath);
    await execFileAsync("/usr/bin/mkfifo", [fifoPath]);
    const unblock = new Promise<void>((resolve) => {
      setTimeout(() => {
        void open(
          fifoPath,
          fsConstants.O_RDWR | (fsConstants.O_NONBLOCK ?? 0),
        ).then(async (handle) => {
          await handle.writeFile("x");
          await handle.close();
          resolve();
        });
      }, 300);
    });
    const fifoStarted = Date.now();
    await expect(
      new GitInspectRunner({
        workspaceRoot: fifo.workspaceRoot,
        sandbox,
      }).inspect({
        action: "conflict",
        path: "CONFLICT.txt",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("not bounded UTF-8 text");
    expect(Date.now() - fifoStarted).toBeLessThan(250);
    await unblock;
  }, 45_000);

  it("classifies add/add and asymmetric delete conflicts", async () => {
    const sandbox = directSandbox();
    const bothAdded = await createAddAddConflict();
    const deletedByThem = await createDeleteConflict("theirs");
    const deletedByUs = await createDeleteConflict("ours");

    const results = await Promise.all(
      [bothAdded, deletedByThem, deletedByUs].map((fixture) =>
        new GitInspectRunner({
          workspaceRoot: fixture.workspaceRoot,
          sandbox,
        }).inspect({ action: "conflict", path: "CONFLICT.txt" }),
      ),
    );

    expect(results.map((result) => result.details.conflictKind)).toEqual([
      "both_added",
      "deleted_by_them",
      "deleted_by_us",
    ]);
    expect(results.map((result) => result.details.conflictStageCount)).toEqual([
      2, 2, 2,
    ]);
    expect(results[0]?.details).toEqual(
      expect.objectContaining({
        basePresent: false,
        oursPresent: true,
        theirsPresent: true,
      }),
    );
    expect(results[1]?.details).toEqual(
      expect.objectContaining({
        basePresent: true,
        oursPresent: true,
        theirsPresent: false,
      }),
    );
    expect(results[2]?.details).toEqual(
      expect.objectContaining({
        basePresent: true,
        oursPresent: false,
        theirsPresent: true,
      }),
    );
    expect(
      new Set(results.map((result) => result.details.gitArgumentsSha256)).size,
    ).toBe(3);
  }, 30_000);

  it("inspects one canonical mixed conflict set with aggregate evidence", async () => {
    const fixture = await createMixedConflict();
    const sandbox = directSandbox();
    const runner = new GitInspectRunner({
      workspaceRoot: fixture.workspaceRoot,
      sandbox,
    });

    const inspected = await runner.inspect({
      action: "conflict",
      paths: ["CONFLICT_B.txt", "sub/../CONFLICT.txt"],
    });

    expect(inspected.output.indexOf("Path: CONFLICT.txt")).toBeLessThan(
      inspected.output.indexOf("Path: CONFLICT_B.txt"),
    );
    for (const expected of [
      "PRIVATE_A_BASE",
      "PRIVATE_A_OURS",
      "PRIVATE_A_THEIRS",
      "PRIVATE_B_BASE",
      "PRIVATE_B_THEIRS",
    ]) {
      expect(inspected.output).toContain(expected);
    }
    expect(inspected.details).toEqual(
      expect.objectContaining({
        action: "conflict",
        pathSha256: gitPathSetSha256(["CONFLICT.txt", "CONFLICT_B.txt"]),
        fileCount: 2,
        conflictKind: "mixed",
        conflictStageCount: 5,
        basePresent: true,
        oursPresent: false,
        theirsPresent: true,
        worktreePresent: true,
      }),
    );
    expect(
      sandbox.launches.filter((launch) => launch.args.includes("cat-file")),
    ).toHaveLength(5);
    expect(
      gitInspectToolCallArgumentsLedgerProjection({
        action: "conflict",
        paths: ["CONFLICT_B.txt", "sub/../CONFLICT.txt"],
      }),
    ).toEqual(
      expect.objectContaining({
        pathCount: 2,
        pathSetSha256: inspected.details.pathSha256,
      }),
    );
    const durable = JSON.stringify(
      gitInspectToolOutputLedgerProjection(inspected.output, {
        details: inspected.details,
      }),
    );
    expect(durable).toContain('"conflictKind":"mixed"');
    expect(durable).not.toContain("CONFLICT");
    expect(durable).not.toContain("PRIVATE_");
    await expect(
      runner.inspect({
        action: "conflict",
        path: "CONFLICT.txt",
        paths: ["CONFLICT_B.txt"],
      }),
    ).rejects.toThrow("target set is invalid");
    await expect(
      runner.inspect({
        action: "conflict",
        path: "CONFLICT.txt",
        paths: "invalid" as unknown as string[],
      }),
    ).rejects.toThrow("target set is invalid");
    await expect(
      runner.inspect({
        action: "conflict",
        paths: ["CONFLICT.txt", "sub/../CONFLICT.txt"],
      }),
    ).rejects.toThrow("paths collide");
    await expect(
      runner.inspect({
        action: "conflict",
        paths: ["CONFLICT.txt", "CLEAN.txt"],
      }),
    ).rejects.toThrow("does not have a supported unmerged conflict");
    await expect(
      new GitInspectRunner({
        workspaceRoot: fixture.workspaceRoot,
        sandbox: driftingConflictSetSandbox(fixture.workspaceRoot),
      }).inspect({
        action: "conflict",
        paths: ["CONFLICT.txt", "CONFLICT_B.txt"],
      }),
    ).rejects.toThrow("worktree set changed");
  }, 30_000);
});

async function createConflictFixture(
  kind: "text" | "binary" | "oversized" | "control" | "carriage",
): Promise<{ root: string; workspaceRoot: string }> {
  const fixture = await createRepository();
  await git(fixture.workspaceRoot, ["branch", "feature"]);
  await writeConflictValue(fixture.workspaceRoot, kind, "ours");
  await commit(fixture.workspaceRoot, "ours");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeConflictValue(fixture.workspaceRoot, kind, "theirs");
  await commit(fixture.workspaceRoot, "theirs");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
  await mergeExpectingConflict(fixture.workspaceRoot);
  return fixture;
}

async function mergeExpectingConflict(workspaceRoot: string): Promise<void> {
  await expectGitFailure(workspaceRoot, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "merge",
    "feature",
  ]);
}

async function createAddAddConflict(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const fixture = await createRepository();
  await git(fixture.workspaceRoot, ["rm", "--quiet", "CONFLICT.txt"]);
  await commit(fixture.workspaceRoot, "remove base path");
  await git(fixture.workspaceRoot, ["branch", "feature"]);
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT.txt"),
    "PRIVATE_OURS\n",
  );
  await commit(fixture.workspaceRoot, "ours");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT.txt"),
    "PRIVATE_THEIRS\n",
  );
  await commit(fixture.workspaceRoot, "theirs");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
  await mergeExpectingConflict(fixture.workspaceRoot);
  return fixture;
}

async function createDeleteConflict(
  deletedBy: "ours" | "theirs",
): Promise<{ root: string; workspaceRoot: string }> {
  const fixture = await createRepository();
  await git(fixture.workspaceRoot, ["branch", "feature"]);
  if (deletedBy === "ours") {
    await git(fixture.workspaceRoot, ["rm", "--quiet", "CONFLICT.txt"]);
  } else {
    await writeFile(
      path.join(fixture.workspaceRoot, "CONFLICT.txt"),
      "PRIVATE_OURS\n",
    );
  }
  await commit(fixture.workspaceRoot, "ours");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "feature"]);
  if (deletedBy === "theirs") {
    await git(fixture.workspaceRoot, ["rm", "--quiet", "CONFLICT.txt"]);
  } else {
    await writeFile(
      path.join(fixture.workspaceRoot, "CONFLICT.txt"),
      "PRIVATE_THEIRS\n",
    );
  }
  await commit(fixture.workspaceRoot, "theirs");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "main"]);
  await mergeExpectingConflict(fixture.workspaceRoot);
  return fixture;
}

async function createMixedConflict(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const fixture = await createRepository();
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT.txt"),
    "PRIVATE_A_BASE\n",
  );
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT_B.txt"),
    "PRIVATE_B_BASE\n",
  );
  await git(fixture.workspaceRoot, ["add", "--all"]);
  await commit(fixture.workspaceRoot, "mixed base");
  const sourceBranch = (
    await gitOutput(fixture.workspaceRoot, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
  await git(fixture.workspaceRoot, ["branch", "feature-mixed"]);
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT.txt"),
    "PRIVATE_A_OURS\n",
  );
  await rm(path.join(fixture.workspaceRoot, "CONFLICT_B.txt"));
  await git(fixture.workspaceRoot, ["add", "--all"]);
  await commit(fixture.workspaceRoot, "mixed ours");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", "feature-mixed"]);
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT.txt"),
    "PRIVATE_A_THEIRS\n",
  );
  await writeFile(
    path.join(fixture.workspaceRoot, "CONFLICT_B.txt"),
    "PRIVATE_B_THEIRS\n",
  );
  await git(fixture.workspaceRoot, ["add", "--all"]);
  await commit(fixture.workspaceRoot, "mixed theirs");
  await git(fixture.workspaceRoot, ["checkout", "--quiet", sourceBranch]);
  await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "merge",
      "feature-mixed",
    ],
    { cwd: fixture.workspaceRoot, env: gitEnvironment() },
  ).catch(() => undefined);
  return fixture;
}

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-conflict-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "CONFLICT.txt"), "PRIVATE_BASE\n");
  await git(workspaceRoot, ["add", "CONFLICT.txt"]);
  await commit(workspaceRoot, "base");
  return { root, workspaceRoot };
}

async function writeConflictValue(
  workspaceRoot: string,
  kind: "text" | "binary" | "oversized" | "control" | "carriage",
  side: "ours" | "theirs",
): Promise<void> {
  const filePath = path.join(workspaceRoot, "CONFLICT.txt");
  if (kind === "text") {
    await writeFile(filePath, `PRIVATE_${side.toUpperCase()}\n`);
    return;
  }
  if (kind === "binary") {
    await writeFile(filePath, Buffer.from([0, side === "ours" ? 1 : 2, 10]));
    return;
  }
  if (kind === "control") {
    await writeFile(filePath, `PRIVATE_${side.toUpperCase()}\u001b[31m\n`);
    return;
  }
  if (kind === "carriage") {
    await writeFile(filePath, `PRIVATE_${side.toUpperCase()}\rREWRITE\n`);
    return;
  }
  await writeFile(filePath, `${side === "ours" ? "A" : "B"}`.repeat(25 * 1024));
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
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
  await execFileAsync("/usr/bin/git", args, { cwd, env: gitEnvironment() });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: gitEnvironment(),
    })
  ).stdout;
}

async function expectGitFailure(cwd: string, args: string[]): Promise<void> {
  await expect(
    execFileAsync("/usr/bin/git", args, {
      cwd,
      env: gitEnvironment(),
    }),
  ).rejects.toThrow();
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function refreshIndexChecksum(index: Buffer): void {
  const payloadEnd = index.length - 20;
  createHash("sha1")
    .update(index.subarray(0, payloadEnd))
    .digest()
    .copy(index, payloadEnd);
}

function directSandbox(): OsSandboxAdapter & {
  launches: SandboxLaunchRequest[];
} {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-conflict-test",
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

function driftingConflictSetSandbox(workspaceRoot: string): OsSandboxAdapter {
  const sandbox = directSandbox();
  let blobLaunches = 0;
  return {
    ...sandbox,
    id: "drifting-git-conflict-set",
    async launch(request) {
      if (request.args.includes("cat-file") && (blobLaunches += 1) === 4) {
        await writeFile(
          path.join(workspaceRoot, "CONFLICT.txt"),
          "PRIVATE_SET_DRIFT\n",
        );
      }
      return sandbox.launch(request);
    },
  };
}

function delayedFirstBlobSandbox(delayMs: number): OsSandboxAdapter {
  let delayed = false;
  return {
    id: "delayed-git-conflict-test",
    async launch(request) {
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
      if (!delayed && request.args.includes("cat-file")) {
        delayed = true;
        return {
          ...process,
          exit: process.exit.then(
            (result) =>
              new Promise((resolve) => {
                setTimeout(() => resolve(result), delayMs);
              }),
          ),
        };
      }
      return process;
    },
  };
}

function failingBlobSandbox(): OsSandboxAdapter {
  return {
    id: "failing-git-conflict-test",
    async launch(request) {
      if (request.args.includes("cat-file")) {
        throw new Error(
          "/private/absolute/PRIVATE_PATH must not escape through errors",
        );
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
      return childProcess(child);
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

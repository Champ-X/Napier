import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXECUTION_PLAN_WORKFLOW_TOOL_NAMES } from "@napier/contracts";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { sha256 } from "../src/ed25519.js";
import { GitStageMutationManager } from "../src/git-stage.js";
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

describe("preview-bound Git staging", () => {
  it("previews without repository mutation and atomically stages the exact path", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const target = path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt");
    await writeFile(target, "PRIVATE_AFTER\n");
    const beforeIndex = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const beforeIndexMode =
      (await lstat(path.join(fixture.workspaceRoot, ".git/index"))).mode &
      0o777;
    const beforeObjects = await objectSet(fixture.workspaceRoot);

    const preview = await manager.preview("thread_private", "run_private", {
      path: "PRIVATE_TRACKED.txt",
      contextLines: 0,
    });

    expect(preview.patch).toContain("-PRIVATE_BEFORE");
    expect(preview.patch).toContain("+PRIVATE_AFTER");
    expect(preview.details).toEqual(
      expect.objectContaining({
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        fileCount: 1,
        contextLines: 0,
        durable: false,
        pathSha256: sha256("PRIVATE_TRACKED.txt"),
      }),
    );
    expect(JSON.stringify(preview.details)).not.toContain("PRIVATE");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(beforeIndex);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(beforeObjects);
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([]);
    await expect(
      gitOutput(fixture.workspaceRoot, ["diff", "--cached"]),
    ).resolves.not.toContain("PRIVATE_AFTER");

    const applied = await manager.apply(
      "thread_private",
      "run_private",
      preview.id,
    );

    expect(applied.patch).toBe(preview.patch);
    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        status: "applied",
        postcondition: "verified",
        proposedIndexSha256: preview.details.proposedIndexSha256,
        sourcePreviewResultSha256: preview.details.resultSha256,
        durable: true,
      }),
    );
    expect(applied.details.afterIndexSha256).toBe(
      preview.details.proposedIndexSha256,
    );
    expect(
      (await lstat(path.join(fixture.workspaceRoot, ".git/index"))).mode &
        0o777,
    ).toBe(beforeIndexMode);
    expect(await readFile(target, "utf8")).toBe("PRIVATE_AFTER\n");
    await expect(
      gitOutput(fixture.workspaceRoot, [
        "diff",
        "--cached",
        "--",
        "PRIVATE_TRACKED.txt",
      ]),
    ).resolves.toContain("+PRIVATE_AFTER");
    await expect(
      gitOutput(fixture.workspaceRoot, ["diff", "--", "PRIVATE_TRACKED.txt"]),
    ).resolves.toBe("");
    await expect(
      lstat(path.join(fixture.workspaceRoot, ".git/index.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([]);
    await expect(
      manager.apply("thread_private", "run_private", preview.id),
    ).rejects.toThrow("not found");

    const privateLaunches = sandbox.launches.filter((request) =>
      request.approvedCapabilities.includes("workspace.write"),
    );
    expect(privateLaunches.length).toBeGreaterThanOrEqual(4);
    for (const launch of privateLaunches) {
      expect(launch.workspaceWritePaths).toHaveLength(1);
      expect(launch.workspaceWritePaths?.[0]).toMatch(
        /\/\.git\/napier-stage\/stage-/u,
      );
      expect(launch.workspaceWritePaths?.[0]).not.toBe(
        path.join(fixture.workspaceRoot, ".git"),
      );
      expect(launch.env["GIT_INDEX_FILE"]).toMatch(
        /\/\.git\/napier-stage\/stage-[^/]+\/index$/u,
      );
      expect(launch.env["GIT_OBJECT_DIRECTORY"]).toMatch(
        /\/\.git\/napier-stage\/stage-[^/]+\/objects$/u,
      );
    }
  }, 30_000);

  it("stages only selected one-based hunks while preserving other worktree changes", async () => {
    const fixture = await createRepository();
    const target = path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt");
    const baseline = Array.from(
      { length: 20 },
      (_, index) => `line-${index + 1}`,
    );
    await writeFile(target, `${baseline.join("\n")}\n`);
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "hunk baseline",
    ]);
    const changed = [...baseline];
    changed[1] = "PRIVATE_FIRST_HUNK";
    changed[17] = "PRIVATE_SECOND_HUNK";
    await writeFile(target, `${changed.join("\n")}\n`);
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const manager = managerFor(fixture, directSandbox());

    const preview = await manager.preview("thread_hunk", "run_hunk", {
      path: "PRIVATE_TRACKED.txt",
      contextLines: 0,
      hunkIndexes: [2],
    });

    expect(preview).toEqual(
      expect.objectContaining({
        selectionMode: "hunks",
        selectedHunkCount: 1,
        details: expect.objectContaining({
          hunkCount: 1,
          gitArgumentsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(preview.patch).toContain("+PRIVATE_SECOND_HUNK");
    expect(preview.patch).not.toContain("+PRIVATE_FIRST_HUNK");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);
    const wholePathPreview = await manager.preview(
      "thread_whole",
      "run_whole",
      {
        path: "PRIVATE_TRACKED.txt",
        contextLines: 0,
      },
    );
    expect(wholePathPreview.patch).toContain("+PRIVATE_FIRST_HUNK");
    expect(wholePathPreview.patch).toContain("+PRIVATE_SECOND_HUNK");
    expect(wholePathPreview.details.gitArgumentsSha256).not.toBe(
      preview.details.gitArgumentsSha256,
    );

    const applied = await manager.apply("thread_hunk", "run_hunk", preview.id);

    expect(applied.details.status).toBe("applied");
    expect(applied.selectedHunkCount).toBe(1);
    const staged = await gitOutput(fixture.workspaceRoot, [
      "diff",
      "--cached",
      "--",
      "PRIVATE_TRACKED.txt",
    ]);
    const working = await gitOutput(fixture.workspaceRoot, [
      "diff",
      "--",
      "PRIVATE_TRACKED.txt",
    ]);
    expect(staged).toContain("+PRIVATE_SECOND_HUNK");
    expect(staged).not.toContain("+PRIVATE_FIRST_HUNK");
    expect(working).toContain("+PRIVATE_FIRST_HUNK");
    expect(working).not.toContain("+PRIVATE_SECOND_HUNK");
    expect(await readFile(target, "utf8")).toBe(`${changed.join("\n")}\n`);

    const staleIndex = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    await expect(
      manager.preview("thread_hunk", "run_hunk", {
        path: "PRIVATE_TRACKED.txt",
        hunkIndexes: [0],
      }),
    ).rejects.toThrow("hunk selection is invalid");
    await expect(
      manager.preview("thread_hunk", "run_hunk", {
        path: "PRIVATE_TRACKED.txt",
        hunkIndexes: [2, 1],
      }),
    ).rejects.toThrow("strictly increasing");
    await expect(
      manager.preview("thread_hunk", "run_hunk", {
        path: "PRIVATE_TRACKED.txt",
        contextLines: 1,
        hunkIndexes: [2],
      }),
    ).rejects.toThrow("available hunks");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(staleIndex);
  }, 30_000);

  it("adds multiple selected hunks onto existing staged content", async () => {
    const fixture = await createRepository();
    const target = path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt");
    const baseline = Array.from(
      { length: 30 },
      (_, index) => `line-${index + 1}`,
    );
    await writeFile(target, `${baseline.join("\n")}\n`);
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "multi hunk baseline",
    ]);
    const stagedContent = [...baseline];
    stagedContent[14] = "PRIVATE_ALREADY_STAGED";
    await writeFile(target, `${stagedContent.join("\n")}\n`);
    await git(fixture.workspaceRoot, ["add", "PRIVATE_TRACKED.txt"]);
    const worktreeContent = [...stagedContent];
    worktreeContent[1] = "PRIVATE_SELECTED_FIRST";
    worktreeContent[27] = "PRIVATE_SELECTED_SECOND";
    await writeFile(target, `${worktreeContent.join("\n")}\n`);
    const manager = managerFor(fixture, directSandbox());

    const preview = await manager.preview("thread_multi", "run_multi", {
      path: "PRIVATE_TRACKED.txt",
      contextLines: 1,
      hunkIndexes: [1, 2],
    });

    expect(preview.patch).toContain("+PRIVATE_ALREADY_STAGED");
    expect(preview.patch).toContain("+PRIVATE_SELECTED_FIRST");
    expect(preview.patch).toContain("+PRIVATE_SELECTED_SECOND");
    expect(preview.details.hunkCount).toBe(3);
    expect(preview.selectedHunkCount).toBe(2);

    const applied = await manager.apply(
      "thread_multi",
      "run_multi",
      preview.id,
    );
    const staged = await gitOutput(fixture.workspaceRoot, [
      "diff",
      "--cached",
      "--",
      "PRIVATE_TRACKED.txt",
    ]);
    expect(applied.details.status).toBe("applied");
    expect(applied.selectedHunkCount).toBe(2);
    expect(staged).toContain("+PRIVATE_ALREADY_STAGED");
    expect(staged).toContain("+PRIVATE_SELECTED_FIRST");
    expect(staged).toContain("+PRIVATE_SELECTED_SECOND");
    await expect(
      gitOutput(fixture.workspaceRoot, ["diff", "--", "PRIVATE_TRACKED.txt"]),
    ).resolves.toBe("");
  }, 30_000);

  it("atomically stages one canonical multi-path modify/add/delete set", async () => {
    const fixture = await createRepository();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_DELETE.txt"),
      "PRIVATE_DELETE_BEFORE\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_UNCHANGED.txt"),
      "PRIVATE_UNCHANGED\n",
    );
    await git(fixture.workspaceRoot, [
      "add",
      "PRIVATE_DELETE.txt",
      "PRIVATE_UNCHANGED.txt",
    ]);
    await git(fixture.workspaceRoot, [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "multi-path baseline",
    ]);
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_MODIFIED\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_NEW.txt"),
      "PRIVATE_NEW\n",
    );
    await unlink(path.join(fixture.workspaceRoot, "PRIVATE_DELETE.txt"));
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const indexPath = path.join(fixture.workspaceRoot, ".git/index");
    const indexBefore = await sha256File(indexPath);
    const objectsBefore = await objectSet(fixture.workspaceRoot);

    await expect(
      manager.preview("thread_multi_invalid", "run_multi_invalid", {
        paths: ["PRIVATE_TRACKED.txt", "PRIVATE_UNCHANGED.txt"],
      }),
    ).rejects.toThrow("Every Git stage target");
    await expect(
      manager.preview("thread_multi_invalid", "run_multi_invalid", {
        paths: ["PRIVATE_TRACKED.txt", "sub/../PRIVATE_TRACKED.txt"],
      }),
    ).rejects.toThrow("paths collide");
    await expect(
      manager.preview("thread_multi_invalid", "run_multi_invalid", {
        path: "PRIVATE_TRACKED.txt",
        paths: ["PRIVATE_NEW.txt"],
      }),
    ).rejects.toThrow("exactly one path");
    await expect(
      manager.preview("thread_multi_invalid", "run_multi_invalid", {
        paths: ["PRIVATE_NEW.txt", "PRIVATE_TRACKED.txt"],
        hunkIndexes: [1],
      }),
    ).rejects.toThrow("single path input");
    await expect(
      manager.preview("thread_multi_invalid", "run_multi_invalid", {
        paths: Array.from({ length: 17 }, (_, index) => `file-${index}.txt`),
      }),
    ).rejects.toThrow("bounded path list");
    expect(await sha256File(indexPath)).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);

    const preview = await manager.preview("thread_multi", "run_multi", {
      paths: ["PRIVATE_TRACKED.txt", "PRIVATE_NEW.txt", "PRIVATE_DELETE.txt"],
      contextLines: 1,
    });

    expect(preview.paths).toEqual([
      "PRIVATE_DELETE.txt",
      "PRIVATE_NEW.txt",
      "PRIVATE_TRACKED.txt",
    ]);
    expect(preview.details).toEqual(
      expect.objectContaining({
        fileCount: 3,
        pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(preview.details.pathSha256).not.toBe(sha256("PRIVATE_DELETE.txt"));
    expect(preview.patch).toContain("-PRIVATE_DELETE_BEFORE");
    expect(preview.patch).toContain("+PRIVATE_NEW");
    expect(preview.patch).toContain("+PRIVATE_MODIFIED");
    expect(await sha256File(indexPath)).toBe(indexBefore);
    expect(await objectSet(fixture.workspaceRoot)).toEqual(objectsBefore);

    const applied = await manager.apply(
      "thread_multi",
      "run_multi",
      preview.id,
    );

    expect(applied).toEqual(
      expect.objectContaining({
        paths: preview.paths,
        selectionMode: "path",
        selectedHunkCount: 0,
        details: expect.objectContaining({
          status: "applied",
          postcondition: "verified",
          durable: true,
        }),
      }),
    );
    const staged = await gitOutput(fixture.workspaceRoot, ["diff", "--cached"]);
    expect(staged).toContain("-PRIVATE_DELETE_BEFORE");
    expect(staged).toContain("+PRIVATE_NEW");
    expect(staged).toContain("+PRIVATE_MODIFIED");
    await expect(gitOutput(fixture.workspaceRoot, ["diff"])).resolves.toBe("");
    expect(
      sandbox.launches
        .filter((launch) => launch.args.includes("add"))
        .slice(-3)
        .map((launch) => launch.args.at(-1)),
    ).toEqual(preview.paths);
    await expect(
      readdir(path.join(fixture.workspaceRoot, ".git/napier-stage")),
    ).resolves.toEqual([]);

    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_NEW.txt"),
      "PRIVATE_NEW_STALE\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      "PRIVATE_MODIFIED_STALE\n",
    );
    const stalePreview = await manager.preview(
      "thread_multi_stale",
      "run_multi_stale",
      { paths: ["PRIVATE_NEW.txt", "PRIVATE_TRACKED.txt"] },
    );
    const indexBeforeStale = await sha256File(indexPath);
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_NEW.txt"),
      "PRIVATE_EXTERNAL_DRIFT\n",
    );
    await expect(
      manager.apply("thread_multi_stale", "run_multi_stale", stalePreview.id),
    ).rejects.toThrow("stale");
    expect(await sha256File(indexPath)).toBe(indexBeforeStale);
  }, 30_000);

  it("supports untracked and deleted files while rejecting stale or unsafe state", async () => {
    const fixture = await createRepository();
    const sandbox = directSandbox();
    const manager = managerFor(fixture, sandbox);
    const untracked = path.join(fixture.workspaceRoot, "PRIVATE_NEW.txt");
    await writeFile(untracked, "PRIVATE_NEW\n");
    const newPreview = await manager.preview("thread_a", "run_a", {
      path: "PRIVATE_NEW.txt",
    });
    expect(newPreview.patch).toContain("new file mode");
    await expect(
      manager.apply("thread_other", "run_a", newPreview.id),
    ).rejects.toThrow("not found");
    const newApplied = await manager.apply("thread_a", "run_a", newPreview.id);
    expect(newApplied.details.status).toBe("applied");
    await expect(
      gitOutput(fixture.workspaceRoot, [
        "diff",
        "--cached",
        "--",
        "PRIVATE_NEW.txt",
      ]),
    ).resolves.toContain("+PRIVATE_NEW");

    const tracked = path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt");
    await unlink(tracked);
    const deletePreview = await manager.preview("thread_a", "run_a", {
      path: "PRIVATE_TRACKED.txt",
    });
    expect(deletePreview.patch).toContain("deleted file mode");
    const indexBeforeStale = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    await writeFile(tracked, "PRIVATE_EXTERNAL\n");
    await expect(
      manager.apply("thread_a", "run_a", deletePreview.id),
    ).rejects.toThrow("stale");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBeforeStale);

    const attributePreview = await manager.preview("thread_a", "run_a", {
      path: "PRIVATE_TRACKED.txt",
    });
    const indexBeforeAttributes = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const attributes = path.join(fixture.workspaceRoot, ".gitattributes");
    await writeFile(attributes, "*.txt -text\n");
    await expect(
      manager.apply("thread_a", "run_a", attributePreview.id),
    ).rejects.toThrow("stale");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBeforeAttributes);
    await unlink(attributes);

    await git(fixture.workspaceRoot, [
      "config",
      "filter.leak.clean",
      "/usr/bin/git show HEAD:PRIVATE_TRACKED.txt",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", {
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
      "core.sharedRepository",
      "group",
    ]);
    await expect(
      manager.preview("thread_a", "run_a", {
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("unsafe execution configuration");
    await git(fixture.workspaceRoot, [
      "config",
      "--unset-all",
      "core.sharedRepository",
    ]);
    const indexBeforeMagic = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        path: ":(glob)*.txt",
      }),
    ).rejects.toThrow("stage preparation failed");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBeforeMagic);
    const alternates = path.join(
      fixture.workspaceRoot,
      ".git/objects/info/alternates",
    );
    await symlink(path.join(fixture.root, "missing-alternate"), alternates);
    await expect(
      manager.preview("thread_a", "run_a", {
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("object alternates are unsupported");
    await unlink(alternates);

    const outside = path.join(fixture.root, "PRIVATE_OUTSIDE.txt");
    await writeFile(outside, "PRIVATE_OUTSIDE\n");
    const linked = path.join(fixture.workspaceRoot, "PRIVATE_LINK.txt");
    await symlink(outside, linked);
    await expect(
      manager.preview("thread_a", "run_a", { path: "PRIVATE_LINK.txt" }),
    ).rejects.toThrow("bounded regular file");
    const outsideDirectory = path.join(fixture.root, "private-directory");
    await mkdir(outsideDirectory);
    await writeFile(
      path.join(outsideDirectory, "PRIVATE_NESTED.txt"),
      "PRIVATE_NESTED\n",
    );
    await symlink(
      outsideDirectory,
      path.join(fixture.workspaceRoot, "PRIVATE_DIRECTORY_LINK"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        path: "PRIVATE_DIRECTORY_LINK/PRIVATE_NESTED.txt",
      }),
    ).rejects.toThrow("ancestor is not canonical");
    await writeFile(
      path.join(fixture.workspaceRoot, ".git/index.lock"),
      "PRIVATE_LOCK\n",
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("active index lock");
  }, 30_000);

  it("atomically clears a conflict-to-HEAD beside a regular staged delta", async () => {
    const fixture = await createRepository();
    const companion = path.join(fixture.workspaceRoot, "PRIVATE_COMPANION.txt");
    await writeFile(companion, "PRIVATE_COMPANION_BEFORE\n");
    await git(fixture.workspaceRoot, ["add", "PRIVATE_COMPANION.txt"]);
    await commitAll(fixture.workspaceRoot, "companion");
    await createMergeConflict(fixture.workspaceRoot);
    const target = path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt");
    await writeFile(target, "PRIVATE_OURS\n");
    await writeFile(companion, "PRIVATE_COMPANION_AFTER\n");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "ls-files",
        "--unmerged",
        "--",
        "PRIVATE_TRACKED.txt",
      ]),
    ).not.toBe("");
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    const manager = managerFor(fixture, directSandbox());

    const preview = await manager.preview("thread_conflict", "run_conflict", {
      paths: ["PRIVATE_TRACKED.txt", "PRIVATE_COMPANION.txt"],
    });

    expect(preview.patch).toContain("GIT INDEX TRANSITION");
    expect(preview.patch).toContain("Before: unmerged stages 1,2,3");
    expect(preview.patch).toContain(
      "After: resolved index; staged tree matches HEAD",
    );
    expect(preview.patch).toContain("+PRIVATE_COMPANION_AFTER");
    expect(preview.details).toEqual(
      expect.objectContaining({
        fileCount: 2,
        hunkCount: 1,
        addedLineCount: 1,
        deletedLineCount: 1,
      }),
    );
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);

    const applied = await manager.apply(
      "thread_conflict",
      "run_conflict",
      preview.id,
    );

    expect(applied.details.status).toBe("applied");
    expect(applied.details.postcondition).toBe("verified");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "ls-files",
        "--unmerged",
        "--",
        "PRIVATE_TRACKED.txt",
      ]),
    ).toBe("");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "diff",
        "--cached",
        "--",
        "PRIVATE_TRACKED.txt",
      ]),
    ).toBe("");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "diff",
        "--cached",
        "--",
        "PRIVATE_COMPANION.txt",
      ]),
    ).toContain("+PRIVATE_COMPANION_AFTER");
    expect(await readFile(target, "utf8")).toBe("PRIVATE_OURS\n");
    expect(await readFile(companion, "utf8")).toBe("PRIVATE_COMPANION_AFTER\n");
  }, 30_000);

  it("bounds patch output and exposes medium-risk preview/apply effects", async () => {
    const fixture = await createRepository();
    const manager = managerFor(fixture, directSandbox());
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_TRACKED.txt"),
      `${"x".repeat(128 * 1024 + 1)}\n`,
    );
    const indexBefore = await sha256File(
      path.join(fixture.workspaceRoot, ".git/index"),
    );
    await expect(
      manager.preview("thread_a", "run_a", {
        path: "PRIVATE_TRACKED.txt",
      }),
    ).rejects.toThrow("bounded output limit");
    expect(
      await sha256File(path.join(fixture.workspaceRoot, ".git/index")),
    ).toBe(indexBefore);

    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "workspace",
        "git_stage_preview",
        { path: "src/a.ts" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "private-index Git stage preview",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "git_stage_preview",
        { paths: ["src/a.ts", "src/b.ts"] },
        workspace,
      ).allowed,
    ).toBe(true);
    expect(
      assessToolCall(
        "workspace",
        "git_stage_preview",
        { paths: ["src/a.ts", ".git/config"] },
        workspace,
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "git_stage_apply",
        {
          previewId: "gitstagepreview_12345678",
        },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "medium",
        reason: "fresh preview-bound atomic Git index update",
      }),
    );
    expect(
      assessToolCall(
        "observe",
        "git_stage_preview",
        { path: "src/a.ts" },
        workspace,
      ).allowed,
    ).toBe(false);
    expect(
      assessToolCall(
        "workspace",
        "git_stage_preview",
        { path: ".git/config" },
        workspace,
      ).allowed,
    ).toBe(false);
    expect(builtInToolEffect("git_stage_preview")).toBe("read");
    expect(builtInToolEffect("git_stage_apply")).toBe("write");
    expect(DEFAULT_AGENT_ENABLED_TOOLS).toEqual(
      expect.arrayContaining(["git_stage_preview", "git_stage_apply"]),
    );
    expect(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES).toEqual(
      expect.arrayContaining(["git_stage_preview", "git_stage_apply"]),
    );
  }, 30_000);
});

function managerFor(
  fixture: { root: string; workspaceRoot: string },
  sandbox: OsSandboxAdapter,
): GitStageMutationManager {
  return new GitStageMutationManager({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: path.join(fixture.root, "data"),
    sandbox,
  });
}

async function createRepository(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-git-stage-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([mkdir(workspaceRoot), mkdir(path.join(root, "data"))]);
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

async function createMergeConflict(workspaceRoot: string): Promise<void> {
  const sourceBranch = (
    await gitOutput(workspaceRoot, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["branch", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_OURS\n",
  );
  await commitAll(workspaceRoot, "ours");
  await git(workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_TRACKED.txt"),
    "PRIVATE_THEIRS\n",
  );
  await commitAll(workspaceRoot, "theirs");
  await git(workspaceRoot, ["checkout", "--quiet", sourceBranch]);
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
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  ).catch(() => undefined);
}

async function commitAll(
  workspaceRoot: string,
  message: string,
): Promise<void> {
  await git(workspaceRoot, ["add", "--all"]);
  await git(workspaceRoot, [
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
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout;
}

function directSandbox(): OsSandboxAdapter & {
  launches: SandboxLaunchRequest[];
} {
  const launches: SandboxLaunchRequest[] = [];
  return {
    id: "direct-git-stage-test",
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

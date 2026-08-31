import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseRebindWorkspaceRootRequest } from "../src/workspace-root-http-validation.js";
import {
  resolveRebindWorkspaceRoot,
  WorkspaceRebindRequestError,
  workspaceRebindBusyReasons,
} from "../src/workspace-rebind.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("parseRebindWorkspaceRootRequest", () => {
  it("accepts a string root and rejects malformed input", () => {
    expect(parseRebindWorkspaceRootRequest({ root: "/tmp/x" })).toEqual({
      root: "/tmp/x",
    });
    expect(parseRebindWorkspaceRootRequest({ root: 12 })).toBeUndefined();
    expect(parseRebindWorkspaceRootRequest({})).toBeUndefined();
    expect(
      parseRebindWorkspaceRootRequest({ root: "/tmp/x", extra: 1 }),
    ).toBeUndefined();
    expect(parseRebindWorkspaceRootRequest("nope")).toBeUndefined();
  });
});

describe("resolveRebindWorkspaceRoot", () => {
  it("canonicalizes an existing directory and binds the realpath for symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-rebind-"));
    temporaryRoots.push(root);
    const target = path.join(root, "real-project");
    const link = path.join(root, "linked-project");
    await mkdir(target);
    await symlink(target, link);

    const resolved = await resolveRebindWorkspaceRoot(link);
    expect(resolved).toBe(await realpath(target));
  });

  it("rejects relative and missing inputs but accepts an existing root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-rebind-"));
    temporaryRoots.push(root);

    await expect(
      resolveRebindWorkspaceRoot("relative/path"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      resolveRebindWorkspaceRoot(12),
    ).rejects.toBeInstanceOf(WorkspaceRebindRequestError);
    await expect(
      resolveRebindWorkspaceRoot(path.join(root, "nope")),
    ).rejects.toMatchObject({ status: 404 });
    await expect(resolveRebindWorkspaceRoot(root)).resolves.toBe(
      await realpath(root),
    );
  });

  it("preserves a legal trailing space in the selected directory name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-rebind-"));
    temporaryRoots.push(root);
    const spaced = path.join(root, "project ");
    const unspaced = path.join(root, "project");
    await Promise.all([mkdir(spaced), mkdir(unspaced)]);

    await expect(resolveRebindWorkspaceRoot(spaced)).resolves.toBe(
      await realpath(spaced),
    );
  });
});

describe("workspaceRebindBusyReasons", () => {
  it("is empty when idle and non-empty when a run is queued or running", () => {
    const idle = {
      listThreads: () => [{ id: "thread_a" }] as never,
      listRuns: () => [{ status: "completed" }] as never,
    };
    expect(workspaceRebindBusyReasons(idle)).toEqual([]);

    const busy = {
      listThreads: () => [{ id: "thread_a" }, { id: "thread_b" }] as never,
      listRuns: (threadId: string) =>
        (threadId === "thread_b"
          ? [{ status: "running" }]
          : [{ status: "completed" }]) as never,
    };
    const reasons = workspaceRebindBusyReasons(busy);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("thread_b");
  });
});

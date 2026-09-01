import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withWorkspacePathLock } from "../src/workspace-write-lock.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace write locks", () => {
  it("recovers an old incomplete lock left by a terminated process", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "workspace.json");
    const lockPath = await writeIncompleteLock(root, target);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    let entered = false;
    await withWorkspacePathLock(root, target, async () => {
      entered = true;
    });

    expect(entered).toBe(true);
  });

  it("does not steal a recent incomplete lock", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "workspace.json");
    await writeIncompleteLock(root, target);

    await expect(
      withWorkspacePathLock(root, target, async () => undefined),
    ).rejects.toThrow("target is already being edited");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-write-lock-"));
  temporaryRoots.push(root);
  return root;
}

async function writeIncompleteLock(
  root: string,
  target: string,
): Promise<string> {
  const locksRoot = path.join(root, "file-edit-locks");
  await mkdir(locksRoot, { recursive: true });
  const resolved = path.resolve(target);
  const identity =
    process.platform === "darwin" || process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;
  const lockPath = path.join(
    locksRoot,
    `${createHash("sha256").update(identity).digest("hex")}.lock`,
  );
  await writeFile(lockPath, "", "utf8");
  return lockPath;
}

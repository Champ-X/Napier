import { execFile as execFileWithCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { requireReleaseSourceAncestor } from "./s1-completion-source-authority.mjs";

const execFile = promisify(execFileWithCallback);
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S1 completion release source authority", () => {
  it("accepts the same exact source without invoking Git history", async () => {
    await expect(
      requireReleaseSourceAncestor(
        "/missing/repository",
        "a".repeat(40),
        "a".repeat(40),
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts an ancestor and rejects a sibling commit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-s1-source-"));
    roots.push(root);
    await git(root, ["init", "--quiet", "--initial-branch=main"]);
    await git(root, [
      "-c",
      "user.name=Napier",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const base = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["branch", "sibling"]);
    await git(root, [
      "-c",
      "user.name=Napier",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "main",
    ]);
    const main = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["checkout", "--quiet", "sibling"]);
    await git(root, [
      "-c",
      "user.name=Napier",
      "-c",
      "user.email=napier@example.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "sibling",
    ]);
    const sibling = await git(root, ["rev-parse", "HEAD"]);

    await expect(
      requireReleaseSourceAncestor(root, base, main),
    ).resolves.toBeUndefined();
    await expect(
      requireReleaseSourceAncestor(root, sibling, main),
    ).rejects.toThrow("not an ancestor");
  });
});

async function git(root, args) {
  const { stdout } = await execFile("git", ["-C", root, ...args], {
    env: { LANG: "C", PATH: process.env.PATH ?? "" },
    timeout: 10_000,
  });
  return stdout.trim();
}

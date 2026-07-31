import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareNodePty } from "./prepare-node-pty.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("node-pty install preparation", () => {
  it("repairs only the current platform regular spawn helper", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-node-pty-"));
    temporaryRoots.push(root);
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    await mkdir(path.dirname(helper), { recursive: true });
    await writeFile(helper, "helper", { mode: 0o600 });

    await prepareNodePty(root, "darwin", "arm64");

    await expect(access(helper, constants.X_OK)).resolves.toBeUndefined();
    expect((await lstat(helper)).mode & 0o100).toBe(0o100);
  });

  it("rejects a symlink and a missing platform helper", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-node-pty-"));
    temporaryRoots.push(root);
    const target = path.join(root, "target");
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    await writeFile(target, "helper");
    await mkdir(path.dirname(helper), { recursive: true });
    await symlink(target, helper);

    await expect(prepareNodePty(root, "darwin", "arm64")).rejects.toThrow(
      "must be a regular file",
    );
    await rm(helper);
    await chmod(target, 0o600);
    await expect(prepareNodePty(root, "darwin", "arm64")).rejects.toThrow(
      "is unavailable",
    );
  });
});

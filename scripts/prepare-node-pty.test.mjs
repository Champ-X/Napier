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
  it("accepts the locked Linux platform binary without a compiler", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-node-pty-"));
    temporaryRoots.push(root);
    const binary = path.join(
      root,
      "@lydell/node-pty-linux-arm64/prebuilds/linux-arm64/pty.node",
    );
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, "binary");

    await expect(
      prepareNodePty(root, "linux", "arm64"),
    ).resolves.toBeUndefined();
  });

  it("repairs only the current Darwin platform spawn helper", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-node-pty-"));
    temporaryRoots.push(root);
    const platformRoot = path.join(
      root,
      "@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64",
    );
    const binary = path.join(platformRoot, "pty.node");
    const helper = path.join(platformRoot, "spawn-helper");
    await mkdir(platformRoot, { recursive: true });
    await writeFile(binary, "binary");
    await writeFile(helper, "helper", { mode: 0o600 });

    await prepareNodePty(root, "darwin", "arm64");

    await expect(access(helper, constants.X_OK)).resolves.toBeUndefined();
    expect((await lstat(helper)).mode & 0o100).toBe(0o100);
  });

  it("rejects a symlink and a missing platform binary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-node-pty-"));
    temporaryRoots.push(root);
    const target = path.join(root, "target");
    const binary = path.join(
      root,
      "@lydell/node-pty-linux-arm64/prebuilds/linux-arm64/pty.node",
    );
    await writeFile(target, "binary");
    await mkdir(path.dirname(binary), { recursive: true });
    await symlink(target, binary);

    await expect(prepareNodePty(root, "linux", "arm64")).rejects.toThrow(
      "must be a regular file",
    );
    await rm(binary);
    await expect(prepareNodePty(root, "linux", "arm64")).rejects.toThrow(
      "is unavailable",
    );
  });
});

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSubagentWorktreeToolchainStable,
  prepareSubagentWorktreeToolchain,
} from "../src/subagent-worktree-toolchain.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree toolchain", () => {
  it("links external dependencies and redirects workspace packages", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-subagent-toolchain-"),
    );
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const candidateRoot = path.join(root, "candidate");
    await Promise.all([
      mkdir(path.join(sourceRoot, "node_modules/external-package"), {
        recursive: true,
      }),
      mkdir(path.join(sourceRoot, "node_modules/@scope"), { recursive: true }),
      mkdir(path.join(sourceRoot, "packages/runtime"), { recursive: true }),
      mkdir(path.join(candidateRoot, "packages/runtime"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(sourceRoot, "node_modules/external-package/index.js"),
        "export {};\n",
      ),
      mkdir(path.join(sourceRoot, "node_modules/@scope/external"), {
        recursive: true,
      }),
      writeFile(
        path.join(candidateRoot, "packages/runtime/package.json"),
        "{}\n",
      ),
      symlink(
        "../../packages/runtime",
        path.join(sourceRoot, "node_modules/@scope/runtime"),
      ),
    ]);

    const toolchain = await prepareSubagentWorktreeToolchain({
      sourceRoot,
      candidateRoot,
    });

    expect(toolchain).toEqual(
      expect.objectContaining({
        externalLinkCount: 2,
        workspaceLinkCount: 1,
        scopeCount: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      await realpath(path.join(candidateRoot, "node_modules/external-package")),
    ).toBe(
      await realpath(path.join(sourceRoot, "node_modules/external-package")),
    );
    expect(
      await realpath(path.join(candidateRoot, "node_modules/@scope/runtime")),
    ).toBe(await realpath(path.join(candidateRoot, "packages/runtime")));
    await expect(
      assertSubagentWorktreeToolchainStable(toolchain!),
    ).resolves.toBeUndefined();

    await rm(path.join(sourceRoot, "node_modules/external-package"), {
      recursive: true,
    });
    await writeFile(
      path.join(sourceRoot, "node_modules/external-package"),
      "replaced by file\n",
    );
    await expect(
      assertSubagentWorktreeToolchainStable(toolchain!),
    ).rejects.toThrow("overlay target changed");
    await rm(path.join(sourceRoot, "node_modules/external-package"));
    await mkdir(path.join(sourceRoot, "node_modules/external-package"));

    await rm(path.join(candidateRoot, "node_modules/@scope/runtime"));
    await symlink(
      path.join(sourceRoot, "node_modules/@scope/external"),
      path.join(candidateRoot, "node_modules/@scope/runtime"),
    );
    await expect(
      assertSubagentWorktreeToolchainStable(toolchain!),
    ).rejects.toThrow("overlay target changed");
  });

  it("rejects dependency links that escape both workspace and node_modules", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-subagent-toolchain-"),
    );
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const candidateRoot = path.join(root, "candidate");
    const outside = path.join(root, "outside");
    await Promise.all([
      mkdir(path.join(sourceRoot, "node_modules"), { recursive: true }),
      mkdir(candidateRoot, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(path.join(sourceRoot, "node_modules/real-scope"), {
        recursive: true,
      }),
    ]);
    await writeFile(path.join(outside, "secret.txt"), "outside\n");
    await Promise.all([
      symlink(outside, path.join(sourceRoot, "node_modules/escape")),
      symlink(
        "real-scope",
        path.join(sourceRoot, "node_modules/@linked-scope"),
      ),
    ]);

    await expect(
      prepareSubagentWorktreeToolchain({ sourceRoot, candidateRoot }),
    ).rejects.toThrow("package scope is unsafe");
    await Promise.all([
      rm(path.join(sourceRoot, "node_modules/@linked-scope")),
      rm(path.join(candidateRoot, "node_modules"), {
        recursive: true,
        force: true,
      }),
    ]);

    await expect(
      prepareSubagentWorktreeToolchain({ sourceRoot, candidateRoot }),
    ).rejects.toThrow("escapes node_modules");
    await expect(
      readFile(path.join(candidateRoot, "node_modules/escape"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

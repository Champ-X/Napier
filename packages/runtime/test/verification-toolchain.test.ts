import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveVerificationToolchain } from "../src/verification-toolchain.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("verification toolchain resolution", () => {
  it("accepts root-confined package links and binds the resolved verifier", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-toolchain-"));
    roots.push(root);
    const packageRoot = path.join(root, "node_modules/.store/typescript");
    await mkdir(path.join(packageRoot, "bin"), { recursive: true });
    await writeFile(path.join(packageRoot, "bin/tsc"), "// verifier\n");
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await symlink(
      path.relative(path.join(root, "node_modules"), packageRoot),
      path.join(root, "node_modules/typescript"),
    );

    const binding = await resolveVerificationToolchain({
      workspaceRoot: root,
      verifierRelativePath: "node_modules/typescript/bin/tsc",
    });

    expect(binding.verifierPath).toBe(
      path.join(await realpath(packageRoot), "bin/tsc"),
    );
    expect(binding.verifierPathSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(binding.verifierSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a verifier link that resolves outside the toolchain root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-toolchain-"));
    const outside = await mkdtemp(path.join(tmpdir(), "napier-verifier-"));
    roots.push(root, outside);
    await mkdir(path.join(root, "node_modules/typescript/bin"), {
      recursive: true,
    });
    await writeFile(path.join(outside, "tsc"), "// outside\n");
    await symlink(
      path.join(outside, "tsc"),
      path.join(root, "node_modules/typescript/bin/tsc"),
    );

    await expect(
      resolveVerificationToolchain({
        workspaceRoot: root,
        verifierRelativePath: "node_modules/typescript/bin/tsc",
      }),
    ).rejects.toThrow("verifier must be a regular file");
  });
});

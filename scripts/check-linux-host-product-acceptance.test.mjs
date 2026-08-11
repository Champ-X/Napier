import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyLinuxHostProductAcceptance } from "./check-linux-host-product-acceptance.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Linux host product acceptance artifact", () => {
  it("accepts the current fresh Linux product receipt", async () => {
    await expect(verifyLinuxHostProductAcceptance()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/linux-host-product-acceptance-stage19.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects host, install, product, and scope tampering", async () => {
    for (const mutate of [
      (value) => {
        value.guest.host.containerized = true;
      },
      (value) => {
        value.guest.install.exitCode = 1;
      },
      (value) => {
        value.guest.product.doctor.warningCount = 1;
      },
      (value) => {
        value.scope.windowsHostProductAcceptance = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/linux-host-product-acceptance-stage19.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifyLinuxHostProductAcceptance({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Linux host product acceptance artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifyLinuxHostProductAcceptance({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-linux-host-artifact-"),
  );
  roots.push(root);
  for (const relative of [
    "docs/artifacts/linux-host-product-acceptance-stage19.json",
    "package-lock.json",
    "packages/runtime/src/project-skill-snapshot-acquisition.ts",
    "packages/runtime/src/project-skill-snapshot-anchor.ts",
    "packages/runtime/src/project-skill-snapshot-memory.ts",
    "packages/runtime/src/project-skill-snapshot-model.ts",
    "packages/runtime/src/project-skill-snapshot.ts",
    "packages/runtime/src/sandbox-terminal.ts",
    "scripts/check-linux-host-product-acceptance.mjs",
    "scripts/check-sandbox-product-acceptance.mjs",
    "scripts/linux-host-product-acceptance-artifact.mjs",
    "scripts/linux-host-product-acceptance-guest.mjs",
    "scripts/linux-host-product-acceptance-live.mjs",
    "scripts/prepare-node-pty.mjs",
    "scripts/prepare-node-pty.test.mjs",
    "scripts/sandbox-product-acceptance-artifact.mjs",
    "scripts/sandbox-product-acceptance-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

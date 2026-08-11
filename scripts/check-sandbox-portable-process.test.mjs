import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxPortableProcess } from "./check-sandbox-portable-process.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox portable process artifact", () => {
  it("accepts the current portable process receipt", async () => {
    await expect(verifySandboxPortableProcess()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-portable-process-stage15.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects root identity, Windows-host overclaim, and wildcard Git trust", async () => {
    for (const mutate of [
      (value) => {
        value.portableIdentity.nonRoot = false;
      },
      (value) => {
        value.scope.windowsHostExecuted = true;
      },
      (value) => {
        value.productionDogfood.git.wildcardSafeDirectory = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-portable-process-stage15.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxPortableProcess({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox portable process artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxPortableProcess({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-portable-artifact-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "docs/artifacts/sandbox-portable-process-stage15.json",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/git-inspect-process.ts",
    "packages/runtime/src/verification.ts",
    "scripts/check-sandbox-image-sbom.mjs",
    "scripts/check-sandbox-portable-process.mjs",
    "scripts/sandbox-portable-process-artifact.mjs",
    "scripts/sandbox-portable-process-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

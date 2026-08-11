import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxSecurityCasebook } from "./check-sandbox-security-casebook.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox security Casebook artifact", () => {
  it("accepts the current hash-bound 11-case receipt", async () => {
    await expect(verifySandboxSecurityCasebook()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-security-casebook-stage12.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects a rehashed pass, implementation drift, and completion overclaim", async () => {
    for (const mutate of [
      (value) => {
        value.cases[0].status = "failed";
      },
      (value) => {
        value.implementation.liveHarnessSha256 = "0".repeat(64);
      },
      (value) => {
        value.scope.s1Complete = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-security-casebook-stage12.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxSecurityCasebook({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox security Casebook artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxSecurityCasebook({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-security-artifact-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "docs/artifacts/sandbox-security-casebook-stage12.json",
    "packages/runtime/src/command-execution.ts",
    "packages/runtime/src/sandboxed-process.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "scripts/check-sandbox-security-casebook.mjs",
    "scripts/sandbox-security-casebook-artifact.mjs",
    "scripts/sandbox-security-casebook-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxPortableLsp } from "./check-sandbox-portable-lsp.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox portable LSP artifact", () => {
  it("accepts the current portable LSP parity receipt", async () => {
    await expect(verifySandboxPortableLsp()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-portable-lsp-stage16.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects parity drift, protocol escape acceptance, and DAP overclaim", async () => {
    for (const mutate of [
      (value) => {
        value.productionParity.diagnostics.equal = false;
      },
      (value) => {
        value.protocolBinding.escapeRejected = false;
      },
      (value) => {
        value.scope.portableDapComplete = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-portable-lsp-stage16.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxPortableLsp({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox portable LSP artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxPortableLsp({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-portable-lsp-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "docs/artifacts/sandbox-portable-lsp-stage16.json",
    "packages/runtime/src/sandbox-types.ts",
    "packages/runtime/src/sandbox-container-lsp-runtime.ts",
    "packages/runtime/src/lsp-runtime-assets.ts",
    "packages/runtime/src/lsp-protocol-path-binding.ts",
    "packages/runtime/src/lsp-protocol-session.ts",
    "packages/runtime/src/lsp-source-session.ts",
    "packages/runtime/src/lsp-persistent-session.ts",
    "packages/runtime/src/lsp-persistent-session-binding.ts",
    "packages/runtime/src/lsp-locations.ts",
    "scripts/check-sandbox-image-sbom.mjs",
    "scripts/check-sandbox-portable-lsp.mjs",
    "scripts/sandbox-portable-lsp-artifact.mjs",
    "scripts/sandbox-portable-lsp-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

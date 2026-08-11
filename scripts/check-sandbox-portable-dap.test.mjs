import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxPortableDap } from "./check-sandbox-portable-dap.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox portable DAP artifact", () => {
  it("accepts the current portable debugger parity receipt", async () => {
    await expect(verifySandboxPortableDap()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-portable-dap-stage17.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects parity drift, root drift, and Windows-host overclaim", async () => {
    for (const mutate of [
      (value) => {
        value.productionParity.frameProjectionEqual = false;
      },
      (value) => {
        value.protocolBinding.protocolWorkspaceRoot = "/other";
      },
      (value) => {
        value.scope.windowsHostExecuted = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-portable-dap-stage17.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxPortableDap({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox portable DAP artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxPortableDap({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-portable-dap-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "docs/artifacts/sandbox-portable-dap-stage17.json",
    "packages/runtime/src/sandbox-types.ts",
    "packages/runtime/src/sandbox-container-node-debugger-runtime.ts",
    "packages/runtime/src/node-debugger-runtime.ts",
    "packages/runtime/src/node-debugger-protocol-path-binding.ts",
    "packages/runtime/src/node-debugger.ts",
    "packages/runtime/src/node-debugger-worker.ts",
    "packages/runtime/src/node-debugger-source-map-worker.ts",
    "scripts/check-sandbox-image-sbom.mjs",
    "scripts/check-sandbox-portable-dap.mjs",
    "scripts/sandbox-portable-dap-artifact.mjs",
    "scripts/sandbox-portable-dap-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxAcquisition } from "./check-sandbox-acquisition.mjs";
import { ensurePinnedRegistryImage } from "./sandbox-acquisition-acceptance.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox acquisition artifact", () => {
  it("reuses the exact pinned registry fixture when it is already local", async () => {
    const calls = [];
    await ensurePinnedRegistryImage("docker", {}, async (...args) => {
      calls.push(args);
      return "present";
    });

    expect(calls).toEqual([
      [
        "docker",
        [
          "image",
          "inspect",
          "registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373",
        ],
        {},
      ],
    ]);
  });

  it("pulls the exact pinned registry fixture when it is absent", async () => {
    const calls = [];
    await ensurePinnedRegistryImage("docker", {}, async (...args) => {
      calls.push(args);
      if (args[1][0] === "image") throw new Error("not present");
      return "pulled";
    });

    expect(calls.at(-1)).toEqual([
      "docker",
      [
        "pull",
        "registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373",
      ],
      {},
      5 * 60_000,
    ]);
  });

  it("accepts the current real Docker acquisition receipt", async () => {
    await expect(verifySandboxAcquisition()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-acquisition-stage20.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects pull, fallback, cleanup, retention, and scope tampering", async () => {
    for (const mutate of [
      (value) => {
        value.localAnonymous.action = "built";
      },
      (value) => {
        value.privateFallback.releaseProvenanceRetained = true;
      },
      (value) => {
        value.privateFallback.candidateContextSha256 = "0".repeat(64);
      },
      (value) => {
        value.resourceClosure.allVolumeDeltaCount = 1;
      },
      (value) => {
        value.retention.registryEndpoints = true;
      },
      (value) => {
        value.scope.publicExternalReleaseAccepted = true;
      },
      (value) => {
        value.localAnonymous.privatePath = "/private/path";
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-acquisition-stage20.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxAcquisition({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox acquisition artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxAcquisition({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sandbox-acquisition-artifact-"),
  );
  roots.push(root);
  for (const relative of [
    "docs/artifacts/sandbox-acquisition-stage20.json",
    "packages/contracts/src/sandbox-setup.ts",
    "packages/runtime/src/sandbox-official-release-model.ts",
    "packages/runtime/src/sandbox-official-release.ts",
    "packages/runtime/src/sandbox-runtime-acquisition.ts",
    "packages/runtime/src/sandbox-runtime-setup.ts",
    "packages/runtime/src/sandbox-setup-service.ts",
    "packages/runtime/src/sandbox-setup-verification.ts",
    "packages/runtime/src/sandbox-installation.ts",
    "apps/cli/src/sandbox-runtime-setup-cli.ts",
    "apps/web/src/SandboxSetupCard.tsx",
    "apps/web/src/sandbox-setup-view-model.ts",
    "scripts/copy-sandbox-image.mjs",
    "scripts/sandbox-acquisition-acceptance.mjs",
    "scripts/sandbox-acquisition-support.mjs",
    "scripts/sandbox-acquisition-artifact.mjs",
    "scripts/check-sandbox-acquisition.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

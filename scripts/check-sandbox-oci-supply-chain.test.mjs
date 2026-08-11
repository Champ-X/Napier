import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxOciSupplyChain } from "./check-sandbox-oci-supply-chain.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox OCI supply-chain artifact", () => {
  it("accepts the current local OCI publication receipt", async () => {
    await expect(verifySandboxOciSupplyChain()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-oci-supply-chain-stage18.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects index, signature, attestation, and scope tampering", async () => {
    for (const mutate of [
      (value) => {
        value.publication.imageIndexDigest = `sha256:${"0".repeat(64)}`;
      },
      (value) => {
        value.signing.signature = `${value.signing.signature.slice(0, -1)}A`;
      },
      (value) => {
        value.attestation.envelope.payload = `${value.attestation.envelope.payload.slice(0, -1)}A`;
      },
      (value) => {
        value.scope.externalRegistryPublished = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-oci-supply-chain-stage18.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxOciSupplyChain({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox OCI supply-chain artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxOciSupplyChain({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-supply-chain-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-oci-supply-chain-stage18.json",
    "scripts/check-sandbox-image-sbom.mjs",
    "scripts/check-sandbox-oci-supply-chain.mjs",
    "scripts/sandbox-oci-supply-chain-artifact.mjs",
    "scripts/sandbox-oci-supply-chain-live.mjs",
    "scripts/sandbox-oci-layout-verification.mjs",
    "scripts/sandbox-oci-signing.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

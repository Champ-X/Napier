import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyOciCrashRecoveryArtifact } from "./check-oci-crash-recovery.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI crash recovery artifact", () => {
  it("accepts the hash-bound current implementation and provenance", async () => {
    await expect(verifyOciCrashRecoveryArtifact()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/oci-crash-recovery-stage11.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects tampered endpoints, implementation bindings, and scope claims", async () => {
    for (const mutate of [
      (value) => {
        value.cycles[1].endpointSha256 = value.cycles[0].endpointSha256;
      },
      (value) => {
        value.implementation.guardianWorkerSha256 = "0".repeat(64);
      },
      (value) => {
        value.scope.s1Complete = true;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/oci-crash-recovery-stage11.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifyOciCrashRecoveryArtifact({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /OCI crash recovery artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifyOciCrashRecoveryArtifact({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-crash-artifact-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/oci-crash-recovery-stage11.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "packages/runtime/src/process-guardian.ts",
    "packages/runtime/src/process-guardian-worker-source.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "scripts/check-oci-crash-recovery.mjs",
    "scripts/oci-crash-recovery-artifact.mjs",
    "scripts/oci-crash-recovery-fixture.mjs",
    "scripts/oci-crash-recovery-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

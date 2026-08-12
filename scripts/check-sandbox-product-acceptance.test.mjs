import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifySandboxProductAcceptance } from "./check-sandbox-product-acceptance.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox product acceptance artifact", () => {
  it("accepts the current hash-bound default-product receipt", async () => {
    await expect(verifySandboxProductAcceptance()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        path: "docs/artifacts/sandbox-product-acceptance-stage13.json",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects verifier failure, stale output, and S1 completion overclaim", async () => {
    for (const mutate of [
      (value) => {
        value.verification.typecheck.status = "failed";
      },
      (value) => {
        value.restart.staleOutputExposed = true;
      },
      (value) => {
        value.scope.s1Complete = true;
      },
      (value) => {
        value.firstUse.profile.revisionCountAfter = 2;
      },
      (value) => {
        value.firstUse.workspacePath = "/private/workspace";
      },
      (value) => {
        value.invalidBindingRepair.profile.revisionCountAfter = 3;
      },
      (value) => {
        value.invalidBindingRepair.privatePath = "/private/state";
      },
      (value) => {
        value.imageRepair.repair.action = "reused";
      },
      (value) => {
        value.imageRepair.resourceClosure.imageDeltaCount = 1;
      },
    ]) {
      const root = await fixtureRoot();
      const artifactPath = path.join(
        root,
        "docs/artifacts/sandbox-product-acceptance-stage13.json",
      );
      const value = JSON.parse(await readFile(artifactPath, "utf8"));
      mutate(value);
      await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`);

      await expect(
        verifySandboxProductAcceptance({ repoRoot: root }),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            expect.stringMatching(
              /Sandbox product acceptance artifact (?:shape|content hash) is invalid/u,
            ),
          ]),
        }),
      );
    }
  });

  it("rejects artifact paths outside the repository", async () => {
    await expect(
      verifySandboxProductAcceptance({ artifactPath: "../outside.json" }),
    ).rejects.toThrow("artifact path must remain inside the repository");
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-product-artifact-"));
  roots.push(root);
  for (const relative of [
    "docker/napier-sandbox/Dockerfile",
    "docker/napier-sandbox/package.json",
    "docker/napier-sandbox/package-lock.json",
    "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json",
    "docs/artifacts/sandbox-image-provenance-0.1.0.json",
    "docs/artifacts/sandbox-product-acceptance-stage13.json",
    "apps/cli/src/cli.ts",
    "apps/cli/src/cli-run-readiness.ts",
    "apps/cli/src/cli-public-error.ts",
    "apps/cli/src/sandbox-runtime-setup-cli.ts",
    "apps/server/src/thread-run-readiness.ts",
    "apps/web/src/composer-mode-view-model.ts",
    "apps/web/src/ComposerCapabilityControl.tsx",
    "apps/web/src/SandboxSetupCard.tsx",
    "apps/web/src/sandbox-setup-view-model.ts",
    "packages/contracts/src/sandbox-setup.ts",
    "packages/contracts/src/agent-capabilities.ts",
    "packages/runtime/src/agent-capability-runtime.ts",
    "packages/runtime/src/agent-runtime.ts",
    "packages/runtime/src/process-run-readiness.ts",
    "packages/runtime/src/sandbox-setup-service.ts",
    "packages/runtime/src/sandbox-runtime-setup.ts",
    "packages/runtime/src/sandbox-runtime-acquisition.ts",
    "packages/runtime/src/sandbox-official-release.ts",
    "packages/runtime/src/sandbox-official-release-model.ts",
    "packages/runtime/src/sandbox-setup-verification.ts",
    "packages/runtime/src/sandbox-installation.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    "packages/runtime/src/verification-runtime.ts",
    "packages/runtime/src/verification.ts",
    "packages/runtime/src/workspace-processes.ts",
    "scripts/check-sandbox-product-acceptance.mjs",
    "scripts/sandbox-first-use-coding-acceptance.mjs",
    "scripts/sandbox-first-use-coding-support.mjs",
    "scripts/sandbox-invalid-binding-repair-acceptance.mjs",
    "scripts/sandbox-invalid-binding-repair-artifact.mjs",
    "scripts/sandbox-image-repair-acceptance.mjs",
    "scripts/sandbox-image-repair-artifact.mjs",
    "scripts/sandbox-product-acceptance-artifact.mjs",
    "scripts/sandbox-product-acceptance-live.mjs",
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
  }
  return root;
}

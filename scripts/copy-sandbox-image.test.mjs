import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copySandboxImageAsset } from "./copy-sandbox-image.mjs";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox image build asset", () => {
  it("copies the pinned Dockerfile into the Runtime dist package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-asset-"));
    roots.push(root);
    await mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true });
    const files = {
      Dockerfile: "FROM scratch\n",
      "package.json": '{"name":"sandbox"}\n',
      "package-lock.json": '{"lockfileVersion":3}\n',
    };
    await Promise.all(
      Object.entries(files).map(([fileName, content]) =>
        writeFile(path.join(root, "docker/napier-sandbox", fileName), content),
      ),
    );

    await copySandboxImageAsset(root);

    for (const [fileName, content] of Object.entries(files)) {
      await expect(
        readFile(
          path.join(root, "packages/runtime/dist/sandbox-image", fileName),
          "utf8",
        ),
      ).resolves.toBe(content);
    }
    await expect(
      readFile(
        path.join(
          root,
          "packages/runtime/dist/sandbox-image/external-publication.json",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("copies a retained external release receipt and removes stale packaged bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-sandbox-asset-"));
    roots.push(root);
    await Promise.all([
      mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true }),
      mkdir(path.join(root, "docs/artifacts"), { recursive: true }),
      mkdir(path.join(root, "packages/runtime/dist/sandbox-image"), {
        recursive: true,
      }),
    ]);
    for (const [fileName, content] of Object.entries({
      Dockerfile: "FROM scratch\n",
      "package.json": '{"name":"sandbox"}\n',
      "package-lock.json": '{"lockfileVersion":3}\n',
    })) {
      await writeFile(
        path.join(root, "docker/napier-sandbox", fileName),
        content,
      );
    }
    const release = `${JSON.stringify(
      releaseReceipt((await sandboxImageSourceEvidence(root)).contextSha256),
      null,
      2,
    )}\n`;
    await writeFile(
      path.join(root, "docs/artifacts/sandbox-external-publication-0.1.0.json"),
      release,
    );
    const destination = path.join(
      root,
      "packages/runtime/dist/sandbox-image/external-publication.json",
    );
    await writeFile(destination, "stale\n");

    await copySandboxImageAsset(root);
    await expect(readFile(destination, "utf8")).resolves.toBe(release);

    await rm(
      path.join(root, "docs/artifacts/sandbox-external-publication-0.1.0.json"),
    );
    await copySandboxImageAsset(root);
    await expect(readFile(destination, "utf8")).rejects.toThrow();
  });
});

function releaseReceipt(contextSha256) {
  const withoutHash = {
    kind: "napier.sandbox-external-publication",
    schemaVersion: 1,
    generatedAt: "2026-08-12T00:00:00.000Z",
    repository: "Champ-X/Napier",
    workflow: ".github/workflows/publish-sandbox.yml",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    sourceSha: "b".repeat(40),
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest: `sha256:${"d".repeat(64)}`,
    platforms: ["linux/amd64", "linux/arm64"],
    contextSha256,
    remoteIndex: {
      sha256: "1".repeat(64),
      byteCount: 100,
      attestationDescriptorCount: 2,
    },
    buildkitAttestations: {
      sha256: "2".repeat(64),
      predicateCount: 2,
      sbomPredicateVerified: true,
      provenancePredicateVerified: true,
    },
    anonymousPullAndExecution: true,
    anonymousPlatforms: { sha256: "3".repeat(64), platformCount: 2 },
    cosign: {
      algorithm: "keyless-oidc",
      verified: true,
      transparencyLogVerified: true,
      bundleSha256: "4".repeat(64),
      verificationSha256: "5".repeat(64),
      transparencyEntryCount: 1,
    },
    externalAttestation: {
      predicateType: "https://slsa.dev/provenance/v1",
      verified: true,
      registryStored: true,
      transparencyLogVerified: true,
      predicateSha256: "6".repeat(64),
      bundleSha256: "7".repeat(64),
      verificationSha256: "8".repeat(64),
      verificationCount: 1,
      transparencyEntryCount: 1,
    },
    retention: {
      credentialValues: false,
      rawWorkflowLog: false,
      rawDockerOutput: false,
      imageBytes: false,
      workspacePaths: false,
    },
    scope: {
      externalRegistryPublished: true,
      releaseSigningIdentity: true,
      transparencyLogRecorded: true,
      externalAttestation: true,
      windowsHostProductAcceptance: false,
      s1Complete: false,
    },
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

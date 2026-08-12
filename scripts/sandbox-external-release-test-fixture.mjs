import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import { writeSandboxExternalPublicationReceipt } from "./sandbox-external-publication-evidence.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";
import { createS1UpstreamRunAuthority } from "./s1-upstream-run-authority.mjs";

export const TEST_EXTERNAL_RELEASE_SOURCE_SHA = "a".repeat(40);

export async function writeSandboxExternalReleaseTestFixture(repoRoot) {
  const evidenceDir = path.join(repoRoot, "evidence");
  const authorityPath = path.join(repoRoot, "authority.json");
  await Promise.all([
    mkdir(path.join(repoRoot, "docker/napier-sandbox"), { recursive: true }),
    mkdir(evidenceDir, { recursive: true }),
  ]);
  for (const name of ["Dockerfile", "package.json", "package-lock.json"]) {
    await writeFile(
      path.join(repoRoot, "docker/napier-sandbox", name),
      await readFile(path.resolve("docker/napier-sandbox", name)),
    );
  }
  const contextSha256 = (await sandboxImageSourceEvidence(repoRoot))
    .contextSha256;
  const index = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      descriptor("linux", "amd64", "1"),
      descriptor("linux", "arm64", "2"),
      descriptor("unknown", "unknown", "3"),
      descriptor("unknown", "unknown", "4"),
    ],
  };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const digest = `sha256:${sha256(indexBytes)}`;
  const predicate = externalPredicate(contextSha256);
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: "ghcr.io/champ-x/napier-sandbox",
        digest: { sha256: digest.slice("sha256:".length) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate,
  };
  const files = {
    "remote-index.json": indexBytes,
    "buildkit-attestation-predicates.jsonl":
      `${JSON.stringify("https://spdx.dev/Document")}\n` +
      `${JSON.stringify("https://slsa.dev/provenance/v1")}\n`,
    "anonymous-platforms.jsonl":
      `${JSON.stringify(externalPlatform("linux/amd64", contextSha256))}\n` +
      `${JSON.stringify(externalPlatform("linux/arm64", contextSha256))}\n`,
    "cosign.bundle.json": JSON.stringify({
      verificationMaterial: { tlogEntries: [{ logIndex: "1" }] },
    }),
    "cosign.verify.json": JSON.stringify([
      {
        critical: { image: { "docker-manifest-digest": digest } },
        optional: { "source-sha": TEST_EXTERNAL_RELEASE_SOURCE_SHA },
      },
    ]),
    "slsa-provenance-v1.json": JSON.stringify(predicate),
    "cosign-attestation.bundle.json": JSON.stringify({
      verificationMaterial: { tlogEntries: [{ logIndex: "2" }] },
    }),
    "cosign-attestation.verify.json": JSON.stringify([
      { payload: Buffer.from(JSON.stringify(statement)).toString("base64") },
    ]),
  };
  await Promise.all(
    Object.entries(files).map(([name, value]) =>
      writeFile(path.join(evidenceDir, name), value),
    ),
  );
  await writeSandboxExternalPublicationReceipt(evidenceDir, {
    GITHUB_REPOSITORY: "Champ-X/Napier",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
    IMAGE_NAME: "ghcr.io/champ-x/napier-sandbox",
    VERSION: "0.1.0",
    DIGEST: digest,
    CONTEXT_SHA256: contextSha256,
  });
  const authority = createS1UpstreamRunAuthority({
    authority: "external_publication",
    sourceSha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
    expectedRunId: "123",
    run: {
      id: 123,
      run_attempt: 1,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      head_sha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
      path: ".github/workflows/publish-sandbox.yml",
      updated_at: "2026-08-12T00:00:00.000Z",
      repository: { id: 42, full_name: "Champ-X/Napier" },
      head_repository: { id: 42, full_name: "Champ-X/Napier" },
    },
    artifacts: {
      total_count: 1,
      artifacts: [
        {
          id: 456,
          name: `sandbox-external-publication-${TEST_EXTERNAL_RELEASE_SOURCE_SHA}`,
          expired: false,
          size_in_bytes: 1024,
          workflow_run: {
            id: 123,
            head_branch: "main",
            head_sha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
            repository_id: 42,
            head_repository_id: 42,
          },
        },
      ],
    },
  });
  await writeFile(authorityPath, `${JSON.stringify(authority)}\n`);
  return {
    repoRoot,
    evidenceDir,
    authorityPath,
    sourceSha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
    expectedRunId: "123",
    contextSha256,
  };
}

function descriptor(os, architecture, digit) {
  return {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${digit.repeat(64)}`,
    size: 123,
    platform: { os, architecture },
  };
}

function externalPlatform(platform, contextSha256) {
  return {
    platform,
    anonymousPull: true,
    executed: true,
    contextSha256,
    sourceSha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
    nodeVersion: "v24.16.0",
  };
}

function externalPredicate(contextSha256) {
  return {
    buildDefinition: {
      buildType: "https://napier.local/github-actions/sandbox-oci/v1",
      externalParameters: {
        repository: "Champ-X/Napier",
        sourceSha: TEST_EXTERNAL_RELEASE_SOURCE_SHA,
        platforms: ["linux/amd64", "linux/arm64"],
        contextSha256,
      },
      internalParameters: {
        workflow: ".github/workflows/publish-sandbox.yml",
        releaseGate: "npm run check",
      },
      resolvedDependencies: [],
    },
    runDetails: {
      builder: {
        id: "https://github.com/Champ-X/Napier/actions/runs/123/attempts/1",
      },
      metadata: {
        invocationId:
          "https://github.com/Champ-X/Napier/actions/runs/123/attempts/1",
      },
      byproducts: [],
    },
  };
}

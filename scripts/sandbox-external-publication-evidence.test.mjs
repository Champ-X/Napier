import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  verifySandboxExternalPublicationEvidence,
  writeSandboxExternalPublicationReceipt,
} from "./sandbox-external-publication-evidence.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox external publication evidence", () => {
  it("writes and replays a bounded external release receipt", async () => {
    const fixture = await evidenceFixture();
    const receipt = await writeSandboxExternalPublicationReceipt(
      fixture.root,
      environment(fixture.digest),
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: "napier.sandbox-external-publication",
        digest: fixture.digest,
        anonymousPullAndExecution: true,
        cosign: expect.objectContaining({
          verified: true,
          transparencyLogVerified: true,
          transparencyEntryCount: 1,
        }),
        externalAttestation: expect.objectContaining({
          verified: true,
          registryStored: true,
          transparencyLogVerified: true,
          verificationCount: 1,
        }),
        scope: {
          externalRegistryPublished: true,
          releaseSigningIdentity: true,
          transparencyLogRecorded: true,
          externalAttestation: true,
          windowsHostProductAcceptance: false,
          s1Complete: false,
        },
      }),
    );
    await expect(
      verifySandboxExternalPublicationEvidence(fixture.root),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        errors: [],
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects index, anonymous platform, and transparency tampering", async () => {
    for (const mutate of [
      async (root) => {
        const file = path.join(root, "remote-index.json");
        const value = JSON.parse(await readFile(file, "utf8"));
        value.manifests[0].platform.architecture = "386";
        await writeFile(file, JSON.stringify(value));
      },
      async (root) => {
        const file = path.join(root, "anonymous-platforms.jsonl");
        const lines = (await readFile(file, "utf8")).trim().split("\n");
        const value = JSON.parse(lines[0]);
        value.anonymousPull = false;
        lines[0] = JSON.stringify(value);
        await writeFile(file, `${lines.join("\n")}\n`);
      },
      async (root) => {
        const file = path.join(root, "cosign.bundle.json");
        await writeFile(
          file,
          JSON.stringify({ verificationMaterial: { tlogEntries: [] } }),
        );
      },
    ]) {
      const fixture = await evidenceFixture();
      await writeSandboxExternalPublicationReceipt(
        fixture.root,
        environment(fixture.digest),
      );
      await mutate(fixture.root);

      await expect(
        verifySandboxExternalPublicationEvidence(fixture.root),
      ).resolves.toEqual(
        expect.objectContaining({
          valid: false,
          errors: expect.arrayContaining([
            "external publication evidence does not match its files",
          ]),
        }),
      );
    }
  });

  it("rejects scope overclaims even when the receipt is rehashed", async () => {
    const fixture = await evidenceFixture();
    await writeSandboxExternalPublicationReceipt(
      fixture.root,
      environment(fixture.digest),
    );
    const receiptPath = path.join(
      fixture.root,
      "external-publication-receipt.json",
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.scope.windowsHostProductAcceptance = true;
    const { contentSha256: _contentSha256, ...content } = receipt;
    receipt.contentSha256 = sha256(canonicalJson(content));
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const result = await verifySandboxExternalPublicationEvidence(fixture.root);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "external publication receipt shape is invalid",
    );
  });
});

async function evidenceFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-external-publication-"),
  );
  roots.push(root);
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
  await writeFile(path.join(root, "remote-index.json"), indexBytes);
  await writeFile(
    path.join(root, "buildkit-attestation-predicates.jsonl"),
    ["https://spdx.dev/Document", "https://slsa.dev/provenance/v1"]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(root, "anonymous-platforms.jsonl"),
    [platform("linux/amd64"), platform("linux/arm64")]
      .map(JSON.stringify)
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(root, "cosign.bundle.json"),
    JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      verificationMaterial: { tlogEntries: [{ logIndex: "1" }] },
    }),
  );
  await writeFile(
    path.join(root, "cosign.verify.json"),
    JSON.stringify([
      {
        critical: { image: { "docker-manifest-digest": digest } },
        optional: { "source-sha": "b".repeat(40) },
      },
    ]),
  );
  await writeFile(
    path.join(root, "slsa-provenance-v1.json"),
    JSON.stringify(predicate()),
  );
  await writeFile(
    path.join(root, "cosign-attestation.bundle.json"),
    JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      verificationMaterial: { tlogEntries: [{ logIndex: "2" }] },
    }),
  );
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: "ghcr.io/champ-x/napier-sandbox",
        digest: { sha256: digest.slice("sha256:".length) },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: predicate(),
  };
  await writeFile(
    path.join(root, "cosign-attestation.verify.json"),
    JSON.stringify([
      {
        payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
      },
    ]),
  );
  return { root, digest };
}

function descriptor(os, architecture, digit) {
  return {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${digit.repeat(64)}`,
    size: 123,
    platform: { os, architecture },
  };
}

function platform(platformName) {
  return {
    platform: platformName,
    anonymousPull: true,
    executed: true,
    contextSha256: "a".repeat(64),
    sourceSha: "b".repeat(40),
    nodeVersion: "v24.16.0",
  };
}

function predicate() {
  return {
    buildDefinition: {
      buildType: "https://napier.local/github-actions/sandbox-oci/v1",
      externalParameters: {
        repository: "Champ-X/Napier",
        sourceSha: "b".repeat(40),
        platforms: ["linux/amd64", "linux/arm64"],
        contextSha256: "a".repeat(64),
      },
      internalParameters: {
        workflow: ".github/workflows/publish-sandbox.yml",
        releaseGate: "npm run check",
      },
      resolvedDependencies: [],
    },
    runDetails: {
      builder: {
        id: "https://github.com/Champ-X/Napier/actions/runs/123456/attempts/1",
      },
      metadata: {
        invocationId:
          "https://github.com/Champ-X/Napier/actions/runs/123456/attempts/1",
        startedOn: null,
        finishedOn: null,
      },
      byproducts: [],
    },
  };
}

function environment(digest) {
  return {
    GITHUB_REPOSITORY: "Champ-X/Napier",
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: "b".repeat(40),
    IMAGE_NAME: "ghcr.io/champ-x/napier-sandbox",
    VERSION: "0.1.0",
    DIGEST: digest,
    CONTEXT_SHA256: "a".repeat(64),
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

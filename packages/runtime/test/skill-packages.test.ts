import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createExtensionPublisherTrustAnchor,
  revokeExtensionPublisherTrustAnchor,
} from "../src/extension-packages.js";
import {
  qualifyWorkspaceSkillPackage,
  signWorkspaceSkillPackage,
  verifySignedSkillPackageEnvelope,
} from "../src/skill-packages.js";

const SIGNING_KEY_ENV = "NAPIER_TEST_SKILL_PACKAGE_KEY";
const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env[SIGNING_KEY_ENV];
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createAnchor() {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_KEY_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_skillpkg",
    label: "Skill publisher",
    source: { type: "environment", variable: SIGNING_KEY_ENV },
  });
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-package-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "skills/signed-skill"), { recursive: true });
  await writeFile(
    path.join(root, "skills/signed-skill/SKILL.md"),
    [
      "---",
      "name: signed-skill",
      "description: Use this signed Skill for package verification.",
      "---",
      "",
      "# Signed Skill",
      "",
      "This private instruction must never be copied into the signed envelope.",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("signed Skill packages", () => {
  it("signs hash-only Skill catalog evidence and verifies trust state", async () => {
    const workspaceRoot = await createWorkspace();
    const anchor = createAnchor();

    const envelope = await signWorkspaceSkillPackage(
      workspaceRoot,
      "Skill Registry",
      anchor,
      { skillNames: ["signed-skill"] },
    );

    expect(envelope).toEqual(
      expect.objectContaining({
        kind: "napier.signed-skill-package",
        manifest: expect.objectContaining({
          kind: "napier.skill-package-manifest",
          publisher: "Skill Registry",
          loadedSkillNames: ["signed-skill"],
          missingSkillNames: [],
          skillCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          skills: [
            expect.objectContaining({
              name: "signed-skill",
              relativePath: "skills/signed-skill/SKILL.md",
              contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ],
        }),
      }),
    );
    expect(JSON.stringify(envelope)).not.toContain(
      "This private instruction must never be copied",
    );
    expect(verifySignedSkillPackageEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        skillCount: 1,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );
    expect(verifySignedSkillPackageEnvelope(envelope, [])).toEqual(
      expect.objectContaining({
        status: "unknown_key",
        skillCount: 1,
      }),
    );
    expect(
      verifySignedSkillPackageEnvelope(envelope, [
        revokeExtensionPublisherTrustAnchor(anchor),
      ]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        keyId: anchor.keyId,
      }),
    );
    await expect(
      qualifyWorkspaceSkillPackage(workspaceRoot, envelope, [anchor]),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        observedSkillCatalogSha256: envelope.manifest.skillCatalogSha256,
      }),
    );

    await writeFile(
      path.join(workspaceRoot, "skills/signed-skill/SKILL.md"),
      [
        "---",
        "name: signed-skill",
        "description: Use this signed Skill for package verification.",
        "---",
        "",
        "# Signed Skill Drift",
        "",
        "Changed local instruction.",
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(
      qualifyWorkspaceSkillPackage(workspaceRoot, envelope, [anchor]),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "catalog_drift",
        verificationStatus: "trusted",
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        observedSkillCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const tampered = structuredClone(envelope);
    tampered.manifest.skills[0]!.contentSha256 = "0".repeat(64);
    expect(verifySignedSkillPackageEnvelope(tampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
      }),
    );
  });
});

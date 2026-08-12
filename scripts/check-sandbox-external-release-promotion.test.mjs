import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySandboxExternalReleasePromotion,
  PACKAGED_EXTERNAL_RELEASE_PATH,
  previewSandboxExternalReleasePromotion,
  RETAINED_EXTERNAL_AUTHORITY_PATH,
  RETAINED_EXTERNAL_RELEASE_PATH,
  validateSandboxExternalReleasePromotionPreview,
  validateSandboxExternalReleasePromotionResult,
} from "./sandbox-external-release-promotion.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { verifySandboxRetainedExternalRelease } from "./check-sandbox-retained-external-release.mjs";
import { validateOfficialSandboxRelease } from "../packages/runtime/dist/sandbox-official-release-model.js";
import {
  TEST_EXTERNAL_RELEASE_SOURCE_SHA as SOURCE_SHA,
  writeSandboxExternalReleaseTestFixture,
} from "./sandbox-external-release-test-fixture.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox external release promotion", () => {
  it("promotes exact reviewed bytes into repository and Runtime package", async () => {
    const fixture = await promotionFixture();
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);

    expect(preview).toEqual(
      expect.objectContaining({
        action: "create",
        sourceSha: SOURCE_SHA,
        contextSha256: fixture.contextSha256,
        retainedBeforeSha256: null,
        retainedAuthorityBeforeSha256: null,
        packagedBeforeSha256: null,
        scope: {
          promotionOnly: true,
          retainedReceiptValidated: true,
          packageParityRequired: true,
          s1Complete: false,
        },
      }),
    );
    expect(validateSandboxExternalReleasePromotionPreview(preview)).toEqual([]);

    const result = await applySandboxExternalReleasePromotion({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });

    expect(
      validateSandboxExternalReleasePromotionResult(result, preview),
    ).toEqual([]);
    expect(result.scope).toEqual({
      promotionOnly: true,
      retainedReceiptValidated: true,
      packageParityRequired: true,
      packageParityVerified: true,
      s1Complete: false,
    });
    const [source, retained, authority, packaged] = await Promise.all([
      readFile(
        path.join(fixture.evidenceDir, "external-publication-receipt.json"),
      ),
      readFile(path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
      readFile(path.join(fixture.repoRoot, RETAINED_EXTERNAL_AUTHORITY_PATH)),
      readFile(path.join(fixture.repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH)),
    ]);
    expect(retained).toEqual(source);
    expect(packaged).toEqual(source);
    expect(sha256(authority)).toBe(preview.authorityFileSha256);
    expect(
      validateOfficialSandboxRelease(
        JSON.parse(packaged.toString("utf8")),
        fixture.contextSha256,
        sha256(packaged),
      ),
    ).toEqual(
      expect.objectContaining({
        sourceSha: SOURCE_SHA,
        receiptSha256: sha256(packaged),
      }),
    );
    await expect(
      verifySandboxRetainedExternalRelease({ repoRoot: fixture.repoRoot }),
    ).resolves.toEqual(
      expect.objectContaining({
        present: true,
        valid: true,
        errors: [],
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            kind: "sandbox-external-publication-retained",
          }),
          expect.objectContaining({
            kind: "sandbox-external-publication-authority-retained",
          }),
        ]),
      }),
    );
  });

  it("reports unchanged only when retained, authority, and package bytes match", async () => {
    const fixture = await promotionFixture();
    const first = await previewSandboxExternalReleasePromotion(fixture);
    await applySandboxExternalReleasePromotion({
      ...fixture,
      expectedPreviewSha256: first.preview.contentSha256,
    });

    const second = await previewSandboxExternalReleasePromotion(fixture);

    expect(second.preview.action).toBe("unchanged");
  });

  it("rejects stale preview and target drift before mutation", async () => {
    const fixture = await promotionFixture();
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);
    await expect(
      applySandboxExternalReleasePromotion({
        ...fixture,
        expectedPreviewSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("preview is stale");
    await mkdir(
      path.dirname(path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
      { recursive: true },
    );
    await writeFile(
      path.join(fixture.repoRoot, RETAINED_EXTERNAL_RELEASE_PATH),
      "drift\n",
    );

    await expect(
      applySandboxExternalReleasePromotion({
        ...fixture,
        expectedPreviewSha256: preview.contentSha256,
      }),
    ).rejects.toThrow("preview is stale");
  });

  it("restores both retained targets and package after copy failure", async () => {
    const fixture = await promotionFixture();
    const retainedPath = path.join(
      fixture.repoRoot,
      RETAINED_EXTERNAL_RELEASE_PATH,
    );
    const authorityPath = path.join(
      fixture.repoRoot,
      RETAINED_EXTERNAL_AUTHORITY_PATH,
    );
    const packagedPath = path.join(
      fixture.repoRoot,
      PACKAGED_EXTERNAL_RELEASE_PATH,
    );
    await Promise.all([
      mkdir(path.dirname(retainedPath), { recursive: true }),
      mkdir(path.dirname(packagedPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(retainedPath, "old receipt\n"),
      writeFile(authorityPath, "old authority\n"),
      writeFile(packagedPath, "old package\n"),
    ]);
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);

    await expect(
      applySandboxExternalReleasePromotion({
        ...fixture,
        expectedPreviewSha256: preview.contentSha256,
        copyPackage: async () => {
          await writeFile(packagedPath, "partial\n");
          throw new Error("copy failed");
        },
      }),
    ).rejects.toThrow("copy failed");
    await expect(readFile(retainedPath, "utf8")).resolves.toBe("old receipt\n");
    await expect(readFile(authorityPath, "utf8")).resolves.toBe(
      "old authority\n",
    );
    await expect(readFile(packagedPath, "utf8")).resolves.toBe("old package\n");
  });

  it("rejects authority, context, and result tampering", async () => {
    for (const mutate of [
      async (fixture) => {
        const authority = JSON.parse(
          await readFile(fixture.authorityPath, "utf8"),
        );
        authority.workflowRunId = "999";
        rehash(authority);
        await writeFile(
          fixture.authorityPath,
          `${JSON.stringify(authority)}\n`,
        );
      },
      async (fixture) => {
        const dockerfile = path.join(
          fixture.repoRoot,
          "docker/napier-sandbox/Dockerfile",
        );
        await writeFile(
          dockerfile,
          `${await readFile(dockerfile, "utf8")}# drift\n`,
        );
      },
    ]) {
      const fixture = await promotionFixture();
      await mutate(fixture);
      await expect(
        previewSandboxExternalReleasePromotion(fixture),
      ).rejects.toThrow();
    }
    const fixture = await promotionFixture();
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);
    const result = await applySandboxExternalReleasePromotion({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });
    result.scope.s1Complete = true;
    rehash(result);
    expect(
      validateSandboxExternalReleasePromotionResult(result, preview),
    ).not.toEqual([]);
  });

  it("treats a partial or tampered retained closure as invalid", async () => {
    const absent = await mkdtemp(
      path.join(tmpdir(), "napier-retained-release-"),
    );
    roots.push(absent);
    await expect(
      verifySandboxRetainedExternalRelease({ repoRoot: absent }),
    ).resolves.toEqual({
      present: false,
      valid: true,
      errors: [],
      artifacts: [],
    });
    await mkdir(path.join(absent, "docs/artifacts"), { recursive: true });
    await writeFile(
      path.join(absent, RETAINED_EXTERNAL_RELEASE_PATH),
      "partial\n",
    );
    await expect(
      verifySandboxRetainedExternalRelease({ repoRoot: absent }),
    ).resolves.toEqual(
      expect.objectContaining({
        present: true,
        valid: false,
        errors: ["Retained Sandbox release closure is incomplete"],
      }),
    );

    const fixture = await promotionFixture();
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);
    await applySandboxExternalReleasePromotion({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });
    const authorityPath = path.join(
      fixture.repoRoot,
      RETAINED_EXTERNAL_AUTHORITY_PATH,
    );
    const authority = JSON.parse(await readFile(authorityPath, "utf8"));
    authority.workflowRunAttempt = "2";
    rehash(authority);
    await writeFile(authorityPath, `${JSON.stringify(authority)}\n`);

    const verification = await verifySandboxRetainedExternalRelease({
      repoRoot: fixture.repoRoot,
    });
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match receipt"),
      ]),
    );
  });
});

async function promotionFixture() {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "napier-release-promotion-"),
  );
  roots.push(repoRoot);
  return writeSandboxExternalReleaseTestFixture(repoRoot);
}

function rehash(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(canonicalJson(content));
}

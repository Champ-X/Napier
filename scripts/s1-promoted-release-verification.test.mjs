import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySandboxExternalReleasePromotion,
  PACKAGED_EXTERNAL_RELEASE_PATH,
  previewSandboxExternalReleasePromotion,
  RETAINED_EXTERNAL_AUTHORITY_PATH,
} from "./sandbox-external-release-promotion.mjs";
import { writeSandboxExternalReleaseTestFixture } from "./sandbox-external-release-test-fixture.mjs";
import { verifyPromotedExternalRelease } from "./s1-promoted-release-verification.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("S1 promoted release verification", () => {
  it("binds completion projection to retained authority and package bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-promoted-release-"));
    roots.push(root);
    const fixture = await writeSandboxExternalReleaseTestFixture(root);
    const { preview } = await previewSandboxExternalReleasePromotion(fixture);
    await applySandboxExternalReleasePromotion({
      ...fixture,
      expectedPreviewSha256: preview.contentSha256,
    });
    const receipt = JSON.parse(
      await readFile(
        path.join(fixture.evidenceDir, "external-publication-receipt.json"),
        "utf8",
      ),
    );
    const authorityBytes = await readFile(
      path.join(root, RETAINED_EXTERNAL_AUTHORITY_PATH),
    );
    const packagedBytes = await readFile(
      path.join(root, PACKAGED_EXTERNAL_RELEASE_PATH),
    );
    const projection = {
      receiptSha256: sha256(packagedBytes),
      runAuthorityFileSha256: sha256(authorityBytes),
      contentSha256: receipt.contentSha256,
    };

    await expect(
      verifyPromotedExternalRelease(root, fixture.sourceSha, projection),
    ).resolves.toBeUndefined();

    await writeFile(path.join(root, PACKAGED_EXTERNAL_RELEASE_PATH), "drift\n");
    await expect(
      verifyPromotedExternalRelease(root, fixture.sourceSha, projection),
    ).rejects.toThrow("bytes do not match");
  });
});

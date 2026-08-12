import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PACKAGED_EXTERNAL_RELEASE_PATH,
  RETAINED_EXTERNAL_AUTHORITY_PATH,
  RETAINED_EXTERNAL_RELEASE_PATH,
} from "./sandbox-external-release-promotion.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";

export async function verifyPromotedExternalRelease(
  repoRoot,
  releaseSourceSha,
  externalPublication,
) {
  const [retained, retainedAuthority, packaged] = await Promise.all([
    readFile(path.join(repoRoot, RETAINED_EXTERNAL_RELEASE_PATH)),
    readFile(path.join(repoRoot, RETAINED_EXTERNAL_AUTHORITY_PATH)),
    readFile(path.join(repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH)),
  ]).catch(() => {
    throw new Error(
      "S1 external publication receipt is not promoted into Runtime package",
    );
  });
  const retainedSha256 = sha256(retained);
  if (
    retainedSha256 !== externalPublication.receiptSha256 ||
    sha256(retainedAuthority) !== externalPublication.runAuthorityFileSha256 ||
    sha256(packaged) !== retainedSha256
  ) {
    throw new Error(
      "S1 promoted external publication receipt bytes do not match",
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(retained.toString("utf8"));
  } catch {
    throw new Error("S1 promoted external publication receipt is invalid");
  }
  if (
    receipt.sourceSha !== releaseSourceSha ||
    receipt.contentSha256 !== externalPublication.contentSha256
  ) {
    throw new Error(
      "S1 promoted external publication receipt identity does not match",
    );
  }
}

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { verifySandboxExternalPublicationEvidence } from "./sandbox-external-publication-evidence.mjs";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import { copySandboxImageAsset } from "./copy-sandbox-image.mjs";
import { validateS1UpstreamRunAuthority } from "./s1-upstream-run-authority.mjs";

export const RETAINED_EXTERNAL_RELEASE_PATH =
  "docs/artifacts/sandbox-external-publication-0.1.0.json";
export const RETAINED_EXTERNAL_AUTHORITY_PATH =
  "docs/artifacts/sandbox-external-publication-authority-0.1.0.json";
export const PACKAGED_EXTERNAL_RELEASE_PATH =
  "packages/runtime/dist/sandbox-image/external-publication.json";
export const EXTERNAL_RELEASE_PROMOTION_PREVIEW_KIND =
  "napier.sandbox-external-release-promotion-preview";
export const EXTERNAL_RELEASE_PROMOTION_RESULT_KIND =
  "napier.sandbox-external-release-promotion-result";

const SHA256 = /^[a-f0-9]{64}$/u;

export async function previewSandboxExternalReleasePromotion(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const evidenceDir = path.resolve(options.evidenceDir);
  const authorityPath = path.resolve(options.authorityPath);
  const expectedSourceSha = String(options.sourceSha ?? "");
  const expectedRunId = String(options.expectedRunId ?? "");
  const [verified, authorityBytes, source] = await Promise.all([
    verifySandboxExternalPublicationEvidence(evidenceDir),
    readFile(authorityPath),
    sandboxImageSourceEvidence(repoRoot),
  ]);
  if (!verified.valid) {
    throw new Error(
      `Sandbox external release evidence is invalid: ${verified.errors.join(
        "; ",
      )}`,
    );
  }
  let authority;
  try {
    authority = JSON.parse(authorityBytes.toString("utf8"));
  } catch {
    throw new Error("Sandbox external release authority is not valid JSON");
  }
  const authorityErrors = validateS1UpstreamRunAuthority(authority, {
    authority: "external_publication",
    sourceSha: expectedSourceSha,
    workflowRunId: expectedRunId,
  });
  if (authorityErrors.length > 0) {
    throw new Error(
      `Sandbox external release authority is invalid: ${authorityErrors.join(
        "; ",
      )}`,
    );
  }
  const receiptBytes = await readFile(verified.path);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (
    receipt.sourceSha !== authority.sourceSha ||
    receipt.workflow !== authority.workflow ||
    receipt.workflowRunId !== authority.workflowRunId ||
    receipt.workflowRunAttempt !== authority.workflowRunAttempt ||
    receipt.contextSha256 !== source.contextSha256
  ) {
    throw new Error(
      "Sandbox external release receipt does not match its run authority",
    );
  }
  const retainedPath = path.join(repoRoot, RETAINED_EXTERNAL_RELEASE_PATH);
  const retainedAuthorityPath = path.join(
    repoRoot,
    RETAINED_EXTERNAL_AUTHORITY_PATH,
  );
  const packagedPath = path.join(repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH);
  const [existing, retainedAuthority, packaged] = await Promise.all([
    existingFile(retainedPath),
    existingFile(retainedAuthorityPath),
    existingFile(packagedPath),
  ]);
  const receiptSha256 = sha256(receiptBytes);
  const content = {
    kind: EXTERNAL_RELEASE_PROMOTION_PREVIEW_KIND,
    schemaVersion: 1,
    generatedAt: receipt.generatedAt,
    repository: "Champ-X/Napier",
    sourceSha: receipt.sourceSha,
    contextSha256: receipt.contextSha256,
    workflow: receipt.workflow,
    workflowRunId: receipt.workflowRunId,
    workflowRunAttempt: receipt.workflowRunAttempt,
    authorityFileSha256: sha256(authorityBytes),
    authorityContentSha256: authority.contentSha256,
    sourceReceiptSha256: verified.sha256,
    sourceReceiptContentSha256: receipt.contentSha256,
    retainedPath: RETAINED_EXTERNAL_RELEASE_PATH,
    retainedBeforeSha256: existing?.sha256 ?? null,
    retainedAfterSha256: receiptSha256,
    retainedAuthorityPath: RETAINED_EXTERNAL_AUTHORITY_PATH,
    retainedAuthorityBeforeSha256: retainedAuthority?.sha256 ?? null,
    retainedAuthorityAfterSha256: sha256(authorityBytes),
    packagedPath: PACKAGED_EXTERNAL_RELEASE_PATH,
    packagedBeforeSha256: packaged?.sha256 ?? null,
    packagedAfterSha256: receiptSha256,
    action:
      existing?.sha256 === receiptSha256 &&
      retainedAuthority?.sha256 === sha256(authorityBytes) &&
      packaged?.sha256 === receiptSha256
        ? "unchanged"
        : existing
          ? "replace"
          : "create",
    retention: {
      credentialValues: false,
      rawWorkflowLog: false,
      rawApiResponse: false,
      workspacePaths: false,
      imageBytes: false,
    },
    scope: {
      promotionOnly: true,
      retainedReceiptValidated: true,
      packageParityRequired: true,
      s1Complete: false,
    },
  };
  const preview = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  const errors = validateSandboxExternalReleasePromotionPreview(preview);
  if (errors.length > 0) {
    throw new Error(
      `Sandbox external release promotion preview is invalid: ${errors.join(
        "; ",
      )}`,
    );
  }
  return { preview, receiptBytes, authorityBytes };
}

export async function applySandboxExternalReleasePromotion(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const { preview, receiptBytes, authorityBytes } =
    await previewSandboxExternalReleasePromotion(options);
  if (preview.contentSha256 !== options.expectedPreviewSha256) {
    throw new Error("Sandbox external release promotion preview is stale");
  }
  const retainedPath = path.join(repoRoot, RETAINED_EXTERNAL_RELEASE_PATH);
  const retainedAuthorityPath = path.join(
    repoRoot,
    RETAINED_EXTERNAL_AUTHORITY_PATH,
  );
  const packagedPath = path.join(repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH);
  const [existing, retainedAuthority, packaged] = await Promise.all([
    existingFile(retainedPath),
    existingFile(retainedAuthorityPath),
    existingFile(packagedPath),
  ]);
  if (
    (existing?.sha256 ?? null) !== preview.retainedBeforeSha256 ||
    (retainedAuthority?.sha256 ?? null) !==
      preview.retainedAuthorityBeforeSha256 ||
    (packaged?.sha256 ?? null) !== preview.packagedBeforeSha256
  ) {
    throw new Error("Sandbox external release promotion targets changed");
  }
  const retainedBackup = existing?.bytes;
  const retainedAuthorityBackup = retainedAuthority?.bytes;
  const packagedBackup = packaged?.bytes;
  try {
    if (existing?.sha256 !== preview.retainedAfterSha256) {
      await writeAtomic(retainedPath, receiptBytes, 0o644);
    }
    if (retainedAuthority?.sha256 !== preview.retainedAuthorityAfterSha256) {
      await writeAtomic(retainedAuthorityPath, authorityBytes, 0o644);
    }
    await copyPackagedRelease(repoRoot, options.copyPackage);
    const [retained, retainedAuthorityResult, packaged] = await Promise.all([
      readFile(retainedPath),
      readFile(retainedAuthorityPath),
      readFile(packagedPath),
    ]);
    if (
      sha256(retained) !== preview.retainedAfterSha256 ||
      sha256(retainedAuthorityResult) !==
        preview.retainedAuthorityAfterSha256 ||
      sha256(packaged) !== preview.retainedAfterSha256
    ) {
      throw new Error("Sandbox external release package copy is invalid");
    }
    const content = {
      ...preview,
      kind: EXTERNAL_RELEASE_PROMOTION_RESULT_KIND,
      action: preview.action,
      packagedSha256: sha256(packaged),
      scope: {
        promotionOnly: true,
        retainedReceiptValidated: true,
        packageParityRequired: true,
        packageParityVerified: true,
        s1Complete: false,
      },
    };
    const { contentSha256: _previewSha, ...withoutPreviewHash } = content;
    const result = {
      ...withoutPreviewHash,
      previewSha256: preview.contentSha256,
      contentSha256: sha256(
        canonicalJson({
          ...withoutPreviewHash,
          previewSha256: preview.contentSha256,
        }),
      ),
    };
    const errors = validateSandboxExternalReleasePromotionResult(
      result,
      preview,
    );
    if (errors.length > 0) {
      throw new Error(
        `Sandbox external release promotion result is invalid: ${errors.join(
          "; ",
        )}`,
      );
    }
    await options.finalize?.(result);
    return result;
  } catch (error) {
    await restoreFile(retainedPath, retainedBackup);
    await restoreFile(retainedAuthorityPath, retainedAuthorityBackup);
    await restoreFile(packagedPath, packagedBackup);
    throw error;
  }
}

async function copyPackagedRelease(repoRoot, copyPackage) {
  await (copyPackage ?? copySandboxImageAsset)(repoRoot);
}

export function validateSandboxExternalReleasePromotionPreview(value) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "repository",
      "sourceSha",
      "contextSha256",
      "workflow",
      "workflowRunId",
      "workflowRunAttempt",
      "authorityFileSha256",
      "authorityContentSha256",
      "sourceReceiptSha256",
      "sourceReceiptContentSha256",
      "retainedPath",
      "retainedBeforeSha256",
      "retainedAfterSha256",
      "retainedAuthorityPath",
      "retainedAuthorityBeforeSha256",
      "retainedAuthorityAfterSha256",
      "packagedPath",
      "packagedBeforeSha256",
      "packagedAfterSha256",
      "action",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== EXTERNAL_RELEASE_PROMOTION_PREVIEW_KIND ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    value.repository !== "Champ-X/Napier" ||
    !/^[a-f0-9]{40}$/u.test(value.sourceSha ?? "") ||
    value.workflow !== ".github/workflows/publish-sandbox.yml" ||
    !positiveIntegerText(value.workflowRunId) ||
    !positiveIntegerText(value.workflowRunAttempt) ||
    !hashFields(value, [
      "contextSha256",
      "authorityFileSha256",
      "authorityContentSha256",
      "sourceReceiptSha256",
      "sourceReceiptContentSha256",
      "retainedAfterSha256",
      "retainedAuthorityAfterSha256",
      "packagedAfterSha256",
      "contentSha256",
    ]) ||
    !nullableHash(value.retainedBeforeSha256) ||
    !nullableHash(value.retainedAuthorityBeforeSha256) ||
    !nullableHash(value.packagedBeforeSha256) ||
    value.retainedAfterSha256 !== value.packagedAfterSha256 ||
    value.retainedPath !== RETAINED_EXTERNAL_RELEASE_PATH ||
    value.retainedAuthorityPath !== RETAINED_EXTERNAL_AUTHORITY_PATH ||
    value.packagedPath !== PACKAGED_EXTERNAL_RELEASE_PATH ||
    !["create", "replace", "unchanged"].includes(value.action) ||
    !validAction(value) ||
    !validRetention(value.retention) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        promotionOnly: true,
        retainedReceiptValidated: true,
        packageParityRequired: true,
        s1Complete: false,
      })
  ) {
    errors.push("Sandbox external release promotion preview shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox external release promotion preview hash is invalid");
  }
  return errors;
}

export function validateSandboxExternalReleasePromotionResult(value, preview) {
  const errors = [];
  const expectedContent = sandboxExternalReleasePromotionResultContent(preview);
  if (
    !record(value) ||
    !exactKeys(value, [...Object.keys(expectedContent), "contentSha256"]) ||
    canonicalJson(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "contentSha256"),
      ),
    ) !== canonicalJson(expectedContent) ||
    !SHA256.test(value.contentSha256 ?? "")
  ) {
    errors.push("Sandbox external release promotion result shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox external release promotion result hash is invalid");
  }
  return errors;
}

export function expectedSandboxExternalReleasePromotionResultSha256(preview) {
  return sha256(
    canonicalJson(sandboxExternalReleasePromotionResultContent(preview)),
  );
}

function sandboxExternalReleasePromotionResultContent(preview) {
  const { contentSha256: _previewContentSha256, ...previewContent } = preview;
  return {
    ...previewContent,
    kind: EXTERNAL_RELEASE_PROMOTION_RESULT_KIND,
    action: preview.action,
    packagedSha256: preview.packagedAfterSha256,
    scope: {
      promotionOnly: true,
      retainedReceiptValidated: true,
      packageParityRequired: true,
      packageParityVerified: true,
      s1Complete: false,
    },
    previewSha256: preview.contentSha256,
  };
}

async function existingFile(filePath) {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      throw new Error("Sandbox external release promotion target is invalid");
    }
    const bytes = await readFile(filePath);
    return { bytes, sha256: sha256(bytes) };
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

async function writeAtomic(filePath, bytes, mode) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(temporary, bytes, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, mode);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function restoreFile(filePath, backup) {
  if (backup) await writeAtomic(filePath, backup, 0o644);
  else await rm(filePath, { force: true });
}

function validRetention(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "credentialValues",
      "rawWorkflowLog",
      "rawApiResponse",
      "workspacePaths",
      "imageBytes",
    ]) &&
    Object.values(value).every((item) => item === false)
  );
}

function hashFields(value, fields) {
  return fields.every((field) => SHA256.test(value[field] ?? ""));
}

function nullableHash(value) {
  return value === null || SHA256.test(value ?? "");
}

function validAction(value) {
  const allMatch =
    value.retainedBeforeSha256 === value.retainedAfterSha256 &&
    value.retainedAuthorityBeforeSha256 ===
      value.retainedAuthorityAfterSha256 &&
    value.packagedBeforeSha256 === value.packagedAfterSha256;
  if (value.action === "unchanged") return allMatch;
  if (allMatch) return false;
  if (value.action === "create") {
    return (
      value.retainedBeforeSha256 === null &&
      value.retainedAuthorityBeforeSha256 === null
    );
  }
  return value.action === "replace";
}

function positiveIntegerText(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function exactKeys(value, keys) {
  return (
    record(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function missing(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateOfficialSandboxRelease } from "../packages/runtime/dist/sandbox-official-release-model.js";
import { sandboxImageSourceEvidence } from "./check-sandbox-image-sbom.mjs";
import {
  PACKAGED_EXTERNAL_RELEASE_PATH,
  RETAINED_EXTERNAL_AUTHORITY_PATH,
  RETAINED_EXTERNAL_RELEASE_PATH,
} from "./sandbox-external-release-promotion.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";
import { validateS1UpstreamRunAuthority } from "./s1-upstream-run-authority.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_AUTHORITY_BYTES = 64 * 1024;

export async function verifySandboxRetainedExternalRelease(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const paths = {
    receipt: path.join(repoRoot, RETAINED_EXTERNAL_RELEASE_PATH),
    authority: path.join(repoRoot, RETAINED_EXTERNAL_AUTHORITY_PATH),
    packaged: path.join(repoRoot, PACKAGED_EXTERNAL_RELEASE_PATH),
  };
  const presence = await Promise.all(
    Object.values(paths).map((filePath) => filePresence(filePath)),
  );
  if (presence.every((value) => value === "missing")) {
    return {
      present: false,
      valid: true,
      errors: [],
      artifacts: [],
    };
  }
  const errors = [];
  if (presence.some((value) => value !== "file")) {
    errors.push("Retained Sandbox release closure is incomplete");
    return { present: true, valid: false, errors, artifacts: [] };
  }
  let receiptBytes;
  let authorityBytes;
  let packagedBytes;
  let source;
  try {
    [receiptBytes, authorityBytes, packagedBytes, source] = await Promise.all([
      readBoundedFile(paths.receipt, MAX_RECEIPT_BYTES),
      readBoundedFile(paths.authority, MAX_AUTHORITY_BYTES),
      readBoundedFile(paths.packaged, MAX_RECEIPT_BYTES),
      sandboxImageSourceEvidence(repoRoot),
    ]);
  } catch {
    errors.push("Retained Sandbox release file is invalid");
    return { present: true, valid: false, errors, artifacts: [] };
  }
  let receipt;
  let authority;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
    authority = JSON.parse(authorityBytes.toString("utf8"));
  } catch {
    errors.push("Retained Sandbox release JSON is invalid");
    return { present: true, valid: false, errors, artifacts: [] };
  }
  try {
    validateOfficialSandboxRelease(
      receipt,
      source.contextSha256,
      sha256(receiptBytes),
    );
  } catch {
    errors.push("Retained Sandbox release receipt is invalid");
  }
  errors.push(
    ...validateS1UpstreamRunAuthority(authority, {
      authority: "external_publication",
      sourceSha: receipt.sourceSha,
      workflowRunId: receipt.workflowRunId,
    }).map((error) => `Retained Sandbox release authority: ${error}`),
  );
  if (
    receipt.workflow !== authority.workflow ||
    receipt.workflowRunId !== authority.workflowRunId ||
    receipt.workflowRunAttempt !== authority.workflowRunAttempt ||
    receipt.sourceSha !== authority.sourceSha
  ) {
    errors.push("Retained Sandbox release authority does not match receipt");
  }
  if (sha256(packagedBytes) !== sha256(receiptBytes)) {
    errors.push(
      "Packaged Sandbox release receipt does not match retained bytes",
    );
  }
  return {
    present: true,
    valid: errors.length === 0,
    errors,
    artifacts: [
      {
        kind: "sandbox-external-publication-retained",
        path: RETAINED_EXTERNAL_RELEASE_PATH,
        sha256: sha256(receiptBytes),
        valid: errors.length === 0,
      },
      {
        kind: "sandbox-external-publication-authority-retained",
        path: RETAINED_EXTERNAL_AUTHORITY_PATH,
        sha256: sha256(authorityBytes),
        valid: errors.length === 0,
      },
    ],
  };
}

async function filePresence(filePath) {
  try {
    const info = await lstat(filePath);
    return info.isFile() && !info.isSymbolicLink() ? "file" : "invalid";
  } catch (error) {
    if (missing(error)) return "missing";
    throw error;
  }
}

async function readBoundedFile(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size <= 0 ||
    info.size > maximumBytes
  ) {
    throw new Error("Retained Sandbox release file is invalid");
  }
  return readFile(filePath);
}

function missing(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

async function runCli() {
  const result = await verifySandboxRetainedExternalRelease();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    result.present
      ? "Retained Sandbox external release verified"
      : "Retained Sandbox external release absent; packaged-source fallback remains active",
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}

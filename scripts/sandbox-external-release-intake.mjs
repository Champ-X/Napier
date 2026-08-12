import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  applySandboxExternalReleasePromotion,
  expectedSandboxExternalReleasePromotionResultSha256,
  previewSandboxExternalReleasePromotion,
} from "./sandbox-external-release-promotion.mjs";
import {
  canonicalJson,
  sha256,
} from "./sandbox-external-publication-model.mjs";
import { createS1UpstreamRunAuthority } from "./s1-upstream-run-authority.mjs";

export const EXTERNAL_RELEASE_INTAKE_PREVIEW_KIND =
  "napier.sandbox-external-release-intake-preview";
export const EXTERNAL_RELEASE_INTAKE_RESULT_KIND =
  "napier.sandbox-external-release-intake-result";

const execFileAsync = promisify(execFile);
const REPOSITORY = "Champ-X/Napier";
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const EVIDENCE_FILES = [
  "anonymous-platforms.jsonl",
  "buildkit-attestation-predicates.jsonl",
  "cosign-attestation.bundle.json",
  "cosign-attestation.verify.json",
  "cosign.bundle.json",
  "cosign.verify.json",
  "external-publication-receipt.json",
  "remote-index.json",
  "slsa-provenance-v1.json",
];

export async function previewSandboxExternalReleaseIntake(options) {
  return withDownloadedRelease(options, async (context) => context.preview);
}

export async function applySandboxExternalReleaseIntake(options) {
  return withDownloadedRelease(options, async (context) => {
    if (context.preview.contentSha256 !== options.expectedPreviewSha256) {
      throw new Error("Sandbox external release intake preview is stale");
    }
    const result = createIntakeResult(context.preview);
    const errors = validateSandboxExternalReleaseIntakeResult(
      result,
      context.preview,
    );
    if (errors.length > 0) {
      throw new Error(
        `Sandbox external release intake result is invalid: ${errors.join(
          "; ",
        )}`,
      );
    }
    await applySandboxExternalReleasePromotion({
      ...context.promotionOptions,
      expectedPreviewSha256: context.promotionPreview.contentSha256,
    });
    return result;
  });
}

async function withDownloadedRelease(options, operation) {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceSha = String(options.sourceSha ?? "");
  const expectedRunId = String(options.expectedRunId ?? "");
  if (!SHA.test(sourceSha) || !positiveIntegerText(expectedRunId)) {
    throw new Error("Sandbox external release intake source is invalid");
  }
  const createTemporaryRoot =
    options.createTemporaryRoot ??
    (() => mkdtemp(path.join(tmpdir(), "napier-release-intake-")));
  const temporaryRoot = path.resolve(await createTemporaryRoot());
  const runGh = options.runGh ?? runGithubCli;
  const removeTemporaryRoot =
    options.removeTemporaryRoot ??
    (() => rm(temporaryRoot, { recursive: true, force: true }));
  let temporaryRemoved = false;
  try {
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const authorityPath = path.join(temporaryRoot, "authority.json");
    const evidenceDir = path.join(temporaryRoot, "evidence");
    await mkdir(evidenceDir, { mode: 0o700 });
    const [run, artifacts] = await Promise.all([
      githubJson(
        runGh,
        `repos/${REPOSITORY}/actions/runs/${expectedRunId}`,
        repoRoot,
      ),
      githubJson(
        runGh,
        `repos/${REPOSITORY}/actions/runs/${expectedRunId}/artifacts?per_page=100`,
        repoRoot,
      ),
    ]);
    const authority = createS1UpstreamRunAuthority({
      authority: "external_publication",
      sourceSha,
      expectedRunId,
      run,
      artifacts,
    });
    await writePrivateJson(authorityPath, authority);
    if (authority.artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
      throw new Error("Sandbox external release artifact exceeds intake limit");
    }
    await githubCommand(
      runGh,
      [
        "run",
        "download",
        expectedRunId,
        "--repo",
        `github.com/${REPOSITORY}`,
        "--name",
        authority.artifact.name,
        "--dir",
        evidenceDir,
      ],
      repoRoot,
    );
    await verifyEvidenceDirectory(evidenceDir);
    const promotionOptions = {
      repoRoot,
      sourceSha,
      expectedRunId,
      evidenceDir,
      authorityPath,
      ...(options.copyPackage ? { copyPackage: options.copyPackage } : {}),
      finalize: async (promotionResult) => {
        if (
          promotionResult.contentSha256 !==
          expectedSandboxExternalReleasePromotionResultSha256(promotionPreview)
        ) {
          throw new Error("Sandbox external release promotion result changed");
        }
        await removeTemporaryRoot();
        temporaryRemoved = true;
      },
    };
    const { preview: promotionPreview } =
      await previewSandboxExternalReleasePromotion(promotionOptions);
    const authorityBytes = await readFile(authorityPath);
    const preview = createIntakePreview(
      authority,
      authorityBytes,
      promotionPreview,
    );
    const errors = validateSandboxExternalReleaseIntakePreview(preview);
    if (errors.length > 0) {
      throw new Error(
        `Sandbox external release intake preview is invalid: ${errors.join(
          "; ",
        )}`,
      );
    }
    return await operation({
      preview,
      promotionOptions,
      promotionPreview,
    });
  } finally {
    if (!temporaryRemoved) await removeTemporaryRoot();
  }
}

function createIntakePreview(authority, authorityBytes, promotion) {
  const content = {
    kind: EXTERNAL_RELEASE_INTAKE_PREVIEW_KIND,
    schemaVersion: 1,
    generatedAt: authority.generatedAt,
    repository: REPOSITORY,
    sourceSha: authority.sourceSha,
    workflowRunId: authority.workflowRunId,
    workflowRunAttempt: authority.workflowRunAttempt,
    artifact: {
      id: authority.artifact.id,
      name: authority.artifact.name,
      sizeBytes: authority.artifact.sizeBytes,
    },
    authorityFileSha256: sha256(authorityBytes),
    authorityContentSha256: authority.contentSha256,
    sourceReceiptSha256: promotion.sourceReceiptSha256,
    sourceReceiptContentSha256: promotion.sourceReceiptContentSha256,
    promotionPreviewSha256: promotion.contentSha256,
    expectedPromotionResultSha256:
      expectedSandboxExternalReleasePromotionResultSha256(promotion),
    promotionAction: promotion.action,
    retention: {
      credentialValues: false,
      rawRunResponse: false,
      rawArtifactList: false,
      downloadedEvidence: false,
      downloadUrl: false,
      actorIdentity: false,
      workflowLogs: false,
      temporaryPaths: false,
    },
    scope: {
      releaseIntake: true,
      authorityValidated: true,
      evidenceValidated: true,
      promotionPreviewValidated: true,
      s1Complete: false,
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function createIntakeResult(preview) {
  const { contentSha256: _previewContentSha256, ...previewContent } = preview;
  const content = {
    ...previewContent,
    kind: EXTERNAL_RELEASE_INTAKE_RESULT_KIND,
    promotionResultSha256: preview.expectedPromotionResultSha256,
    previewSha256: preview.contentSha256,
    scope: {
      releaseIntake: true,
      authorityValidated: true,
      evidenceValidated: true,
      promotionPreviewValidated: true,
      promotionApplied: true,
      packageParityVerified: true,
      s1Complete: false,
    },
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateSandboxExternalReleaseIntakePreview(value) {
  const errors = [];
  if (
    !record(value) ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "generatedAt",
      "repository",
      "sourceSha",
      "workflowRunId",
      "workflowRunAttempt",
      "artifact",
      "authorityFileSha256",
      "authorityContentSha256",
      "sourceReceiptSha256",
      "sourceReceiptContentSha256",
      "promotionPreviewSha256",
      "expectedPromotionResultSha256",
      "promotionAction",
      "retention",
      "scope",
      "contentSha256",
    ]) ||
    value.kind !== EXTERNAL_RELEASE_INTAKE_PREVIEW_KIND ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    value.repository !== REPOSITORY ||
    !SHA.test(value.sourceSha ?? "") ||
    !positiveIntegerText(value.workflowRunId) ||
    !positiveIntegerText(value.workflowRunAttempt) ||
    !validArtifact(value.artifact, value) ||
    !hashFields(value, [
      "authorityFileSha256",
      "authorityContentSha256",
      "sourceReceiptSha256",
      "sourceReceiptContentSha256",
      "promotionPreviewSha256",
      "expectedPromotionResultSha256",
      "contentSha256",
    ]) ||
    !["create", "replace", "unchanged"].includes(value.promotionAction) ||
    canonicalJson(value.retention) !== canonicalJson(retention()) ||
    canonicalJson(value.scope) !==
      canonicalJson({
        releaseIntake: true,
        authorityValidated: true,
        evidenceValidated: true,
        promotionPreviewValidated: true,
        s1Complete: false,
      })
  ) {
    errors.push("Sandbox external release intake preview shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox external release intake preview hash is invalid");
  }
  return errors;
}

export function validateSandboxExternalReleaseIntakeResult(value, preview) {
  const errors = [];
  const { contentSha256: _previewContentSha256, ...previewContent } = preview;
  const expected = {
    ...previewContent,
    kind: EXTERNAL_RELEASE_INTAKE_RESULT_KIND,
    promotionResultSha256: value?.promotionResultSha256,
    previewSha256: preview.contentSha256,
    scope: {
      releaseIntake: true,
      authorityValidated: true,
      evidenceValidated: true,
      promotionPreviewValidated: true,
      promotionApplied: true,
      packageParityVerified: true,
      s1Complete: false,
    },
  };
  if (
    !record(value) ||
    !exactKeys(value, [...Object.keys(expected), "contentSha256"]) ||
    value.promotionResultSha256 !== preview.expectedPromotionResultSha256 ||
    !SHA256.test(value.contentSha256 ?? "") ||
    canonicalJson(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "contentSha256"),
      ),
    ) !== canonicalJson(expected)
  ) {
    errors.push("Sandbox external release intake result shape is invalid");
    return errors;
  }
  const { contentSha256, ...content } = value;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    errors.push("Sandbox external release intake result hash is invalid");
  }
  return errors;
}

async function githubJson(runGh, endpoint, cwd) {
  const result = await githubCommand(
    runGh,
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28",
      endpoint,
    ],
    cwd,
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub Actions release intake response is invalid");
  }
}

async function githubCommand(runGh, args, cwd) {
  try {
    return await runGh(args, { cwd });
  } catch {
    throw new Error("GitHub Actions release intake command failed");
  }
}

async function runGithubCli(args, options) {
  const { stdout, stderr } = await execFileAsync("gh", args, {
    cwd: options.cwd,
    env: githubEnvironment(),
    timeout: 120_000,
    killSignal: "SIGTERM",
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout, stderr };
}

function githubEnvironment() {
  const names = [
    "APPDATA",
    "GH_CONFIG_DIR",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "PATH",
    "SSL_CERT_FILE",
    "TMPDIR",
    "USERPROFILE",
    "XDG_CONFIG_HOME",
  ];
  return Object.fromEntries([
    ...names
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
    ["GH_PROMPT_DISABLED", "1"],
    ["NO_COLOR", "1"],
  ]);
}

async function verifyEvidenceDirectory(evidenceDir) {
  const entries = await readdir(evidenceDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (
    canonicalJson(names) !== canonicalJson(EVIDENCE_FILES) ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    throw new Error("Sandbox external release artifact shape is invalid");
  }
  let totalBytes = 0;
  for (const name of names) {
    const info = await lstat(path.join(evidenceDir, name));
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      throw new Error("Sandbox external release artifact file is invalid");
    }
    totalBytes += info.size;
  }
  if (totalBytes > MAX_ARTIFACT_BYTES) {
    throw new Error("Sandbox external release evidence exceeds intake limit");
  }
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function validArtifact(value, authority) {
  return (
    record(value) &&
    exactKeys(value, ["id", "name", "sizeBytes"]) &&
    positiveIntegerText(value.id) &&
    value.name === `sandbox-external-publication-${authority.sourceSha}` &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= MAX_ARTIFACT_BYTES
  );
}

function retention() {
  return {
    credentialValues: false,
    rawRunResponse: false,
    rawArtifactList: false,
    downloadedEvidence: false,
    downloadUrl: false,
    actorIdentity: false,
    workflowLogs: false,
    temporaryPaths: false,
  };
}

function hashFields(value, fields) {
  return fields.every((field) => SHA256.test(value[field] ?? ""));
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

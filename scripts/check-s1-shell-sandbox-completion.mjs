import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyWindowsHostProductAcceptance } from "./check-windows-host-product-acceptance.mjs";
import {
  createS1ShellSandboxCompletionArtifact,
  createS1ShellSandboxReadinessArtifact,
  validateS1ShellSandboxCompletionArtifact,
  validateS1ShellSandboxReadinessArtifact,
} from "./s1-shell-sandbox-completion-artifact.mjs";
import { collectS1LocalRequirements } from "./s1-shell-sandbox-local-evidence.mjs";
import {
  loadVerifiedS1RunAuthority,
  requireReceiptAuthorityMatch,
  requireReleaseSourceAncestor,
} from "./s1-completion-source-authority.mjs";
import { verifyPromotedExternalRelease } from "./s1-promoted-release-verification.mjs";
import { sha256 } from "./sandbox-external-publication-model.mjs";
import { verifySandboxExternalPublicationEvidence } from "./sandbox-external-publication-evidence.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_READINESS_PATH =
  "docs/artifacts/s1-shell-sandbox-readiness-stage22.json";
const SOURCE_SHA = /^[a-f0-9]{40}$/u;

export async function s1ShellSandboxCompletionImplementation(repoRoot) {
  const files = {
    model: "scripts/s1-shell-sandbox-completion-artifact.mjs",
    checker: "scripts/check-s1-shell-sandbox-completion.mjs",
    localEvidence: "scripts/s1-shell-sandbox-local-evidence.mjs",
    workflow: ".github/workflows/s1-shell-sandbox-completion.yml",
    workflowChecker: "scripts/check-s1-shell-sandbox-completion-workflow.mjs",
    externalEvidence: "scripts/sandbox-external-publication-evidence.mjs",
    externalModel: "scripts/sandbox-external-publication-model.mjs",
    runAuthority: "scripts/s1-upstream-run-authority.mjs",
    runAuthorityCheck: "scripts/check-s1-upstream-run-authority.mjs",
    sourceAuthority: "scripts/s1-completion-source-authority.mjs",
    promotedRelease: "scripts/s1-promoted-release-verification.mjs",
    intakeModel: "scripts/sandbox-external-release-intake.mjs",
    intakeCheck: "scripts/check-sandbox-external-release-intake.mjs",
    promotionModel: "scripts/sandbox-external-release-promotion.mjs",
    promotionCheck: "scripts/check-sandbox-external-release-promotion.mjs",
    retainedReleaseCheck: "scripts/check-sandbox-retained-external-release.mjs",
    releaseDispatchModel: "scripts/sandbox-external-release-dispatch-model.mjs",
    releaseDispatchState: "scripts/sandbox-external-release-dispatch-state.mjs",
    releaseDispatchVisibility:
      "scripts/sandbox-external-release-visibility.mjs",
    releaseDispatchCheck: "scripts/check-sandbox-external-release-dispatch.mjs",
    githubDispatchIo: "scripts/github-actions-dispatch-io.mjs",
    windowsDispatchModel:
      "scripts/windows-host-product-acceptance-dispatch.mjs",
    windowsDispatchState:
      "scripts/windows-host-product-acceptance-dispatch-state.mjs",
    windowsDispatchIo:
      "scripts/windows-host-product-acceptance-dispatch-io.mjs",
    windowsDispatchCheck:
      "scripts/check-windows-host-product-acceptance-dispatch.mjs",
    windowsChecker: "scripts/check-windows-host-product-acceptance.mjs",
    windowsModel: "scripts/windows-host-product-acceptance-artifact.mjs",
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, relative]) => [
        `${name}Sha256`,
        sha256(await readFile(path.join(repoRoot, relative))),
      ]),
    ),
  );
}

export async function collectS1ShellSandboxReadiness(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const [implementation, requirements] = await Promise.all([
    s1ShellSandboxCompletionImplementation(repoRoot),
    collectS1LocalRequirements({ repoRoot }),
  ]);
  return createS1ShellSandboxReadinessArtifact({
    implementation,
    requirements,
  });
}

export async function verifyS1ShellSandboxReadiness(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoPath(
    repoRoot,
    options.artifactPath ?? DEFAULT_READINESS_PATH,
  );
  const [value, implementation, artifactBytes] = await Promise.all([
    readJson(artifactPath, "S1 Shell/Sandbox readiness artifact"),
    s1ShellSandboxCompletionImplementation(repoRoot),
    readFile(artifactPath),
  ]);
  const errors = [];
  let requirements;
  try {
    requirements = await collectS1LocalRequirements({ repoRoot });
  } catch (error) {
    errors.push(
      `S1 local evidence verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  errors.push(
    ...validateS1ShellSandboxReadinessArtifact(value, {
      implementation,
      requirements,
    }),
  );
  return {
    valid: errors.length === 0,
    errors,
    path: toRepoPath(repoRoot, artifactPath),
    sha256: sha256(artifactBytes),
    value,
  };
}

export async function collectS1ShellSandboxCompletion(options) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sourceSha = String(options.sourceSha ?? "");
  const releaseSourceSha = String(options.releaseSourceSha ?? sourceSha);
  if (!SOURCE_SHA.test(sourceSha)) {
    throw new Error("S1 completion source SHA is invalid");
  }
  if (!SOURCE_SHA.test(releaseSourceSha)) {
    throw new Error("S1 release source SHA is invalid");
  }
  await requireReleaseSourceAncestor(repoRoot, releaseSourceSha, sourceSha);
  requireCompleteUpstreamInputs("external publication", [
    options.externalPublicationRunId,
    options.externalPublicationAuthorityPath,
    options.externalPublicationDir,
  ]);
  requireCompleteUpstreamInputs("Windows host", [
    options.windowsHostRunId,
    options.windowsHostAuthorityPath,
    options.windowsReceiptPath,
  ]);
  const readiness = await verifyS1ShellSandboxReadiness({
    repoRoot,
    artifactPath: options.readinessPath,
  });
  if (!readiness.valid) {
    throw new Error(
      `S1 readiness verification failed: ${readiness.errors.join("; ")}`,
    );
  }
  const [externalPublication, windowsHost] = await Promise.all([
    options.externalPublicationDir
      ? verifiedExternalPublication(
          path.resolve(options.externalPublicationDir),
          releaseSourceSha,
          options.externalPublicationRunId,
          options.externalPublicationAuthorityPath,
        )
      : null,
    options.windowsReceiptPath
      ? verifiedWindowsHost(
          repoRoot,
          path.resolve(options.windowsReceiptPath),
          sourceSha,
          options.windowsHostRunId,
          options.windowsHostAuthorityPath,
        )
      : null,
  ]);
  if (externalPublication) {
    await (options.verifyPromotedRelease ?? verifyPromotedExternalRelease)(
      repoRoot,
      releaseSourceSha,
      externalPublication,
    );
  }
  return createS1ShellSandboxCompletionArtifact({
    workflowRunId: options.workflowRunId,
    workflowRunAttempt: options.workflowRunAttempt,
    sourceSha,
    releaseSourceSha,
    readiness: {
      path: readiness.path,
      sha256: readiness.sha256,
      contentSha256: readiness.value.contentSha256,
      requirementSetSha256: readiness.value.requirementSetSha256,
    },
    requirements: readiness.value.requirements,
    externalPublication,
    windowsHost,
  });
}

export async function verifyS1ShellSandboxCompletion(options) {
  const artifactPath = path.resolve(options.artifactPath);
  const [observed, expected, bytes] = await Promise.all([
    readJson(artifactPath, "S1 Shell/Sandbox completion artifact"),
    collectS1ShellSandboxCompletion(options),
    readFile(artifactPath),
  ]);
  const errors = validateS1ShellSandboxCompletionArtifact(observed, {
    workflowRunId: expected.workflowRunId,
    workflowRunAttempt: expected.workflowRunAttempt,
    sourceSha: expected.sourceSha,
    releaseSourceSha: expected.releaseSourceSha,
    readiness: expected.readiness,
    requirements: expected.requirements,
    externalPublication: expected.externalPublication,
    windowsHost: expected.windowsHost,
  });
  return {
    valid: errors.length === 0,
    errors,
    path: artifactPath,
    sha256: sha256(bytes),
    value: observed,
  };
}

async function verifiedExternalPublication(
  evidenceDir,
  sourceSha,
  expectedRunId,
  authorityPath,
) {
  const runAuthority = await loadVerifiedS1RunAuthority({
    artifactPath: authorityPath,
    authority: "external_publication",
    sourceSha,
    expectedRunId,
  });
  const result = await verifySandboxExternalPublicationEvidence(evidenceDir);
  if (!result.valid) {
    throw new Error(
      `External publication receipt verification failed: ${result.errors.join(
        "; ",
      )}`,
    );
  }
  const receipt = await readJson(result.path, "external publication receipt");
  if (receipt.sourceSha !== sourceSha) {
    throw new Error("External publication receipt source SHA does not match");
  }
  if (expectedRunId && receipt.workflowRunId !== expectedRunId) {
    throw new Error("External publication receipt workflow run does not match");
  }
  requireReceiptAuthorityMatch(receipt, runAuthority.value);
  return {
    workflow: receipt.workflow,
    workflowRunId: receipt.workflowRunId,
    workflowRunAttempt: receipt.workflowRunAttempt,
    sourceSha: receipt.sourceSha,
    runAuthorityFileSha256: runAuthority.fileSha256,
    runAuthoritySha256: runAuthority.value.contentSha256,
    receiptSha256: result.sha256,
    contentSha256: receipt.contentSha256,
    digest: receipt.digest,
    contextSha256: receipt.contextSha256,
  };
}

async function verifiedWindowsHost(
  repoRoot,
  artifactPath,
  sourceSha,
  expectedRunId,
  authorityPath,
) {
  const runAuthority = await loadVerifiedS1RunAuthority({
    artifactPath: authorityPath,
    authority: "windows_host_product_acceptance",
    sourceSha,
    expectedRunId,
  });
  const result = await verifyWindowsHostProductAcceptance({
    repoRoot,
    artifactPath,
    sourceSha,
  });
  if (!result.valid) {
    throw new Error(
      `Windows host receipt verification failed: ${result.errors.join("; ")}`,
    );
  }
  const receipt = await readJson(
    result.path,
    "Windows host product acceptance receipt",
  );
  if (expectedRunId && receipt.workflowRunId !== expectedRunId) {
    throw new Error("Windows host receipt workflow run does not match");
  }
  requireReceiptAuthorityMatch(receipt, runAuthority.value);
  return {
    workflow: receipt.workflow,
    workflowRunId: receipt.workflowRunId,
    workflowRunAttempt: receipt.workflowRunAttempt,
    sourceSha: receipt.sourceSha,
    runAuthorityFileSha256: runAuthority.fileSha256,
    runAuthoritySha256: runAuthority.value.contentSha256,
    receiptSha256: result.sha256,
    contentSha256: receipt.contentSha256,
    hostIdentitySha256: receipt.host.identitySha256,
    productContentSha256: receipt.product.contentSha256,
  };
}

function requireCompleteUpstreamInputs(label, values) {
  const present = values.filter((value) => value !== undefined).length;
  if (present !== 0 && present !== values.length) {
    throw new Error(`${label} authority inputs must be supplied together`);
  }
}

function resolveRepoPath(repoRoot, relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("S1 readiness artifact path must be repository-relative");
  }
  const resolved = path.resolve(repoRoot, relative);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("S1 readiness artifact path escapes the repository");
  }
  return resolved;
}

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function writeJson(filePath, value, mode) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode,
    });
    await chmod(temporary, mode);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseOptions(args) {
  const options = { repoRoot: defaultRepoRoot };
  let writeReadiness = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--write-readiness") {
      writeReadiness = true;
      continue;
    }
    const value = args[index + 1];
    if (
      ![
        "--repo-root",
        "--readiness-path",
        "--source-sha",
        "--release-source-sha",
        "--external-publication-run-id",
        "--windows-host-run-id",
        "--external-publication-authority",
        "--windows-host-authority",
        "--external-publication-dir",
        "--windows-receipt",
        "--completion-path",
      ].includes(name) ||
      !value
    ) {
      throw new Error("S1 completion arguments are invalid");
    }
    if (name === "--repo-root") options.repoRoot = path.resolve(value);
    if (name === "--readiness-path") options.readinessPath = value;
    if (name === "--source-sha") options.sourceSha = value;
    if (name === "--release-source-sha") options.releaseSourceSha = value;
    if (name === "--external-publication-run-id") {
      options.externalPublicationRunId = value;
    }
    if (name === "--windows-host-run-id") options.windowsHostRunId = value;
    if (name === "--external-publication-authority") {
      options.externalPublicationAuthorityPath = path.resolve(value);
    }
    if (name === "--windows-host-authority") {
      options.windowsHostAuthorityPath = path.resolve(value);
    }
    if (name === "--external-publication-dir") {
      options.externalPublicationDir = path.resolve(value);
    }
    if (name === "--windows-receipt") {
      options.windowsReceiptPath = path.resolve(value);
    }
    if (name === "--completion-path") {
      options.completionPath = path.resolve(value);
    }
    index += 1;
  }
  return { options, writeReadiness };
}

async function runCli() {
  const { options, writeReadiness } = parseOptions(process.argv.slice(2));
  if (writeReadiness) {
    if (
      options.sourceSha ||
      options.releaseSourceSha ||
      options.externalPublicationRunId ||
      options.windowsHostRunId ||
      options.externalPublicationAuthorityPath ||
      options.windowsHostAuthorityPath ||
      options.externalPublicationDir ||
      options.windowsReceiptPath ||
      options.completionPath
    ) {
      throw new Error(
        "--write-readiness cannot be combined with completion inputs",
      );
    }
    const artifact = await collectS1ShellSandboxReadiness(options);
    const artifactPath = resolveRepoPath(
      options.repoRoot,
      options.readinessPath ?? DEFAULT_READINESS_PATH,
    );
    await writeJson(artifactPath, artifact, 0o644);
    console.log(
      `S1 Shell/Sandbox readiness written: blocked ${artifact.contentSha256.slice(
        0,
        16,
      )}`,
    );
    return;
  }
  if (!options.sourceSha) {
    const result = await verifyS1ShellSandboxReadiness(options);
    if (!result.valid) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(
      `S1 Shell/Sandbox readiness verified: blocked by ${result.value.blockers.join(
        ", ",
      )}`,
    );
    return;
  }
  if (!options.completionPath) {
    throw new Error("--completion-path is required with --source-sha");
  }
  const artifact = await collectS1ShellSandboxCompletion({
    ...options,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  await writeJson(options.completionPath, artifact, 0o600);
  const result = await verifyS1ShellSandboxCompletion({
    ...options,
    artifactPath: options.completionPath,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  if (artifact.status !== "complete") {
    console.error(
      `S1 Shell/Sandbox completion blocked: ${artifact.blockers.join(", ")}`,
    );
    process.exitCode = 2;
    return;
  }
  console.log(
    `S1 Shell/Sandbox completion verified: ${result.sha256.slice(0, 16)}`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPackageLockReceipt } from "./check-package-lock.mjs";
import { verifyRuntimeEnvironmentReceipt } from "./check-runtime-environment.mjs";
import { verifyWebDistReceipt } from "./check-web-dist.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultPackageLockReceiptPath =
  "docs/artifacts/package-lock-audit-0.1.0.json";
const defaultRuntimeEnvironmentReceiptPath =
  "docs/artifacts/runtime-environment-audit-0.1.0.json";
const defaultWebDistReceiptPath = "docs/artifacts/web-dist-audit-0.1.0.json";
const defaultWebDistManifestPath = "docs/artifacts/web-dist-0.1.0.sha256";

export async function auditReleaseArtifacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const errors = [];
  const packageLockReceiptPath =
    options.packageLockReceiptPath ?? defaultPackageLockReceiptPath;
  const runtimeEnvironmentReceiptPath =
    options.runtimeEnvironmentReceiptPath ??
    defaultRuntimeEnvironmentReceiptPath;
  const webDistReceiptPath =
    options.webDistReceiptPath ?? defaultWebDistReceiptPath;
  const webDistManifestPath =
    options.webDistManifestPath ?? defaultWebDistManifestPath;
  const rootPackage = parseJson(
    await readTextFile(
      path.join(repoRoot, "package.json"),
      "package.json",
      errors,
    ),
    "package.json",
    errors,
  );

  const [
    packageLockVerification,
    runtimeEnvironmentVerification,
    webDistVerification,
    webDistManifest,
  ] = await Promise.all([
    verifyPackageLockReceipt({
      repoRoot,
      verifyReceiptPath: packageLockReceiptPath,
    }),
    verifyRuntimeEnvironmentReceipt({
      repoRoot,
      verifyReceiptPath: runtimeEnvironmentReceiptPath,
    }),
    verifyWebDistReceipt({
      repoRoot,
      verifyReceiptPath: webDistReceiptPath,
    }),
    readArtifactEvidence(repoRoot, webDistManifestPath, errors),
  ]);

  if (!packageLockVerification.valid) {
    errors.push(
      ...packageLockVerification.errors.map(
        (error) => `package-lock receipt: ${error}`,
      ),
    );
  }
  if (!runtimeEnvironmentVerification.valid) {
    errors.push(
      ...runtimeEnvironmentVerification.errors.map(
        (error) => `runtime-environment receipt: ${error}`,
      ),
    );
  }
  if (!webDistVerification.valid) {
    errors.push(
      ...webDistVerification.errors.map(
        (error) => `web-dist receipt: ${error}`,
      ),
    );
  }

  const artifacts = [
    {
      kind: "package-lock-audit",
      path: packageLockVerification.receiptPath,
      sha256: packageLockVerification.receiptSha256,
      valid: packageLockVerification.valid,
    },
    {
      kind: "runtime-environment-audit",
      path: runtimeEnvironmentVerification.receiptPath,
      sha256: runtimeEnvironmentVerification.receiptSha256,
      valid: runtimeEnvironmentVerification.valid,
    },
    {
      kind: "web-dist-audit",
      path: webDistVerification.receiptPath,
      sha256: webDistVerification.receiptSha256,
      valid: webDistVerification.valid,
    },
    {
      kind: "web-dist-manifest",
      path: webDistManifest.path,
      sha256: webDistManifest.sha256,
      valid: webDistManifest.readable,
    },
  ];
  const artifactSetSha256 = sha256(
    Buffer.from(formatArtifactSetManifest(artifacts), "utf8"),
  );

  return {
    ok: errors.length === 0,
    errors,
    packageName: isRecord(rootPackage) ? rootPackage.name : undefined,
    packageVersion: isRecord(rootPackage) ? rootPackage.version : undefined,
    artifacts,
    artifactSetSha256,
  };
}

export function createReleaseArtifactsReceipt(result) {
  return {
    type: "napier.release-artifacts-audit",
    schemaVersion: 1,
    ok: result.ok,
    package: {
      name: result.packageName ?? null,
      version: result.packageVersion ?? null,
    },
    artifactSetSha256: result.artifactSetSha256,
    artifacts: result.artifacts,
    errors: result.errors,
  };
}

export async function verifyReleaseArtifactsReceipt(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  if (!options.verifyReceiptPath) {
    throw new Error("verifyReceiptPath is required");
  }
  const absoluteReceiptPath = resolveRepoRelativePath(
    repoRoot,
    options.verifyReceiptPath,
    "verifyReceiptPath",
  );
  const errors = [];
  const receiptText = await readTextFile(
    absoluteReceiptPath,
    toRepoRelativePath(repoRoot, absoluteReceiptPath),
    errors,
  );
  const observedReceipt = parseJson(
    receiptText,
    "release artifacts audit receipt",
    errors,
  );
  const currentAudit = await auditReleaseArtifacts(options);
  const expectedReceipt = createReleaseArtifactsReceipt(currentAudit);
  const receiptSha256 = sha256(Buffer.from(receiptText, "utf8"));

  if (!currentAudit.ok) {
    errors.push(
      ...currentAudit.errors.map((error) => `current audit failed: ${error}`),
    );
  }
  if (observedReceipt) {
    validateReleaseArtifactsReceiptShape(observedReceipt, errors);
    if (stableJson(observedReceipt) !== stableJson(expectedReceipt)) {
      errors.push("receipt does not match the current release artifacts audit");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    receiptPath: toRepoRelativePath(repoRoot, absoluteReceiptPath),
    receiptSha256,
    expectedReceipt,
    observedReceipt,
  };
}

export function createReleaseArtifactsVerification(verification) {
  return {
    type: "napier.release-artifacts-audit-verification",
    schemaVersion: 1,
    valid: verification.valid,
    receipt: {
      path: verification.receiptPath,
      sha256: verification.receiptSha256,
    },
    expected: verification.expectedReceipt,
    observed: verification.observedReceipt,
    errors: verification.errors,
  };
}

export function formatReleaseArtifactsAuditResult(result) {
  return [
    "Release artifacts audit passed:",
    `${result.artifacts.length} artifacts`,
    `set ${result.artifactSetSha256.slice(0, 16)}`,
  ].join(" ");
}

async function runCli() {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.verifyReceiptPath) {
    const verification = await verifyReleaseArtifactsReceipt(cliOptions);
    if (cliOptions.json) {
      console.log(
        JSON.stringify(
          createReleaseArtifactsVerification(verification),
          null,
          2,
        ),
      );
    }
    if (!verification.valid) {
      if (!cliOptions.json) {
        console.error("Release artifacts receipt verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!cliOptions.json) {
      console.log(
        `Release artifacts receipt verified: ${verification.receiptPath} ${verification.receiptSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const result = await auditReleaseArtifacts(cliOptions);
  const receipt = createReleaseArtifactsReceipt(result);
  if (cliOptions.receiptPath) {
    await settleReceiptFile({
      receipt,
      receiptPath: cliOptions.receiptPath,
      repoRoot: cliOptions.repoRoot ?? defaultRepoRoot,
    });
  }
  if (cliOptions.json) {
    console.log(JSON.stringify(receipt, null, 2));
  }
  if (!result.ok) {
    if (!cliOptions.json) {
      console.error("Release artifacts audit failed:");
      for (const error of result.errors) console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  if (!cliOptions.json) {
    const receiptSuffix = cliOptions.receiptPath
      ? ` receipt ${toRepoRelativePath(
          path.resolve(cliOptions.repoRoot ?? defaultRepoRoot),
          path.resolve(
            cliOptions.repoRoot ?? defaultRepoRoot,
            cliOptions.receiptPath,
          ),
        )}`
      : "";
    console.log(`${formatReleaseArtifactsAuditResult(result)}${receiptSuffix}`);
  }
}

function parseCliOptions(args) {
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--receipt-path") {
      options.receiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--verify-receipt-path") {
      options.verifyReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--package-lock-receipt-path") {
      options.packageLockReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--runtime-environment-receipt-path") {
      options.runtimeEnvironmentReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--web-dist-receipt-path") {
      options.webDistReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--web-dist-manifest-path") {
      options.webDistManifestPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function readArtifactEvidence(repoRoot, artifactPath, errors) {
  const absolutePath = resolveRepoRelativePath(
    repoRoot,
    artifactPath,
    "artifactPath",
  );
  try {
    const content = await readFile(absolutePath);
    return {
      path: toRepoRelativePath(repoRoot, absolutePath),
      sha256: sha256(content),
      readable: true,
    };
  } catch {
    const relativePath = toRepoRelativePath(repoRoot, absolutePath);
    errors.push(`${relativePath} cannot be read`);
    return {
      path: relativePath,
      sha256: sha256(Buffer.alloc(0)),
      readable: false,
    };
  }
}

async function settleReceiptFile({ receipt, receiptPath, repoRoot }) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteReceiptPath = resolveRepoRelativePath(
    absoluteRepoRoot,
    receiptPath,
    "--receipt-path",
  );
  if (!receipt.ok) {
    await rm(absoluteReceiptPath, { force: true });
    return;
  }
  await mkdir(path.dirname(absoluteReceiptPath), { recursive: true });
  await writeFile(absoluteReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function validateReleaseArtifactsReceiptShape(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push("receipt must be a JSON object");
    return;
  }
  if (receipt.type !== "napier.release-artifacts-audit") {
    errors.push("receipt type must be napier.release-artifacts-audit");
  }
  if (receipt.schemaVersion !== 1) {
    errors.push("receipt schemaVersion must be 1");
  }
  if (receipt.ok !== true) {
    errors.push("receipt must represent a passing audit");
  }
  if (!isRecord(receipt.package)) {
    errors.push("receipt package must be an object");
  } else {
    if (typeof receipt.package.name !== "string") {
      errors.push("receipt package.name must be a string");
    }
    if (typeof receipt.package.version !== "string") {
      errors.push("receipt package.version must be a string");
    }
  }
  if (!isSha256(receipt.artifactSetSha256)) {
    errors.push("receipt artifactSetSha256 must be a SHA-256 hex digest");
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    errors.push("receipt artifacts must be a non-empty array");
  } else {
    for (const [index, artifact] of receipt.artifacts.entries()) {
      if (!isRecord(artifact)) {
        errors.push(`receipt artifacts[${index}] must be an object`);
        continue;
      }
      if (typeof artifact.kind !== "string") {
        errors.push(`receipt artifacts[${index}].kind must be a string`);
      }
      if (typeof artifact.path !== "string") {
        errors.push(`receipt artifacts[${index}].path must be a string`);
      }
      if (!isSha256(artifact.sha256)) {
        errors.push(
          `receipt artifacts[${index}].sha256 must be a SHA-256 hex digest`,
        );
      }
      if (typeof artifact.valid !== "boolean") {
        errors.push(`receipt artifacts[${index}].valid must be boolean`);
      }
    }
  }
  if (!Array.isArray(receipt.errors)) {
    errors.push("receipt errors must be an array");
  } else if (receipt.errors.some((error) => typeof error !== "string")) {
    errors.push("receipt errors must contain only strings");
  }
}

function formatArtifactSetManifest(artifacts) {
  return artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.kind}  ${artifact.path}`)
    .sort()
    .join("\n")
    .concat(artifacts.length > 0 ? "\n" : "");
}

async function readTextFile(filePath, label, errors) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    errors.push(`${label} cannot be read`);
    return "";
  }
}

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function resolveRepoRelativePath(repoRoot, filePath, optionName) {
  if (path.isAbsolute(filePath)) {
    throw new Error(`${optionName} must be a repo-relative path`);
  }
  const absolutePath = path.resolve(repoRoot, filePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${optionName} must stay inside the repo root`);
  }
  return absolutePath;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
  );
}

function toRepoRelativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

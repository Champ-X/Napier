import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveRepoRelativePath,
  settleReceiptFile,
  sha256,
  stableJson,
  toRepoRelativePath,
} from "./content-addressed-receipt.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export async function auditPackageLock(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const packageJsonPath = path.resolve(
    repoRoot,
    options.packageJsonPath ?? "package.json",
  );
  const lockfilePath = path.resolve(
    repoRoot,
    options.lockfilePath ?? "package-lock.json",
  );
  const errors = [];
  const [rootPackageText, lockfileText] = await Promise.all([
    readTextFile(packageJsonPath, "package.json", errors),
    readTextFile(lockfilePath, "package-lock.json", errors),
  ]);
  const rootPackage = parseJson(rootPackageText, "package.json", errors);
  const lockfile = parseJson(lockfileText, "package-lock.json", errors);
  const packages = isRecord(lockfile?.packages) ? lockfile.packages : {};
  const workspacePaths = rootPackage
    ? await discoverWorkspacePackagePaths(
        repoRoot,
        rootPackage.workspaces,
        errors,
      )
    : [];

  if (!isRecord(rootPackage)) {
    errors.push("package.json must be a JSON object");
  }
  if (!isRecord(lockfile)) {
    errors.push("package-lock.json must be a JSON object");
  }
  if (lockfile?.lockfileVersion !== 3) {
    errors.push("package-lock.json lockfileVersion must be 3");
  }
  if (!isRecord(lockfile?.packages)) {
    errors.push("package-lock.json packages must be an object");
  }
  if (rootPackage && lockfile) {
    compareValue(lockfile.name, rootPackage.name, "lockfile name", errors);
    compareValue(
      lockfile.version,
      rootPackage.version,
      "lockfile version",
      errors,
    );
    validateRootLockPackage(rootPackage, packages[""], errors);
  }

  const workspacePackages = [];
  for (const workspacePath of workspacePaths) {
    const packageText = await readTextFile(
      path.join(repoRoot, workspacePath, "package.json"),
      `${workspacePath}/package.json`,
      errors,
    );
    const workspacePackage = parseJson(
      packageText,
      `${workspacePath}/package.json`,
      errors,
    );
    if (!isRecord(workspacePackage)) {
      errors.push(`${workspacePath}/package.json must be a JSON object`);
      continue;
    }
    workspacePackages.push({
      path: workspacePath,
      packageJson: workspacePackage,
    });
    validateWorkspaceLockPackage(
      workspacePath,
      workspacePackage,
      packages,
      errors,
    );
  }
  validateWorkspaceLinks(workspacePackages, packages, errors);
  const externalEvidence = validateExternalPackages(packages, errors);

  return {
    ok: errors.length === 0,
    errors,
    packageLockVersion: lockfile?.lockfileVersion,
    rootPackageName: rootPackage?.name,
    rootPackageVersion: rootPackage?.version,
    workspaceCount: workspacePackages.length,
    packageCount: Object.keys(packages).length,
    externalPackageCount: externalEvidence.externalPackageCount,
    integrityCount: externalEvidence.integrityCount,
    linkCount: externalEvidence.linkCount,
    packageJsonSha256: sha256(Buffer.from(rootPackageText, "utf8")),
    packageLockSha256: sha256(Buffer.from(lockfileText, "utf8")),
  };
}

export function createPackageLockAuditReceipt(result) {
  return {
    type: "napier.package-lock-audit",
    schemaVersion: 1,
    ok: result.ok,
    packageLockVersion: result.packageLockVersion ?? null,
    rootPackage: {
      name: result.rootPackageName ?? null,
      version: result.rootPackageVersion ?? null,
      packageJsonSha256: result.packageJsonSha256,
      packageLockSha256: result.packageLockSha256,
    },
    counts: {
      workspaces: result.workspaceCount,
      packages: result.packageCount,
      externalPackages: result.externalPackageCount,
      integrityEntries: result.integrityCount,
      links: result.linkCount,
    },
    errors: result.errors,
  };
}

export function formatPackageLockAuditResult(result) {
  return [
    "Package lock audit passed:",
    `${result.workspaceCount} workspaces`,
    `${result.packageCount} packages`,
    `${result.integrityCount}/${result.externalPackageCount} integrity`,
    `lock ${result.packageLockSha256.slice(0, 16)}`,
  ].join(" ");
}

export async function verifyPackageLockReceipt(options = {}) {
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
    "package-lock audit receipt",
    errors,
  );
  const currentAudit = await auditPackageLock(options);
  const expectedReceipt = createPackageLockAuditReceipt(currentAudit);
  const receiptSha256 = sha256(Buffer.from(receiptText, "utf8"));

  if (!currentAudit.ok) {
    errors.push(
      ...currentAudit.errors.map((error) => `current audit failed: ${error}`),
    );
  }
  if (observedReceipt) {
    validatePackageLockReceiptShape(observedReceipt, errors);
    if (stableJson(observedReceipt) !== stableJson(expectedReceipt)) {
      errors.push("receipt does not match the current package-lock audit");
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

export function createPackageLockAuditVerification(verification) {
  return {
    type: "napier.package-lock-audit-verification",
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

async function runCli() {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.verifyReceiptPath) {
    const verification = await verifyPackageLockReceipt(cliOptions);
    if (cliOptions.json) {
      console.log(
        JSON.stringify(
          createPackageLockAuditVerification(verification),
          null,
          2,
        ),
      );
    }
    if (!verification.valid) {
      if (!cliOptions.json) {
        console.error("Package lock receipt verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!cliOptions.json) {
      console.log(
        `Package lock receipt verified: ${verification.receiptPath} ${verification.receiptSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const result = await auditPackageLock(cliOptions);
  const receipt = createPackageLockAuditReceipt(result);
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
      console.error("Package lock audit failed:");
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
    console.log(`${formatPackageLockAuditResult(result)}${receiptSuffix}`);
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
    if (arg === "--package-json-path") {
      options.packageJsonPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--lockfile-path") {
      options.lockfilePath = readCliValue(args, index, arg);
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
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function discoverWorkspacePackagePaths(repoRoot, workspaces, errors) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    errors.push("package.json workspaces must be a non-empty array");
    return [];
  }
  const workspacePaths = [];
  for (const pattern of workspaces) {
    if (typeof pattern !== "string" || !pattern.endsWith("/*")) {
      errors.push(`unsupported workspace pattern: ${String(pattern)}`);
      continue;
    }
    const parentPath = pattern.slice(0, -2);
    const absoluteParentPath = path.join(repoRoot, parentPath);
    const entries = await readdir(absoluteParentPath, {
      withFileTypes: true,
    }).catch(() => {
      errors.push(`${parentPath} workspace root cannot be listed`);
      return [];
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspacePath = path.posix.join(parentPath, entry.name);
      const packageJsonPath = path.join(
        repoRoot,
        workspacePath,
        "package.json",
      );
      try {
        await readFile(packageJsonPath);
        workspacePaths.push(workspacePath);
      } catch {
        errors.push(`${workspacePath}/package.json cannot be read`);
      }
    }
  }
  return workspacePaths.sort();
}

function validateRootLockPackage(rootPackage, rootLockPackage, errors) {
  if (!isRecord(rootLockPackage)) {
    errors.push('lockfile packages[""] must be an object');
    return;
  }
  for (const field of ["name", "version", "workspaces", "engines"]) {
    compareValue(
      rootLockPackage[field],
      rootPackage[field],
      `lockfile root ${field}`,
      errors,
    );
  }
  compareDependencyFields(
    rootPackage,
    rootLockPackage,
    "lockfile root",
    errors,
  );
}

function validateWorkspaceLockPackage(
  workspacePath,
  workspacePackage,
  packages,
  errors,
) {
  const lockPackage = packages[workspacePath];
  if (!isRecord(lockPackage)) {
    errors.push(`${workspacePath} is missing from package-lock packages`);
    return;
  }
  compareValue(
    lockPackage.name,
    workspacePackage.name,
    `${workspacePath} lockfile name`,
    errors,
  );
  compareValue(
    lockPackage.version,
    workspacePackage.version,
    `${workspacePath} lockfile version`,
    errors,
  );
  compareDependencyFields(workspacePackage, lockPackage, workspacePath, errors);
}

function validateWorkspaceLinks(workspacePackages, packages, errors) {
  const expectedLinks = new Map(
    workspacePackages.map(({ path: workspacePath, packageJson }) => [
      `node_modules/${packageJson.name}`,
      workspacePath,
    ]),
  );
  for (const [linkPath, workspacePath] of expectedLinks) {
    const linkPackage = packages[linkPath];
    if (!isRecord(linkPackage)) {
      errors.push(`${linkPath} workspace link is missing from package-lock`);
      continue;
    }
    if (linkPackage.link !== true) {
      errors.push(`${linkPath} must be a lockfile link`);
    }
    compareValue(
      linkPackage.resolved,
      workspacePath,
      `${linkPath} resolved workspace path`,
      errors,
    );
  }
  for (const [packagePath, packageInfo] of Object.entries(packages)) {
    if (!packageInfo?.link) continue;
    if (!expectedLinks.has(packagePath)) {
      errors.push(`${packagePath} is an unexpected lockfile link`);
    }
  }
}

function validateExternalPackages(packages, errors) {
  let externalPackageCount = 0;
  let integrityCount = 0;
  let linkCount = 0;
  for (const [packagePath, packageInfo] of Object.entries(packages)) {
    if (!packagePath.startsWith("node_modules/")) continue;
    if (packageInfo?.link === true) {
      linkCount += 1;
      continue;
    }
    externalPackageCount += 1;
    if (typeof packageInfo?.version !== "string") {
      errors.push(`${packagePath} is missing a package version`);
    }
    if (typeof packageInfo?.resolved !== "string") {
      errors.push(`${packagePath} is missing a resolved source`);
    }
    if (typeof packageInfo?.integrity !== "string") {
      errors.push(`${packagePath} is missing an integrity hash`);
    } else {
      integrityCount += 1;
    }
  }
  return { externalPackageCount, integrityCount, linkCount };
}

function compareDependencyFields(sourcePackage, lockPackage, label, errors) {
  for (const field of dependencyFields) {
    compareValue(
      lockPackage[field],
      sourcePackage[field],
      `${label} ${field}`,
      errors,
    );
  }
}

function compareValue(observed, expected, label, errors) {
  if (stableJson(observed ?? null) !== stableJson(expected ?? null)) {
    errors.push(`${label} does not match package.json`);
  }
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

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function validatePackageLockReceiptShape(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push("receipt must be a JSON object");
    return;
  }
  if (receipt.type !== "napier.package-lock-audit") {
    errors.push("receipt type must be napier.package-lock-audit");
  }
  if (receipt.schemaVersion !== 1) {
    errors.push("receipt schemaVersion must be 1");
  }
  if (receipt.ok !== true) {
    errors.push("receipt must represent a passing audit");
  }
  if (!Number.isSafeInteger(receipt.packageLockVersion)) {
    errors.push("receipt packageLockVersion must be an integer");
  }
  if (!isRecord(receipt.rootPackage)) {
    errors.push("receipt rootPackage must be an object");
  } else {
    if (typeof receipt.rootPackage.name !== "string") {
      errors.push("receipt rootPackage.name must be a string");
    }
    if (typeof receipt.rootPackage.version !== "string") {
      errors.push("receipt rootPackage.version must be a string");
    }
    if (!isSha256(receipt.rootPackage.packageJsonSha256)) {
      errors.push(
        "receipt rootPackage.packageJsonSha256 must be a SHA-256 hex digest",
      );
    }
    if (!isSha256(receipt.rootPackage.packageLockSha256)) {
      errors.push(
        "receipt rootPackage.packageLockSha256 must be a SHA-256 hex digest",
      );
    }
  }
  if (!isRecord(receipt.counts)) {
    errors.push("receipt counts must be an object");
  } else {
    for (const field of [
      "workspaces",
      "packages",
      "externalPackages",
      "integrityEntries",
      "links",
    ]) {
      if (
        !Number.isSafeInteger(receipt.counts[field]) ||
        receipt.counts[field] < 0
      ) {
        errors.push(`receipt counts.${field} must be a non-negative integer`);
      }
    }
  }
  if (!Array.isArray(receipt.errors)) {
    errors.push("receipt errors must be an array");
  } else if (receipt.errors.some((error) => typeof error !== "string")) {
    errors.push("receipt errors must contain only strings");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

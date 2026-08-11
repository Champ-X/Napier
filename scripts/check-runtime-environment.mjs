import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const requiredComponents = ["sqlite", "openssl", "uv", "v8"];
const supportedHosts = [
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "arm64" },
  { platform: "linux", arch: "x64" },
];

export async function auditRuntimeEnvironment(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const packageJsonPath = resolveRepoRelativePath(
    repoRoot,
    options.packageJsonPath ?? "package.json",
    "packageJsonPath",
  );
  const errors = [];
  const packageJsonText = await readTextFile(
    packageJsonPath,
    "package.json",
    errors,
  );
  const packageJson = parseJson(packageJsonText, "package.json", errors);
  const nodeVersion = normalizeNodeVersion(
    options.nodeVersion ?? process.versions.node,
  );
  const nodeRange = packageJson?.engines?.node;
  const componentVersions = Object.fromEntries(
    requiredComponents.map((component) => [
      component,
      options.versions?.[component] ?? process.versions[component],
    ]),
  );

  if (!isRecord(packageJson)) {
    errors.push("package.json must be a JSON object");
  }
  if (typeof nodeRange !== "string") {
    errors.push("package.json engines.node must be a string");
  }
  const nodeSatisfies =
    typeof nodeRange === "string"
      ? satisfiesNodeRange(nodeVersion, nodeRange, errors)
      : false;
  if (!nodeSatisfies && typeof nodeRange === "string") {
    errors.push(
      `Node ${nodeVersion} does not satisfy engines.node ${nodeRange}`,
    );
  }
  for (const component of requiredComponents) {
    if (
      typeof componentVersions[component] !== "string" ||
      !componentVersions[component]
    ) {
      errors.push(`process.versions.${component} must be available`);
    }
  }
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const hostSupported = supportedHosts.some(
    (host) => host.platform === platform && host.arch === arch,
  );
  if (!hostSupported) {
    errors.push(
      `Host ${platform}/${arch} is not in the supported release matrix`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    packageName: packageJson?.name,
    packageVersion: packageJson?.version,
    packageJsonSha256: sha256(Buffer.from(packageJsonText, "utf8")),
    nodeVersion,
    nodeRange,
    nodeSatisfies,
    platform,
    arch,
    hostSupported,
    components: componentVersions,
  };
}

export function createRuntimeEnvironmentReceipt(result) {
  return {
    type: "napier.runtime-environment-audit",
    schemaVersion: 2,
    ok: result.ok,
    package: {
      name: result.packageName ?? null,
      version: result.packageVersion ?? null,
      packageJsonSha256: result.packageJsonSha256,
    },
    node: {
      version: result.nodeVersion,
      required: result.nodeRange ?? null,
      satisfies: result.nodeSatisfies,
      components: result.components,
    },
    supportedHosts,
    errors: result.errors,
  };
}

export function formatRuntimeEnvironmentAuditResult(result) {
  return [
    "Runtime environment audit passed:",
    `node ${result.nodeVersion}`,
    `required ${result.nodeRange}`,
    `${result.platform}/${result.arch}`,
    `package ${result.packageJsonSha256.slice(0, 16)}`,
  ].join(" ");
}

export async function verifyRuntimeEnvironmentReceipt(options = {}) {
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
    "runtime environment audit receipt",
    errors,
  );
  const currentAudit = await auditRuntimeEnvironment(options);
  const expectedReceipt = createRuntimeEnvironmentReceipt(currentAudit);
  const receiptSha256 = sha256(Buffer.from(receiptText, "utf8"));

  if (!currentAudit.ok) {
    errors.push(
      ...currentAudit.errors.map((error) => `current audit failed: ${error}`),
    );
  }
  if (observedReceipt) {
    validateRuntimeEnvironmentReceiptShape(observedReceipt, errors);
    if (
      stableJson(observedReceipt) !== stableJson(expectedReceipt) ||
      !currentAudit.hostSupported
    ) {
      errors.push(
        "receipt does not match the current runtime environment audit",
      );
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

export function createRuntimeEnvironmentVerification(verification) {
  return {
    type: "napier.runtime-environment-audit-verification",
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
    const verification = await verifyRuntimeEnvironmentReceipt(cliOptions);
    if (cliOptions.json) {
      console.log(
        JSON.stringify(
          createRuntimeEnvironmentVerification(verification),
          null,
          2,
        ),
      );
    }
    if (!verification.valid) {
      if (!cliOptions.json) {
        console.error("Runtime environment receipt verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!cliOptions.json) {
      console.log(
        `Runtime environment receipt verified: ${verification.receiptPath} ${verification.receiptSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const result = await auditRuntimeEnvironment(cliOptions);
  const receipt = createRuntimeEnvironmentReceipt(result);
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
      console.error("Runtime environment audit failed:");
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
    console.log(
      `${formatRuntimeEnvironmentAuditResult(result)}${receiptSuffix}`,
    );
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

function satisfiesNodeRange(version, range, errors) {
  const match = range.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    errors.push(`unsupported engines.node range: ${range}`);
    return false;
  }
  const minimum = match.slice(1).map((part) => Number(part));
  const current = parseVersion(version);
  if (!current) {
    errors.push(`Node version is not semver: ${version}`);
    return false;
  }
  return compareVersions(current, minimum) >= 0;
}

function normalizeNodeVersion(version) {
  return String(version).replace(/^v/, "");
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map((part) => Number(part)) : undefined;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
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

function validateRuntimeEnvironmentReceiptShape(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push("receipt must be a JSON object");
    return;
  }
  if (receipt.type !== "napier.runtime-environment-audit") {
    errors.push("receipt type must be napier.runtime-environment-audit");
  }
  if (receipt.schemaVersion !== 2) {
    errors.push("receipt schemaVersion must be 2");
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
    if (!isSha256(receipt.package.packageJsonSha256)) {
      errors.push(
        "receipt package.packageJsonSha256 must be a SHA-256 hex digest",
      );
    }
  }
  if (!isRecord(receipt.node)) {
    errors.push("receipt node must be an object");
  } else {
    for (const field of ["version", "required"]) {
      if (typeof receipt.node[field] !== "string") {
        errors.push(`receipt node.${field} must be a string`);
      }
    }
    if (receipt.node.satisfies !== true) {
      errors.push("receipt node.satisfies must be true");
    }
    if (!isRecord(receipt.node.components)) {
      errors.push("receipt node.components must be an object");
    } else {
      for (const component of requiredComponents) {
        if (typeof receipt.node.components[component] !== "string") {
          errors.push(`receipt node.components.${component} must be a string`);
        }
      }
    }
  }
  if (
    !Array.isArray(receipt.supportedHosts) ||
    stableJson(receipt.supportedHosts) !== stableJson(supportedHosts)
  ) {
    errors.push("receipt supportedHosts must match the release matrix");
  }
  if (!Array.isArray(receipt.errors)) {
    errors.push("receipt errors must be an array");
  } else if (receipt.errors.some((error) => typeof error !== "string")) {
    errors.push("receipt errors must contain only strings");
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

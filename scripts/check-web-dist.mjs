import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultManifestRoot = "apps/web/dist";
const defaultMainEntryBudgetBytes = 150 * 1024;

export async function generateWebDistManifest(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const manifestRoot = options.manifestRoot ?? defaultManifestRoot;
  const distRoot = path.join(repoRoot, manifestRoot);
  const errors = [];
  const actualFiles = await listDistFiles(repoRoot, distRoot).catch(() => {
    errors.push(`${manifestRoot} cannot be listed`);
    return [];
  });
  const observedFiles = await readObservedDistFiles(
    repoRoot,
    actualFiles,
    errors,
  );
  if (errors.length > 0) {
    throw new Error(`Cannot generate Web dist manifest: ${errors.join("; ")}`);
  }
  const manifestText = formatCanonicalManifest(observedFiles);
  return {
    fileCount: actualFiles.length,
    manifestRoot,
    manifestText,
    distContentSha256: sha256(Buffer.from(manifestText, "utf8")),
  };
}

export async function auditWebDist(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const manifestRoot = options.manifestRoot ?? defaultManifestRoot;
  const distRoot = path.join(repoRoot, manifestRoot);
  const manifestPath = path.resolve(
    repoRoot,
    options.manifestPath ?? "docs/artifacts/web-dist-0.1.0.sha256",
  );
  const manifestRelativePath = toManifestPath(repoRoot, manifestPath);
  const mainEntryBudgetBytes =
    options.mainEntryBudgetBytes ?? defaultMainEntryBudgetBytes;
  const errors = [];
  const [manifestText, actualFiles, indexHtml] = await Promise.all([
    readTextFile(manifestPath, manifestRelativePath, errors),
    listDistFiles(repoRoot, distRoot).catch(() => {
      errors.push(`${manifestRoot} cannot be listed`);
      return [];
    }),
    readTextFile(
      path.join(distRoot, "index.html"),
      `${manifestRoot}/index.html`,
      errors,
    ),
  ]);

  const manifestEntries = parseManifest(manifestText, manifestRoot, errors);
  const manifestFiles = [...manifestEntries.keys()].sort();
  const observedFiles = await readObservedDistFiles(
    repoRoot,
    actualFiles,
    errors,
  );
  const distContentSha256 = sha256(
    Buffer.from(formatCanonicalManifest(observedFiles), "utf8"),
  );

  compareFileSets(manifestFiles, actualFiles, errors);

  for (const filePath of manifestFiles) {
    const expectedHash = manifestEntries.get(filePath);
    if (!expectedHash) continue;
    const observed = observedFiles.get(filePath);
    if (!observed) {
      errors.push(`${filePath} listed in manifest but cannot be read`);
    } else if (observed.sha256 !== expectedHash) {
      errors.push(
        `${filePath} hash mismatch: expected ${expectedHash}, observed ${observed.sha256}`,
      );
    }
  }

  const mainEntryPath = findMainEntryPath(indexHtml, manifestRoot, errors);
  let mainEntryBytes = 0;
  if (mainEntryPath) {
    if (!manifestEntries.has(mainEntryPath)) {
      errors.push(
        `${mainEntryPath} is the main entry but is missing from manifest`,
      );
    }
    const mainEntry = observedFiles.get(mainEntryPath);
    if (mainEntry) {
      mainEntryBytes = mainEntry.sizeBytes;
      if (mainEntryBytes > mainEntryBudgetBytes) {
        errors.push(
          `${mainEntryPath} is ${formatBytes(mainEntryBytes)}, above the ${formatBytes(
            mainEntryBudgetBytes,
          )} main-entry budget`,
        );
      }
    } else {
      errors.push(`${mainEntryPath} is the main entry but cannot be read`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    fileCount: actualFiles.length,
    mainEntryPath,
    mainEntryBytes,
    mainEntryBudgetBytes,
    mainEntryWithinBudget:
      Boolean(mainEntryPath) && mainEntryBytes <= mainEntryBudgetBytes,
    manifestPath: manifestRelativePath,
    manifestSha256: sha256(Buffer.from(manifestText, "utf8")),
    distContentSha256,
  };
}

export function formatAuditResult(result) {
  return [
    "Web dist audit passed:",
    `${result.fileCount} files`,
    result.mainEntryPath
      ? `main ${result.mainEntryPath}`
      : "main entry unavailable",
    `${formatBytes(result.mainEntryBytes)} / ${formatBytes(
      result.mainEntryBudgetBytes,
    )}`,
    `manifest ${result.manifestSha256.slice(0, 16)}`,
    `dist ${result.distContentSha256.slice(0, 16)}`,
  ].join(" ");
}

export function createAuditReceipt(result) {
  return {
    type: "napier.web-dist-audit",
    schemaVersion: 1,
    ok: result.ok,
    fileCount: result.fileCount,
    mainEntry: {
      path: result.mainEntryPath ?? null,
      sizeBytes: result.mainEntryBytes,
      budgetBytes: result.mainEntryBudgetBytes,
      withinBudget: result.mainEntryWithinBudget,
    },
    manifest: {
      path: result.manifestPath,
      sha256: result.manifestSha256,
    },
    distContentSha256: result.distContentSha256,
    errors: result.errors,
  };
}

export async function verifyWebDistReceipt(options = {}) {
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
    toManifestPath(repoRoot, absoluteReceiptPath),
    errors,
  );
  const observedReceipt = parseJsonReceipt(receiptText, errors);
  const currentAudit = await auditWebDist(options);
  const expectedReceipt = createAuditReceipt(currentAudit);
  const receiptSha256 = sha256(Buffer.from(receiptText, "utf8"));

  if (!currentAudit.ok) {
    errors.push(
      ...currentAudit.errors.map((error) => `current audit failed: ${error}`),
    );
  }
  if (observedReceipt) {
    validateAuditReceiptShape(observedReceipt, errors);
    if (stableJson(observedReceipt) !== stableJson(expectedReceipt)) {
      errors.push("receipt does not match the current Web dist audit");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    receiptPath: toManifestPath(repoRoot, absoluteReceiptPath),
    receiptSha256,
    expectedReceipt,
    observedReceipt,
  };
}

export function createAuditReceiptVerification(verification) {
  return {
    type: "napier.web-dist-audit-verification",
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
    const verification = await verifyWebDistReceipt(cliOptions);
    if (cliOptions.json) {
      console.log(
        JSON.stringify(createAuditReceiptVerification(verification), null, 2),
      );
    }
    if (!verification.valid) {
      if (!cliOptions.json) {
        console.error("Web dist receipt verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!cliOptions.json) {
      console.log(
        `Web dist receipt verified: ${verification.receiptPath} ${verification.receiptSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const result = await auditWebDist(cliOptions);
  const receipt = createAuditReceipt(result);
  if (cliOptions.receiptPath) {
    await settleReceiptFile({
      receipt,
      receiptPath: cliOptions.receiptPath,
      repoRoot: cliOptions.repoRoot ?? defaultRepoRoot,
    });
  }
  if (cliOptions.json) {
    console.log(JSON.stringify(receipt, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    console.error("Web dist audit failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const receiptSuffix = cliOptions.receiptPath
    ? ` receipt ${toManifestPath(
        path.resolve(cliOptions.repoRoot ?? defaultRepoRoot),
        path.resolve(
          cliOptions.repoRoot ?? defaultRepoRoot,
          cliOptions.receiptPath,
        ),
      )}`
    : "";
  console.log(`${formatAuditResult(result)}${receiptSuffix}`);
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
    if (arg === "--manifest-root") {
      options.manifestRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--manifest-path") {
      options.manifestPath = readCliValue(args, index, arg);
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
    if (arg === "--main-entry-budget-bytes") {
      const value = Number(readCliValue(args, index, arg));
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${arg} must be a non-negative safe integer`);
      }
      options.mainEntryBudgetBytes = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
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

function parseJsonReceipt(receiptText, errors) {
  try {
    return JSON.parse(receiptText);
  } catch {
    errors.push("receipt is not valid JSON");
    return undefined;
  }
}

function validateAuditReceiptShape(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push("receipt must be a JSON object");
    return;
  }
  if (receipt.type !== "napier.web-dist-audit") {
    errors.push("receipt type must be napier.web-dist-audit");
  }
  if (receipt.schemaVersion !== 1) {
    errors.push("receipt schemaVersion must be 1");
  }
  if (receipt.ok !== true) {
    errors.push("receipt must represent a passing audit");
  }
  if (!Number.isSafeInteger(receipt.fileCount) || receipt.fileCount < 0) {
    errors.push("receipt fileCount must be a non-negative integer");
  }
  if (!isRecord(receipt.mainEntry)) {
    errors.push("receipt mainEntry must be an object");
  } else {
    if (typeof receipt.mainEntry.path !== "string") {
      errors.push("receipt mainEntry.path must be a string");
    }
    if (
      !Number.isSafeInteger(receipt.mainEntry.sizeBytes) ||
      receipt.mainEntry.sizeBytes < 0
    ) {
      errors.push("receipt mainEntry.sizeBytes must be a non-negative integer");
    }
    if (
      !Number.isSafeInteger(receipt.mainEntry.budgetBytes) ||
      receipt.mainEntry.budgetBytes < 0
    ) {
      errors.push(
        "receipt mainEntry.budgetBytes must be a non-negative integer",
      );
    }
    if (typeof receipt.mainEntry.withinBudget !== "boolean") {
      errors.push("receipt mainEntry.withinBudget must be boolean");
    }
  }
  if (!isRecord(receipt.manifest)) {
    errors.push("receipt manifest must be an object");
  } else {
    if (typeof receipt.manifest.path !== "string") {
      errors.push("receipt manifest.path must be a string");
    }
    if (!isSha256(receipt.manifest.sha256)) {
      errors.push("receipt manifest.sha256 must be a SHA-256 hex digest");
    }
  }
  if (!isSha256(receipt.distContentSha256)) {
    errors.push("receipt distContentSha256 must be a SHA-256 hex digest");
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

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function readTextFile(filePath, label, errors) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    errors.push(`${label} cannot be read`);
    return "";
  }
}

async function readObservedDistFiles(repoRoot, actualFiles, errors) {
  const files = new Map();
  for (const filePath of actualFiles) {
    try {
      const content = await readFile(path.join(repoRoot, filePath));
      files.set(filePath, {
        sha256: sha256(content),
        sizeBytes: content.byteLength,
      });
    } catch {
      errors.push(`${filePath} exists but cannot be read`);
    }
  }
  return files;
}

function formatCanonicalManifest(files) {
  return [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, evidence]) => `${evidence.sha256}  ${filePath}`)
    .join("\n")
    .concat(files.size > 0 ? "\n" : "");
}

async function listDistFiles(repoRoot, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDistFiles(repoRoot, absolutePath)));
    } else if (entry.isFile()) {
      files.push(toManifestPath(repoRoot, absolutePath));
    } else {
      throw new Error(
        `Unsupported dist entry: ${toManifestPath(repoRoot, absolutePath)}`,
      );
    }
  }
  return files.sort();
}

function parseManifest(manifestText, manifestRoot, errors) {
  const entries = new Map();
  for (const [index, rawLine] of manifestText.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) {
      errors.push(`manifest line ${index + 1} is not a shasum -a 256 entry`);
      continue;
    }
    const [, hash, filePath] = match;
    if (!filePath.startsWith(`${manifestRoot}/`)) {
      errors.push(
        `manifest line ${index + 1} is outside ${manifestRoot}: ${filePath}`,
      );
      continue;
    }
    if (filePath !== path.posix.normalize(filePath)) {
      errors.push(`manifest line ${index + 1} is not normalized: ${filePath}`);
      continue;
    }
    if (entries.has(filePath)) {
      errors.push(`manifest line ${index + 1} duplicates ${filePath}`);
      continue;
    }
    entries.set(filePath, hash);
  }
  return entries;
}

function compareFileSets(manifestFiles, actualFiles, errors) {
  const manifestSet = new Set(manifestFiles);
  const actualSet = new Set(actualFiles);
  for (const filePath of manifestFiles) {
    if (!actualSet.has(filePath))
      errors.push(`${filePath} is listed but missing from dist`);
  }
  for (const filePath of actualFiles) {
    if (!manifestSet.has(filePath))
      errors.push(`${filePath} exists but is missing from manifest`);
  }
}

function findMainEntryPath(indexHtml, manifestRoot, errors) {
  const moduleScripts = [];
  for (const match of indexHtml.matchAll(/<script\b([^>]*)><\/script>/g)) {
    const attributes = match[1] ?? "";
    if (!/\btype=["']module["']/.test(attributes)) continue;
    const src = attributes.match(/\bsrc=["']([^"']+)["']/)?.[1];
    if (src) moduleScripts.push(src);
  }
  if (moduleScripts.length !== 1) {
    errors.push(
      `expected exactly one module script in index.html, found ${moduleScripts.length}`,
    );
    return undefined;
  }
  const source = moduleScripts[0].replace(/^\/+/, "");
  const filePath = path.posix.join(manifestRoot, source);
  if (
    !filePath.startsWith(`${manifestRoot}/assets/`) ||
    !filePath.endsWith(".js")
  ) {
    errors.push(
      `module script is not an asset JavaScript entry: ${moduleScripts[0]}`,
    );
    return undefined;
  }
  return filePath;
}

function toManifestPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function settleReceiptFile({ receipt, receiptPath, repoRoot }) {
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
  const temporaryPath = `${absoluteReceiptPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, absoluteReceiptPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function resolveRepoRelativePath(repoRoot, filePath, optionName) {
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

export function toRepoRelativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

export function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

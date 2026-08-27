import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectPublicApi,
  readHygieneBaseline,
} from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditPublicApi(repoRoot = process.cwd()) {
  const baseline = await readHygieneBaseline(repoRoot);
  const budget = baseline.publicApi;
  const errors = [];
  validateBudget(budget, errors);
  if (errors.length > 0) {
    return { ok: false, errors, observed: undefined, budget };
  }
  const observed = await collectPublicApi(repoRoot);
  for (const [field, maximumField] of [
    ["runtimeRootExports", "maximumRuntimeRootExports"],
    ["runtimeRootSemanticExports", "maximumRuntimeRootSemanticExports"],
    ["runtimePackageExportKeys", "maximumRuntimePackageExportKeys"],
    ["runtimeInternalSemanticExports", "maximumRuntimeInternalSemanticExports"],
    ["internalRuntimeRootImportFiles", "maximumInternalRuntimeRootImportFiles"],
    ["webDuplicateDefaultExports", "maximumWebDuplicateDefaultExports"],
  ]) {
    if (observed[field] > budget[maximumField]) {
      errors.push(
        `${field} ${String(observed[field])} exceeds ${String(budget[maximumField])}`,
      );
    } else if (observed[field] < budget[maximumField]) {
      errors.push(
        `${field} budget is stale: lower ${String(budget[maximumField])} to ${String(observed[field])}`,
      );
    }
  }
  if (
    observed.runtimeRootSemanticExportSha256 !==
    budget.runtimeRootSemanticExportSha256
  ) {
    errors.push(
      "runtimeRootSemanticExportSha256 does not match the compatibility surface",
    );
  }
  if (
    observed.runtimePackageExportKeysSha256 !==
    budget.runtimePackageExportKeysSha256
  ) {
    errors.push(
      "runtimePackageExportKeysSha256 does not match the reviewed package entry set",
    );
  }
  if (
    observed.runtimeInternalSemanticExportSha256 !==
    budget.runtimeInternalSemanticExportSha256
  ) {
    errors.push(
      "runtimeInternalSemanticExportSha256 does not match the reviewed internal surface",
    );
  }
  for (const [entry, maximum] of Object.entries(
    budget.runtimeFacadeSemanticExports,
  )) {
    const count = observed.runtimeFacadeSemanticExports[entry];
    if (count > maximum) {
      errors.push(
        `runtime facade ${entry} has ${String(count)} semantic exports, exceeding the ${String(maximum)} budget`,
      );
    } else if (count < maximum) {
      errors.push(
        `runtime facade ${entry} semantic export budget is stale: lower ${String(maximum)} to ${String(count)}`,
      );
    }
    if (
      observed.runtimeFacadeSemanticExportSha256[entry] !==
      budget.runtimeFacadeSemanticExportSha256[entry]
    ) {
      errors.push(
        `runtime facade ${entry} semantic export digest does not match the reviewed surface`,
      );
    }
  }
  return { ok: errors.length === 0, errors, observed, budget };
}

function validateBudget(budget, errors) {
  const facadeEntries = [
    "agent",
    "browser",
    "code",
    "core",
    "evaluation",
    "governance",
    "model",
    "store",
    "subagents",
    "tools",
    "workflow",
  ];
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    errors.push("publicApi budget must be an object");
    return;
  }
  for (const field of [
    "maximumRuntimeRootExports",
    "maximumRuntimeRootSemanticExports",
    "maximumRuntimePackageExportKeys",
    "maximumRuntimeInternalSemanticExports",
    "maximumInternalRuntimeRootImportFiles",
    "maximumWebDuplicateDefaultExports",
  ]) {
    if (!Number.isSafeInteger(budget[field]) || budget[field] < 0) {
      errors.push(`publicApi ${field} must be a non-negative integer`);
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(budget.runtimeRootSemanticExportSha256 ?? "")) {
    errors.push(
      "publicApi runtimeRootSemanticExportSha256 must be a sha256 digest",
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(budget.runtimePackageExportKeysSha256 ?? "")) {
    errors.push(
      "publicApi runtimePackageExportKeysSha256 must be a sha256 digest",
    );
  }
  if (
    !/^[a-f0-9]{64}$/u.test(budget.runtimeInternalSemanticExportSha256 ?? "")
  ) {
    errors.push(
      "publicApi runtimeInternalSemanticExportSha256 must be a sha256 digest",
    );
  }
  if (
    !budget.runtimeFacadeSemanticExports ||
    typeof budget.runtimeFacadeSemanticExports !== "object" ||
    Array.isArray(budget.runtimeFacadeSemanticExports)
  ) {
    errors.push("publicApi runtimeFacadeSemanticExports must be an object");
    return;
  }
  if (
    !budget.runtimeFacadeSemanticExportSha256 ||
    typeof budget.runtimeFacadeSemanticExportSha256 !== "object" ||
    Array.isArray(budget.runtimeFacadeSemanticExportSha256)
  ) {
    errors.push(
      "publicApi runtimeFacadeSemanticExportSha256 must be an object",
    );
    return;
  }
  for (const [entry, value] of Object.entries(
    budget.runtimeFacadeSemanticExports,
  )) {
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(
        `publicApi runtime facade ${entry} budget must be a non-negative integer`,
      );
    }
  }
  for (const entry of facadeEntries) {
    if (!(entry in budget.runtimeFacadeSemanticExports)) {
      errors.push(`publicApi runtime facade budget is missing: ${entry}`);
    }
    if (
      !/^[a-f0-9]{64}$/u.test(
        budget.runtimeFacadeSemanticExportSha256[entry] ?? "",
      )
    ) {
      errors.push(
        `publicApi runtime facade digest is missing or invalid: ${entry}`,
      );
    }
  }
  for (const entry of Object.keys(budget.runtimeFacadeSemanticExports)) {
    if (!facadeEntries.includes(entry)) {
      errors.push(`publicApi runtime facade budget is unknown: ${entry}`);
    }
  }
  for (const entry of Object.keys(budget.runtimeFacadeSemanticExportSha256)) {
    if (!facadeEntries.includes(entry)) {
      errors.push(`publicApi runtime facade digest is unknown: ${entry}`);
    }
  }
}

async function main() {
  const result = await auditPublicApi();
  if (!result.ok) {
    console.error(`Public API audit failed:\n- ${result.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Public API audit passed: ${String(result.observed.runtimeRootSemanticExports)} Runtime root symbols, ${String(result.observed.runtimePackageExportKeys)} package entries, ${String(result.observed.internalRuntimeRootImportFiles)} internal root consumers`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectPublicApi,
  readHygieneBaseline,
} from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditPublicApi(repoRoot = process.cwd()) {
  const [baseline, observed] = await Promise.all([
    readHygieneBaseline(repoRoot),
    collectPublicApi(repoRoot),
  ]);
  const budget = baseline.publicApi;
  const errors = [];
  for (const [field, maximumField] of [
    ["runtimeRootExports", "maximumRuntimeRootExports"],
    ["internalRuntimeRootImportFiles", "maximumInternalRuntimeRootImportFiles"],
    ["webDuplicateDefaultExports", "maximumWebDuplicateDefaultExports"],
  ]) {
    if (observed[field] > budget[maximumField])
      errors.push(
        `${field} ${String(observed[field])} exceeds ${String(budget[maximumField])}`,
      );
  }
  return { ok: errors.length === 0, errors, observed, budget };
}

async function main() {
  const result = await auditPublicApi();
  if (!result.ok) {
    console.error(`Public API audit failed:\n- ${result.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Public API audit passed: ${String(result.observed.runtimeRootExports)} Runtime root exports, ${String(result.observed.internalRuntimeRootImportFiles)} internal root consumers, ${String(result.observed.webDuplicateDefaultExports)} duplicate Web default exports`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

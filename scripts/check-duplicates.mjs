import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectDuplicateStatistics,
  readHygieneBaseline,
} from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditDuplicates(repoRoot = process.cwd()) {
  const [baseline, observed] = await Promise.all([
    readHygieneBaseline(repoRoot),
    collectDuplicateStatistics(repoRoot),
  ]);
  const budget = baseline.duplicates;
  const errors = [];
  if (observed.clones > budget.maximumCloneCount)
    errors.push(
      `clone count ${String(observed.clones)} exceeds ${String(budget.maximumCloneCount)}`,
    );
  if (observed.duplicatedLines > budget.maximumDuplicatedLines)
    errors.push(
      `duplicated lines ${String(observed.duplicatedLines)} exceeds ${String(budget.maximumDuplicatedLines)}`,
    );
  return { ok: errors.length === 0, errors, observed, budget };
}

async function main() {
  const result = await auditDuplicates();
  if (!result.ok) {
    console.error(`Duplicate audit failed:\n- ${result.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Duplicate audit passed: ${String(result.observed.clones)} clones, ${String(result.observed.duplicatedLines)} duplicated lines`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

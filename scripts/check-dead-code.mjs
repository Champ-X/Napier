import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectKnipIssues,
  productionUnreachableWebFiles,
  readHygieneBaseline,
  readScriptRegistry,
} from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditDeadCode(repoRoot = process.cwd()) {
  const [baseline, registry, knipIssues, unreachable] = await Promise.all([
    readHygieneBaseline(repoRoot),
    readScriptRegistry(repoRoot),
    collectKnipIssues(repoRoot),
    productionUnreachableWebFiles(repoRoot),
  ]);
  const allowedFiles = new Set(baseline.deadCode.allowedUnusedFiles);
  const allowedUnreachable = new Set(
    baseline.deadCode.allowedProductionUnreachableFiles,
  );
  const issues = knipIssues.filter(
    (issue) =>
      issue.type !== "files" ||
      (!registry.paths.has(issue.file) && !allowedFiles.has(issue.file)),
  );
  const unexpectedUnreachable = unreachable.filter(
    (file) => !allowedUnreachable.has(file),
  );
  const staleAllowedFiles = [...allowedFiles].filter(
    (file) =>
      !knipIssues.some(
        (issue) => issue.type === "files" && issue.file === file,
      ),
  );
  const staleAllowedUnreachable = [...allowedUnreachable].filter(
    (file) => !unreachable.includes(file),
  );
  return {
    ok:
      issues.length === 0 &&
      unexpectedUnreachable.length === 0 &&
      staleAllowedFiles.length === 0 &&
      staleAllowedUnreachable.length === 0,
    issues,
    productionUnreachableFiles: unreachable,
    unexpectedUnreachable,
    staleAllowedFiles,
    staleAllowedUnreachable,
  };
}

async function main() {
  const result = await auditDeadCode();
  if (!result.ok) {
    console.error("Dead-code audit failed:");
    for (const issue of result.issues)
      console.error(`- ${issue.type}: ${issue.file} (${issue.name})`);
    for (const file of result.unexpectedUnreachable)
      console.error(`- production unreachable: ${file}`);
    for (const file of result.staleAllowedFiles)
      console.error(`- stale unused-file baseline: ${file}`);
    for (const file of result.staleAllowedUnreachable)
      console.error(`- stale production-unreachable baseline: ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Dead-code audit passed: ${String(result.productionUnreachableFiles.length)} reviewed production-unreachable Web files`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

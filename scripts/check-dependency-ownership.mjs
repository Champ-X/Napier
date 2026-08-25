import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectDependencyOwnershipIssues } from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditDependencyOwnership(repoRoot = process.cwd()) {
  const issues = await collectDependencyOwnershipIssues(repoRoot);
  return { ok: issues.length === 0, issues };
}

async function main() {
  const result = await auditDependencyOwnership();
  if (!result.ok) {
    console.error("Dependency ownership audit failed:");
    for (const issue of result.issues)
      console.error(`- ${issue.file} uses undeclared ${issue.dependency}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Dependency ownership audit passed: all bare imports have explicit owners",
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

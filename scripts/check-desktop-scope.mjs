import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectDesktopScope,
  readHygieneBaseline,
} from "./repository-hygiene.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function auditDesktopScope(repoRoot = process.cwd()) {
  const [baseline, observed] = await Promise.all([
    readHygieneBaseline(repoRoot),
    collectDesktopScope(repoRoot),
  ]);
  const errors = [];
  const declared = new Set(
    observed.supportedViewports.map(
      ({ width, height }) => `${width}x${height}`,
    ),
  );
  for (const { width, height } of baseline.desktopScope.supportedViewports) {
    if (!declared.has(`${width}x${height}`)) {
      errors.push(
        `Web UI E2E is missing required desktop viewport ${width}x${height}`,
      );
    }
  }
  return { ok: errors.length === 0, errors, observed };
}

async function main() {
  const result = await auditDesktopScope();
  if (!result.ok) {
    console.error(
      `Desktop-scope audit failed:\n- ${result.errors.join("\n- ")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Desktop-scope audit passed: required desktop viewports retained; additional reflow cases allowed",
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

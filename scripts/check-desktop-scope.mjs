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
  if (
    observed.narrowViewportMediaBlocks >
    baseline.desktopScope.maximumNarrowViewportMediaBlocks
  ) {
    errors.push(
      `narrow viewport media blocks ${String(observed.narrowViewportMediaBlocks)} exceed ${String(baseline.desktopScope.maximumNarrowViewportMediaBlocks)}`,
    );
  }
  if (
    JSON.stringify(observed.supportedViewports) !==
    JSON.stringify(baseline.desktopScope.supportedViewports)
  ) {
    errors.push(
      "Web UI E2E viewports must be exactly 1280x900, 1440x900, and 1920x1080",
    );
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
    `Desktop-scope audit passed: ${String(result.observed.narrowViewportMediaBlocks)} reviewed narrow media blocks; 3 desktop viewports`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) await main();

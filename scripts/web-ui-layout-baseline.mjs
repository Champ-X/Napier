import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { WEB_UI_LAYOUT_BASELINE_VIEWPORTS } from "./web-ui-e2e-contract.mjs";

const DEFAULT_WEB_UI_LAYOUT_BASELINES = Object.freeze({
  "darwin/arm64": "docs/artifacts/web-ui-layout-baseline-0.1.0.json",
  "linux/arm64": "docs/artifacts/web-ui-layout-baseline-linux-0.1.0.json",
  "linux/x64": "docs/artifacts/web-ui-layout-baseline-linux-x64-0.1.0.json",
});

export function defaultWebUiLayoutBaselinePath(
  platform = process.platform,
  arch = process.arch,
) {
  const host = `${platform}/${arch}`;
  const baselinePath = DEFAULT_WEB_UI_LAYOUT_BASELINES[host];
  if (!baselinePath) {
    throw new Error(`Unsupported Web UI layout baseline host: ${host}`);
  }
  return path.resolve(baselinePath);
}

export function webUiLayoutBaseline(
  receipt,
  platform = process.platform,
  arch = process.arch,
) {
  const baselineViewports = receipt.viewports.filter((viewport) =>
    WEB_UI_LAYOUT_BASELINE_VIEWPORTS.some(
      (candidate) =>
        candidate.width === viewport.width &&
        candidate.height === viewport.height &&
        candidate.layout === viewport.layout,
    ),
  );
  return {
    kind: "napier.web-ui-layout-baseline",
    schemaVersion: 3,
    platform,
    arch,
    viewports: baselineViewports.map((viewport) => ({
      width: viewport.width,
      height: viewport.height,
      layout: viewport.layout,
      regions: {
        ...viewport.layoutSnapshot,
        browserInspector: viewport.browserInspector.layoutRect,
      },
    })),
  };
}

export async function verifyWebUiLayoutBaseline(
  receipt,
  baselinePath,
  platform = process.platform,
  arch = process.arch,
) {
  const expected = JSON.parse(await readFile(baselinePath, "utf8"));
  const observed = webUiLayoutBaseline(receipt, platform, arch);
  assert.deepEqual(
    observed,
    expected,
    `Web UI layout baseline drifted: ${baselinePath}`,
  );
  return { path: baselinePath, matched: true };
}

export async function writeWebUiLayoutBaseline(
  receipt,
  baselinePath,
  platform = process.platform,
  arch = process.arch,
) {
  const baseline = webUiLayoutBaseline(receipt, platform, arch);
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { path: baselinePath, matched: true };
}

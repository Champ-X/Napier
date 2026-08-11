import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_WEB_UI_LAYOUT_BASELINES = Object.freeze({
  darwin: "docs/artifacts/web-ui-layout-baseline-0.1.0.json",
  linux: "docs/artifacts/web-ui-layout-baseline-linux-0.1.0.json",
});

export function defaultWebUiLayoutBaselinePath(platform = process.platform) {
  const baselinePath = DEFAULT_WEB_UI_LAYOUT_BASELINES[platform];
  if (!baselinePath) {
    throw new Error(
      `Unsupported Web UI layout baseline platform: ${platform}`,
    );
  }
  return path.resolve(baselinePath);
}

export function webUiLayoutBaseline(receipt, platform = process.platform) {
  return {
    kind: "napier.web-ui-layout-baseline",
    schemaVersion: 2,
    platform,
    viewports: receipt.viewports.map((viewport) => ({
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
) {
  const expected = JSON.parse(await readFile(baselinePath, "utf8"));
  const observed = webUiLayoutBaseline(receipt, platform);
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
) {
  const baseline = webUiLayoutBaseline(receipt, platform);
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { path: baselinePath, matched: true };
}

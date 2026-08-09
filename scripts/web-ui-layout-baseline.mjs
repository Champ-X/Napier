import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_WEB_UI_LAYOUT_BASELINE = path.resolve(
  "docs/artifacts/web-ui-layout-baseline-0.1.0.json",
);

export function webUiLayoutBaseline(receipt) {
  return {
    kind: "napier.web-ui-layout-baseline",
    schemaVersion: 1,
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

export async function verifyWebUiLayoutBaseline(receipt, baselinePath) {
  const expected = JSON.parse(await readFile(baselinePath, "utf8"));
  const observed = webUiLayoutBaseline(receipt);
  assert.deepEqual(
    observed,
    expected,
    `Web UI layout baseline drifted: ${baselinePath}`,
  );
  return { path: baselinePath, matched: true };
}

export async function writeWebUiLayoutBaseline(receipt, baselinePath) {
  const baseline = webUiLayoutBaseline(receipt);
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { path: baselinePath, matched: true };
}

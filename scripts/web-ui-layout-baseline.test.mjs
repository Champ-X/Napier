import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultWebUiLayoutBaselinePath,
  verifyWebUiLayoutBaseline,
  webUiLayoutBaseline,
  writeWebUiLayoutBaseline,
} from "./web-ui-layout-baseline.mjs";

describe("Web UI layout baseline", () => {
  it("writes and verifies only stable viewport geometry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-layout-baseline-"));
    const baselinePath = path.join(root, "baseline.json");
    try {
      const receipt = fixture();
      await writeWebUiLayoutBaseline(receipt, baselinePath, "linux");
      const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
      expect(baseline).toEqual(webUiLayoutBaseline(receipt, "linux"));
      await expect(
        verifyWebUiLayoutBaseline(receipt, baselinePath, "linux"),
      ).resolves.toEqual({ path: baselinePath, matched: true });
      await expect(
        verifyWebUiLayoutBaseline(receipt, baselinePath, "darwin"),
      ).rejects.toThrow("Web UI layout baseline drifted");
      receipt.viewports[0].layoutSnapshot.workbench.width += 1;
      await expect(
        verifyWebUiLayoutBaseline(receipt, baselinePath, "linux"),
      ).rejects.toThrow("Web UI layout baseline drifted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves only accepted host baseline paths", () => {
    expect(defaultWebUiLayoutBaselinePath("darwin")).toMatch(
      /web-ui-layout-baseline-0\.1\.0\.json$/u,
    );
    expect(defaultWebUiLayoutBaselinePath("linux")).toMatch(
      /web-ui-layout-baseline-linux-0\.1\.0\.json$/u,
    );
    expect(() => defaultWebUiLayoutBaselinePath("win32")).toThrow(
      "Unsupported Web UI layout baseline platform: win32",
    );
  });
});

function fixture() {
  return {
    viewports: [
      {
        width: 1_600,
        height: 900,
        layout: "desktop",
        layoutSnapshot: {
          workbench: { x: 252, y: 0, width: 1_010, height: 900 },
        },
        browserInspector: {
          layoutRect: { x: 1_283, y: 186, width: 297, height: 156 },
        },
      },
    ],
  };
}

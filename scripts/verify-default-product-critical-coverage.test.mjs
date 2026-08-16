import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyDefaultProductCriticalCoverageArtifact } from "./verify-default-product-critical-coverage.mjs";

const ARTIFACT = path.resolve(
  "docs/artifacts/default-product-critical-coverage-m4-0.1.2.json",
);

describe("Default Product critical coverage artifact", () => {
  it("verifies Settings and Shell/Sandbox Trials", async () => {
    const artifact =
      await verifyDefaultProductCriticalCoverageArtifact(ARTIFACT);
    expect(
      artifact.trials.map((trial) => ({
        templateCaseId: trial.templateCaseId,
        status: trial.status,
      })),
    ).toEqual([
      { templateCaseId: "settings", status: "passed" },
      { templateCaseId: "shell-sandbox", status: "passed" },
    ]);
  });

  it.each([
    [
      "trial hash drift",
      (artifact) => {
        artifact.trials[1].uxScore = 5;
      },
    ],
    [
      "raw credential injection",
      (artifact) => {
        artifact.credential = "raw credential";
      },
    ],
    [
      "case substitution",
      (artifact) => {
        artifact.trials[1].templateCaseId = "url-pdf";
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-critical-coverage-"),
    );
    const target = path.join(root, "artifact.json");
    try {
      await cp(ARTIFACT, target);
      const artifact = JSON.parse(await readFile(target, "utf8"));
      mutate(artifact);
      await writeFile(target, JSON.stringify(artifact), "utf8");
      await expect(
        verifyDefaultProductCriticalCoverageArtifact(target),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

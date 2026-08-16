import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyDefaultProductCodingRerunArtifact } from "./verify-default-product-coding-rerun.mjs";

const ARTIFACT = path.resolve(
  "docs/artifacts/default-product-coding-rerun-m4-0.1.2.json",
);

describe("Default Product Coding rerun artifact", () => {
  it("verifies the focused default-Web Coding Trial", async () => {
    const artifact = await verifyDefaultProductCodingRerunArtifact(ARTIFACT);
    expect(artifact.trials[0]).toMatchObject({
      templateCaseId: "coding-verification",
      runStatus: "completed",
      status: "passed",
      configurationInterventions: 2,
      humanInterventions: 0,
      recoveryEvents: 0,
      uxScore: 4,
    });
  });

  it.each([
    [
      "trial hash drift",
      (artifact) => {
        artifact.trials[0].uxScore = 5;
      },
    ],
    [
      "raw output injection",
      (artifact) => {
        artifact.output = "raw command output";
      },
    ],
    [
      "case substitution",
      (artifact) => {
        artifact.trials[0].templateCaseId = "shell-sandbox";
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-coding-rerun-"),
    );
    const target = path.join(root, "artifact.json");
    try {
      await cp(ARTIFACT, target);
      const artifact = JSON.parse(await readFile(target, "utf8"));
      mutate(artifact);
      await writeFile(target, JSON.stringify(artifact), "utf8");
      await expect(
        verifyDefaultProductCodingRerunArtifact(target),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

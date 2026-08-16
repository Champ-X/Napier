import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyDefaultProductTrialArtifact } from "./verify-default-product-trial.mjs";

const ARTIFACT = path.resolve(
  "docs/artifacts/default-product-trial-m4-0.1.2.json",
);

describe("Default Product Trial artifact", () => {
  it("verifies the six real default-Web Trials", async () => {
    const artifact = await verifyDefaultProductTrialArtifact(ARTIFACT);
    expect(artifact.versions[0]).toMatchObject({
      coveredCaseCount: 6,
      passedCount: 5,
      inconclusiveCount: 1,
      meanUxScore: 3.5,
      configurationInterventions: 3,
      humanInterventions: 2,
      recoveryEvents: 1,
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
      "raw prompt injection",
      (artifact) => {
        artifact.prompt = "raw prompt";
      },
    ],
    [
      "case substitution",
      (artifact) => {
        artifact.trials[0].templateCaseId = "settings";
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-trial-"),
    );
    const target = path.join(root, "artifact.json");
    try {
      await cp(ARTIFACT, target);
      const artifact = JSON.parse(await readFile(target, "utf8"));
      mutate(artifact);
      await writeFile(target, JSON.stringify(artifact), "utf8");
      await expect(verifyDefaultProductTrialArtifact(target)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

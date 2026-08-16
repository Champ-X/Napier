import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyDefaultProductBreadthArtifact } from "./verify-default-product-breadth.mjs";

const ARTIFACT = path.resolve(
  "docs/artifacts/default-product-breadth-m4-0.1.2.json",
);

describe("Default Product breadth artifact", () => {
  it("verifies URL/PDF and Skill Trials", async () => {
    const artifact = await verifyDefaultProductBreadthArtifact(ARTIFACT);
    expect(
      artifact.trials.map((trial) => ({
        templateCaseId: trial.templateCaseId,
        status: trial.status,
      })),
    ).toEqual([
      { templateCaseId: "url-pdf", status: "passed" },
      { templateCaseId: "skill", status: "passed" },
    ]);
  });

  it.each([
    [
      "trial hash drift",
      (artifact) => {
        artifact.trials[1].humanInterventions = 0;
      },
    ],
    [
      "raw URL injection",
      (artifact) => {
        artifact.url = "https://private.invalid/";
      },
    ],
    [
      "case substitution",
      (artifact) => {
        artifact.trials[1].templateCaseId = "settings";
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-breadth-"),
    );
    const target = path.join(root, "artifact.json");
    try {
      await cp(ARTIFACT, target);
      const artifact = JSON.parse(await readFile(target, "utf8"));
      mutate(artifact);
      await writeFile(target, JSON.stringify(artifact), "utf8");
      await expect(
        verifyDefaultProductBreadthArtifact(target),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyDefaultProductConsolidatedArtifact } from "./verify-default-product-consolidated.mjs";

const ARTIFACT = "docs/artifacts/default-product-consolidated-m4-0.1.2.json";
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Consolidated Default Product Gate", () => {
  it("verifies ten original Trials across four immutable source Gates", async () => {
    const artifact = await verifyDefaultProductConsolidatedArtifact(ARTIFACT);
    expect(artifact).toMatchObject({
      casebookId: "casebook_m4consolidated012",
      defaultTrackReady: false,
      consecutivePassingVersions: ["0.1.2"],
      trials: [],
      adoptions: expect.arrayContaining([
        expect.objectContaining({
          sourceCasebookId: "casebook_2b15a4f817f54cd7a6d2",
        }),
      ]),
    });
  });

  it.each([
    [
      "source Trial hash drift",
      (artifact) => {
        artifact.adoptions[0].sourceGate.trials[0].uxScore = 1;
      },
    ],
    [
      "selected Trial substitution",
      (artifact) => {
        artifact.adoptions[0].sourceTrialIds[0] =
          artifact.adoptions[0].sourceGate.trials[1].id;
      },
    ],
    [
      "source Gate substitution",
      (artifact) => {
        artifact.adoptions[0].sourceGate = artifact.adoptions[1].sourceGate;
      },
    ],
    [
      "destination identity rewriting",
      (artifact) => {
        artifact.casebookId = artifact.adoptions[0].sourceCasebookId;
      },
    ],
    [
      "raw evidence injection",
      (artifact) => {
        artifact.adoptions[0].sourceGate.trials[0].prompt = "hidden";
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-consolidated-"),
    );
    roots.push(root);
    const target = path.join(root, "artifact.json");
    const artifact = JSON.parse(await readFile(ARTIFACT, "utf8"));
    mutate(artifact);
    await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    await expect(
      verifyDefaultProductConsolidatedArtifact(target),
    ).rejects.toThrow();
  });
});

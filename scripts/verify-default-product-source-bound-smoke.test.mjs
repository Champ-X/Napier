import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hashReleaseProductTrial,
  projectReleaseProductGate,
} from "../packages/runtime/dist/release-product-gate.js";
import { NAPIER_RELEASE_IDENTITY_SHA256 } from "../packages/runtime/dist/release-product-identity.js";
import { verifyDefaultProductSourceBoundSmoke } from "./verify-default-product-source-bound-smoke.mjs";

const fixturePath = path.resolve(
  "docs/artifacts/default-product-source-bound-smoke-m4-0.1.3.json",
);

describe("source-bound Default Product smoke verifier", () => {
  it("derives the version time range from the retained trials", async () => {
    const { root, target, gate } = await writeCurrentGate();
    try {
      const verified = await verifyDefaultProductSourceBoundSmoke(target);
      expect(verified.gate.versions[0].firstRecordedAt).toBe(
        gate.trials[0].recordedAt,
      );
      expect(verified.gate.versions[0].lastRecordedAt).toBe(
        gate.trials.at(-1).recordedAt,
      );
      expect(verified.currentSourceBound).toBe(true);
      expect(verified.evidenceStatus).toBe("current_incomplete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains an authentic old source binding as historical incomplete evidence", async () => {
    const verified = await verifyDefaultProductSourceBoundSmoke(fixturePath);

    expect(verified.currentSourceBound).toBe(false);
    expect(verified.evidenceStatus).toBe("historical_incomplete");
    expect(verified.gate.defaultTrackReady).toBe(false);
    expect(verified.gate.versions[0]?.status).toBe("incomplete");
  });

  it("rejects a version whose first timestamp is not the first trial", async () => {
    const { root, target, gate } = await writeCurrentGate();
    try {
      gate.versions[0].firstRecordedAt = gate.trials[1].recordedAt;
      await writeFile(target, `${JSON.stringify(gate)}\n`);
      await expect(
        verifyDefaultProductSourceBoundSmoke(target),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeCurrentGate() {
  const retained = JSON.parse(await readFile(fixturePath, "utf8"));
  const trials = retained.trials.map((trial) => {
    const current = {
      ...trial,
      releaseIdentitySha256: NAPIER_RELEASE_IDENTITY_SHA256,
    };
    return { ...current, contentSha256: hashReleaseProductTrial(current) };
  });
  const gate = projectReleaseProductGate(
    {
      id: retained.casebookId,
      templateId: retained.templateId,
    },
    trials,
    "0.1.3",
  );
  const root = await mkdtemp(path.join(tmpdir(), "napier-source-smoke-"));
  const target = path.join(root, "gate.json");
  await writeFile(target, `${JSON.stringify(gate)}\n`);
  return { root, target, gate };
}

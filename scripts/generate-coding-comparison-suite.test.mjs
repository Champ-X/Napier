import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateCodingComparisonSuite } from "./generate-coding-comparison-suite.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("seeded coding comparison suite generator", () => {
  it("generates reproducible hash-bound low, medium, and high cases", async () => {
    const [first, second] = await Promise.all([
      outputRoot("first"),
      outputRoot("second"),
    ]);
    const [left, right] = await Promise.all([
      generateCodingComparisonSuite({ outputDir: first, seed: 20_260_804 }),
      generateCodingComparisonSuite({ outputDir: second, seed: 20_260_804 }),
    ]);

    expect(left).toEqual(right);
    expect(left.contentSha256).toBe(
      "95171625192756f17d044f77ed927fa5e055321563f23768e93e0ac6bbbbe8f4",
    );
    expect(left.cases.map((entry) => entry.complexity)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(new Set(left.cases.map((entry) => entry.contentSha256)).size).toBe(
      3,
    );
    const manifests = await Promise.all(
      left.cases.map((entry) =>
        readFile(path.join(first, entry.directory, "manifest.json"), "utf8"),
      ),
    );
    expect(
      manifests.every((manifest) => manifest.includes(String(left.seed))),
    ).toBe(true);
  });

  it("adds a test-guided concurrency family only in the extended profile", async () => {
    const output = await outputRoot("extended");
    const suite = await generateCodingComparisonSuite({
      outputDir: output,
      seed: 20_260_806,
      profile: "extended_v1",
    });

    expect(suite.profile).toBe("extended_v1");
    expect(suite.cases.map((entry) => entry.complexity)).toEqual([
      "low",
      "medium",
      "high",
      "high",
    ]);
    expect(suite.cases.map((entry) => entry.taskFamily)).toEqual([
      "boundary_repair",
      "api_migration",
      "runtime_debugging",
      "test_guided_concurrency",
    ]);
    const manifest = JSON.parse(
      await readFile(
        path.join(output, "high-async-concurrency", "manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.requiredTools).toEqual([
      "read_file",
      "run_command",
      "apply_patch",
    ]);
    expect(manifest.requiredCompletedTools).toEqual(["run_command"]);
  });

  it("changes task parameters and hashes when the seed changes", async () => {
    const [first, second] = await Promise.all([
      outputRoot("seed-a"),
      outputRoot("seed-b"),
    ]);
    const left = await generateCodingComparisonSuite({
      outputDir: first,
      seed: 101,
    });
    const right = await generateCodingComparisonSuite({
      outputDir: second,
      seed: 202,
    });

    expect(left.contentSha256).not.toBe(right.contentSha256);
    expect(left.cases.map((entry) => entry.contentSha256)).not.toEqual(
      right.cases.map((entry) => entry.contentSha256),
    );
  });

  it("rejects unknown suite profiles before writing", async () => {
    const output = await outputRoot("invalid-profile");
    await expect(
      generateCodingComparisonSuite({
        outputDir: output,
        seed: 20_260_806,
        profile: "unknown",
      }),
    ).rejects.toThrow("Coding comparison profile is invalid");
  });
});

async function outputRoot(label) {
  const parent = await mkdtemp(
    path.join(tmpdir(), `napier-generated-suite-${label}-`),
  );
  roots.push(parent);
  return path.join(parent, "suite");
}

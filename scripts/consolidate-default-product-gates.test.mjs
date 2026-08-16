import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  consolidateDefaultProductGates,
  DEFAULT_PRODUCT_CONSOLIDATION_SOURCES,
} from "./consolidate-default-product-gates.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Default Product Gate consolidation", () => {
  it("deterministically selects the latest passed Trial for all ten Cases", async () => {
    const expected = JSON.parse(
      await readFile(
        "docs/artifacts/default-product-consolidated-m4-0.1.2.json",
        "utf8",
      ),
    );

    await expect(
      consolidateDefaultProductGates({
        sourcePaths: [...DEFAULT_PRODUCT_CONSOLIDATION_SOURCES],
      }),
    ).resolves.toEqual(expected);
  });

  it("rejects missing or self-rehashed source coverage", async () => {
    await expect(
      consolidateDefaultProductGates({
        sourcePaths: DEFAULT_PRODUCT_CONSOLIDATION_SOURCES.slice(1),
      }),
    ).rejects.toThrow("Every fixed case needs a passed source Trial");

    const root = await mkdtemp(
      path.join(tmpdir(), "napier-default-product-source-"),
    );
    roots.push(root);
    const source = JSON.parse(
      await readFile(DEFAULT_PRODUCT_CONSOLIDATION_SOURCES[1], "utf8"),
    );
    source.trials[0].prompt = "private";
    const target = path.join(root, "source.json");
    await writeFile(target, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    await expect(
      consolidateDefaultProductGates({
        sourcePaths: [
          DEFAULT_PRODUCT_CONSOLIDATION_SOURCES[0],
          target,
          ...DEFAULT_PRODUCT_CONSOLIDATION_SOURCES.slice(2),
        ],
      }),
    ).rejects.toThrow("Source Gate failed hash verification");
  });
});

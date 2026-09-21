import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { inventorySuiteTree, prepareHarnessSuite } from "./harness-suite.mjs";

const base = path.resolve("benchmarks");

test("core v3 keeps thirty tasks and only replaces the queue oracle version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-core-v3-"));
  try {
    const suitePath = path.join(base, "harness-core-quality-suite-v3.json");
    const previous = JSON.parse(
      await readFile(
        path.join(base, "harness-core-quality-suite-v2.json"),
        "utf8",
      ),
    );
    const next = JSON.parse(await readFile(suitePath, "utf8"));
    const expected = structuredClone(previous);
    expected.id = "harness_core_quality_v3";
    expected.cases.find((item) =>
      item.path.endsWith("bounded-async-queue-v1"),
    ).path = "harness-optimization/bounded-async-queue-v3";
    assert.deepEqual(next, expected);
    const receipt = await prepareHarnessSuite(
      suitePath,
      path.join(root, "cases"),
    );
    assert.equal(receipt.cases.length, 30);
    assert.equal(
      receipt.cases.filter((item) =>
        item.coverage.includes("bounded-async-queue"),
      ).length,
      1,
    );
    assert.ok(
      receipt.cases.some((item) => item.id === "bounded_async_queue_v3"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("queue oracle versions preserve inputs and cannot inflate independent task coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-queue-alias-"));
  try {
    const cases = [];
    for (const version of ["v2", "v3"]) {
      const source = path.join(
        base,
        "harness-optimization",
        `bounded-async-queue-${version}`,
      );
      await cp(source, path.join(root, version), { recursive: true });
      cases.push({ path: version, coverage: ["bounded-async-queue"] });
    }
    for (const directory of ["fixture", "expected"]) {
      assert.deepEqual(
        await inventorySuiteTree(path.join(root, "v2", directory)),
        await inventorySuiteTree(path.join(root, "v3", directory)),
      );
    }
    assert.equal(
      await readFile(path.join(root, "v2/prompt.md"), "utf8"),
      await readFile(path.join(root, "v3/prompt.md"), "utf8"),
    );
    const suitePath = path.join(root, "aliases.json");
    await writeFile(
      suitePath,
      JSON.stringify({
        kind: "napier.harness-optimization-suite",
        schemaVersion: 1,
        id: "queue_alias_audit",
        cases,
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(suitePath, path.join(root, "cases")),
      /Duplicate suite task inputs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

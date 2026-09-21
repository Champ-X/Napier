import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { inventorySuiteTree, prepareHarnessSuite } from "./harness-suite.mjs";

const base = path.resolve("benchmarks/harness-optimization");
const cases = [
  {
    name: "rollout-dependency-plan",
    file: "rollout.mjs",
    error: "throw new TypeError('Invalid selection')",
    explicitFile: "graph.mjs",
  },
  {
    name: "access-rule-evaluation",
    file: "access.mjs",
    error: "throw new TypeError('Invalid request')",
    explicitFile: "resource.mjs",
  },
  {
    name: "http-etag-preconditions",
    file: "preconditions.mjs",
    error: "throw new TypeError('Invalid current ETag')",
    explicitFile: "etag.mjs",
  },
];

async function fixture(item, action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-error-oracle-"));
  try {
    await cp(path.join(base, `${item.name}-v2/expected`), root, {
      recursive: true,
    });
    for (const version of ["v1", "v2"])
      await cp(
        path.join(base, `${item.name}-${version}/outcome.mjs`),
        path.join(root, `${version}.mjs`),
      );
    const grade = (version = "v2") =>
      spawnSync(process.execPath, [`${version}.mjs`], {
        cwd: root,
        timeout: 10_000,
        encoding: "utf8",
        env: { PATH: path.dirname(process.execPath) },
      });
    const mutate = async (file, from, to) => {
      const target = path.join(root, "src", file);
      const source = await readFile(target, "utf8");
      assert.ok(source.includes(from), "mutation must match original code");
      await writeFile(target, source.replaceAll(from, to));
    };
    await action({ grade, mutate });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const item of cases) {
  test.each(["TypeError", "RangeError", "Error"])(
    `${item.name} accepts %s for validation with no specified error class`,
    (type) =>
      fixture(item, async ({ grade, mutate }) => {
        await mutate(
          item.file,
          item.error,
          item.error.replace("TypeError", type),
        );
        // Duplicate rule IDs are not path parsing and have no specified class.
        if (item.name === "access-rule-evaluation")
          await mutate(
            item.file,
            "new TypeError('Invalid rule')",
            `new ${type}('Invalid rule')`,
          );
        const result = grade();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(grade("v1").status === 0, type === "TypeError");
      }),
  );

  test(`${item.name} still rejects accepting invalid input`, () =>
    fixture(item, async ({ grade, mutate }) => {
      await mutate(item.file, item.error, "return null");
      assert.notEqual(grade().status, 0);
    }));

  test(`${item.name} still requires explicitly specified TypeError`, () =>
    fixture(item, async ({ grade, mutate }) => {
      await mutate(item.explicitFile, "new TypeError(", "new RangeError(");
      assert.notEqual(grade().status, 0);
    }));

  test(`${item.name} oracle revision preserves task and reference bytes`, async () => {
    for (const directory of ["fixture", "expected"])
      assert.deepEqual(
        await inventorySuiteTree(path.join(base, `${item.name}-v1`, directory)),
        await inventorySuiteTree(path.join(base, `${item.name}-v2`, directory)),
      );
    assert.equal(
      await readFile(path.join(base, `${item.name}-v1/prompt.md`), "utf8"),
      await readFile(path.join(base, `${item.name}-v2/prompt.md`), "utf8"),
    );
    const previous = JSON.parse(
      await readFile(path.join(base, `${item.name}-v1/manifest.json`), "utf8"),
    );
    const next = JSON.parse(
      await readFile(path.join(base, `${item.name}-v2/manifest.json`), "utf8"),
    );
    previous.id = previous.id.replace(/_v1$/u, "_v2");
    assert.deepEqual(next, previous);
  });
}

test("core v6 keeps thirty original tasks and refuses to count grader aliases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-core-v6-"));
  try {
    const previous = JSON.parse(
      await readFile("benchmarks/harness-core-quality-suite-v5.json", "utf8"),
    );
    const file = path.resolve("benchmarks/harness-core-quality-suite-v6.json");
    const next = JSON.parse(await readFile(file, "utf8"));
    previous.id = "harness_core_quality_v6";
    for (const item of cases)
      previous.cases.find((entry) =>
        entry.path.endsWith(`${item.name}-v1`),
      ).path = `harness-optimization/${item.name}-v2`;
    assert.deepEqual(next, previous);
    assert.equal(
      (await prepareHarnessSuite(file, path.join(root, "cases"))).cases.length,
      30,
    );
    for (const version of ["v1", "v2"])
      await cp(
        path.join(base, `rollout-dependency-plan-${version}`),
        path.join(root, version),
        { recursive: true },
      );
    const duplicate = path.join(root, "duplicate.json");
    await writeFile(
      duplicate,
      JSON.stringify({
        ...next,
        cases: ["v1", "v2"].map((version) => ({
          path: version,
          coverage: ["rollout"],
        })),
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(duplicate, path.join(root, "duplicate")),
      /Duplicate suite task inputs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

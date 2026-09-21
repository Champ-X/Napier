import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { inventorySuiteTree, prepareHarnessSuite } from "./harness-suite.mjs";

const base = path.resolve("benchmarks/harness-optimization");
async function fixture(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-retry-oracle-"));
  try {
    await cp(path.join(base, "http-retry-policy-v2/expected"), root, {
      recursive: true,
    });
    for (const version of ["v1", "v2"])
      await cp(
        path.join(base, `http-retry-policy-${version}/outcome.mjs`),
        path.join(root, `${version}.mjs`),
      );
    const grade = (version = "v2") =>
      spawnSync(process.execPath, [`${version}.mjs`], {
        cwd: root,
        timeout: 10000,
        encoding: "utf8",
        env: { PATH: path.dirname(process.execPath) },
      });
    const mutate = async (file, from, to) => {
      const target = path.join(root, "src", file);
      const before = await readFile(target, "utf8");
      assert.ok(before.includes(from), "mutation must target existing code");
      await writeFile(target, before.replace(from, to));
    };
    await action({ root, grade, mutate });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.each(["TypeError", "RangeError", "Error"])(
  "retry v2 accepts %s where the retry-options contract specifies no error class",
  (error) =>
    fixture(async ({ grade, mutate }) => {
      await mutate(
        "retry.mjs",
        "new TypeError('Invalid retry options')",
        `new ${error}('Invalid retry options')`,
      );
      const result = grade();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(grade("v1").status === 0, error === "TypeError");
    }),
);

test.each([
  [
    "wrong explicit clock error type",
    "retry-after.mjs",
    "new TypeError('Invalid clock')",
    "new RangeError('Invalid clock')",
  ],
  [
    "nonretryable status bypassing validation",
    "retry.mjs",
    " if(typeof method",
    " if(status===200)return null;\n if(typeof method",
  ],
  [
    "invalid retry options accepted as null",
    "retry.mjs",
    "throw new TypeError('Invalid retry options')",
    "return null",
  ],
  [
    "retry before server permission",
    "retry.mjs",
    "if(header!==null&&header>maxMs)return null;",
    "if(header!==null&&header>maxMs)return maxMs;",
  ],
  [
    "unsafe infinite backoff multiplied by zero",
    "retry.mjs",
    "Math.min(maxMs,baseMs*2**attempt)*jitter",
    "Math.min(maxMs,baseMs*2**attempt*jitter)",
  ],
])("retry v2 rejects %s", (name, file, from, to) =>
  fixture(async ({ grade, mutate }) => {
    await mutate(file, from, to);
    assert.notEqual(grade().status, 0, name);
  }),
);

test("retry oracle version preserves the task, public checks and reference", async () => {
  for (const directory of ["fixture", "expected"])
    assert.deepEqual(
      await inventorySuiteTree(
        path.join(base, "http-retry-policy-v1", directory),
      ),
      await inventorySuiteTree(
        path.join(base, "http-retry-policy-v2", directory),
      ),
    );
  for (const file of ["prompt.md", "manifest.json"]) {
    const previous = await readFile(
      path.join(base, "http-retry-policy-v1", file),
      "utf8",
    );
    const next = await readFile(
      path.join(base, "http-retry-policy-v2", file),
      "utf8",
    );
    assert.equal(
      next,
      previous.replace("http_retry_policy_v1", "http_retry_policy_v2"),
    );
  }
});

test("core v5 preserves thirty tasks and refuses to count retry versions twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-core-v5-"));
  try {
    const previous = JSON.parse(
      await readFile("benchmarks/harness-core-quality-suite-v4.json", "utf8"),
    );
    const file = path.resolve("benchmarks/harness-core-quality-suite-v5.json");
    const next = JSON.parse(await readFile(file, "utf8"));
    previous.id = "harness_core_quality_v5";
    previous.cases.find((item) =>
      item.path.endsWith("http-retry-policy-v1"),
    ).path = "harness-optimization/http-retry-policy-v2";
    assert.deepEqual(next, previous);
    assert.equal(
      (await prepareHarnessSuite(file, path.join(root, "cases"))).cases.length,
      30,
    );
    for (const version of ["v1", "v2"])
      await cp(
        path.join(base, `http-retry-policy-${version}`),
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
          coverage: ["retry"],
        })),
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(duplicate, path.join(root, "duplicated")),
      /Duplicate suite task inputs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

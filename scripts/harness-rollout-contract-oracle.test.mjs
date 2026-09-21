import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { inventorySuiteTree } from "./harness-suite.mjs";

const base = path.resolve("benchmarks/harness-optimization");
async function fixture(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-rollout-oracle-"));
  try {
    await cp(path.join(base, "rollout-dependency-plan-v3/expected"), root, {
      recursive: true,
    });
    for (const version of ["v2", "v3"])
      await cp(
        path.join(base, `rollout-dependency-plan-${version}/outcome.mjs`),
        path.join(root, `${version}.mjs`),
      );
    const grade = (version) =>
      spawnSync(process.execPath, [`${version}.mjs`], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { PATH: path.dirname(process.execPath) },
      });
    const mutate = async (file, from, to) => {
      const target = path.join(root, "src", file);
      const text = await readFile(target, "utf8");
      assert.ok(text.includes(from));
      await writeFile(target, text.replace(from, to));
    };
    await action({ grade, mutate });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.each(["TypeError", "RangeError", "Error"])(
  "rollout v3 accepts %s for unspecified option-validation error class",
  (type) =>
    fixture(async ({ grade, mutate }) => {
      await mutate(
        "rollout.mjs",
        "new TypeError('Invalid selection')",
        `new ${type}('Invalid selection')`,
      );
      const result = grade("v3");
      assert.equal(result.status, 0, result.stderr);
    }),
);

test.each([
  [
    "locale-based Map key order",
    "graph.mjs",
    "a<b?-1:a>b?1:0",
    "a.localeCompare(b)",
  ],
  [
    "locale-based dependency order",
    "graph.mjs",
    "[...n.dependsOn].sort()",
    "[...n.dependsOn].sort((a,b)=>a.localeCompare(b))",
  ],
  [
    "locale-based wave order",
    "rollout.mjs",
    ".sort().slice(0,maxParallel)",
    ".sort((a,b)=>a.localeCompare(b)).slice(0,maxParallel)",
  ],
  [
    "accepting maxParallel 101",
    "rollout.mjs",
    "maxParallel>100",
    "maxParallel>101",
  ],
])("rollout v3 detects %s missed by v2", (name, file, from, to) =>
  fixture(async ({ grade, mutate }) => {
    await mutate(file, from, to);
    const old = grade("v2");
    assert.equal(old.status, 0, old.stderr);
    assert.notEqual(grade("v3").status, 0, name);
  }),
);

test("rollout v3 strengthens only the external oracle, preserving the task", async () => {
  for (const directory of ["fixture", "expected"])
    assert.deepEqual(
      await inventorySuiteTree(
        path.join(base, "rollout-dependency-plan-v2", directory),
      ),
      await inventorySuiteTree(
        path.join(base, "rollout-dependency-plan-v3", directory),
      ),
    );
  assert.equal(
    await readFile(
      path.join(base, "rollout-dependency-plan-v2/prompt.md"),
      "utf8",
    ),
    await readFile(
      path.join(base, "rollout-dependency-plan-v3/prompt.md"),
      "utf8",
    ),
  );
  const before = JSON.parse(
    await readFile(
      path.join(base, "rollout-dependency-plan-v2/manifest.json"),
      "utf8",
    ),
  );
  const after = JSON.parse(
    await readFile(
      path.join(base, "rollout-dependency-plan-v3/manifest.json"),
      "utf8",
    ),
  );
  before.id = "rollout_dependency_plan_v3";
  assert.deepEqual(after, before);
});

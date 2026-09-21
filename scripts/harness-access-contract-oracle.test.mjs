import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { inventorySuiteTree } from "./harness-suite.mjs";
const base = path.resolve("benchmarks/harness-optimization");
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-access-oracle-"));
  try {
    await cp(`${base}/access-rule-evaluation-v3/expected`, root, {
      recursive: true,
    });
    for (const version of ["v2", "v3"])
      await cp(
        `${base}/access-rule-evaluation-${version}/outcome.mjs`,
        `${root}/${version}.mjs`,
      );
    const grade = (version) =>
      spawnSync(process.execPath, [`${version}.mjs`], {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { PATH: path.dirname(process.execPath) },
      });
    const mutate = async (from, to) => {
      const file = `${root}/src/access.mjs`,
        text = await readFile(file, "utf8");
      assert.ok(text.includes(from));
      await writeFile(file, text.replace(from, to));
    };
    await work({ grade, mutate, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("access reference passes and defective original still fails", () =>
  fixture(async ({ root, grade }) => {
    assert.equal(grade("v3").status, 0);
    await cp(`${base}/access-rule-evaluation-v3/fixture/src`, `${root}/src`, {
      recursive: true,
    });
    assert.equal(grade("v3").status, 1);
  }));
test.each([
  ["locale-based ID order", ".sort()", ".sort((a,b)=>a.localeCompare(b))"],
  ["sparse validation arrays", "Array.from(a).every(p)", "a.every(p)"],
  ["dot identifiers", "&&s!=='.'&&s!=='..'", ""],
  ["empty rule actions", "||!r.actions.length", ""],
])("access v3 catches %s missed by v2", (name, from, to) =>
  fixture(async ({ grade, mutate }) => {
    await mutate(from, to);
    const old = grade("v2");
    assert.equal(old.status, 0, old.stderr);
    assert.equal(grade("v3").status, 1, name);
  }),
);
test("access accepts unspecified error class while retaining path TypeError", () =>
  fixture(async ({ grade, mutate }) => {
    await mutate(
      "new TypeError('Invalid request')",
      "new RangeError('Invalid request')",
    );
    await mutate(
      "new TypeError('Invalid rule')",
      "new RangeError('Invalid rule')",
    );
    const result = grade("v3");
    assert.equal(result.status, 0, result.stderr);
  }));
test("access oracle keeps Agent inputs and fixes only sparse-array validation in reference", async () => {
  assert.deepEqual(
    await inventorySuiteTree(`${base}/access-rule-evaluation-v2/fixture`),
    await inventorySuiteTree(`${base}/access-rule-evaluation-v3/fixture`),
  );
  assert.equal(
    await readFile(`${base}/access-rule-evaluation-v2/prompt.md`, "utf8"),
    await readFile(`${base}/access-rule-evaluation-v3/prompt.md`, "utf8"),
  );
  for (const file of ["access.mjs", "resource.mjs"]) {
    const old = await readFile(
      `${base}/access-rule-evaluation-v2/expected/src/${file}`,
      "utf8",
    );
    assert.equal(
      await readFile(
        `${base}/access-rule-evaluation-v3/expected/src/${file}`,
        "utf8",
      ),
      old.replace("a.every(p)", "Array.from(a).every(p)"),
    );
  }
  const old = JSON.parse(
    await readFile(`${base}/access-rule-evaluation-v2/manifest.json`, "utf8"),
  );
  old.id = "access_rule_evaluation_v3";
  assert.deepEqual(
    JSON.parse(
      await readFile(`${base}/access-rule-evaluation-v3/manifest.json`, "utf8"),
    ),
    old,
  );
});

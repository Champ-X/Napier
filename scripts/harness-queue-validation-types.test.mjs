import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { inventorySuiteTree, prepareHarnessSuite } from "./harness-suite.mjs";

const base = path.resolve("benchmarks/harness-optimization");
async function fixture(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-queue-types-"));
  try {
    await cp(path.join(base, "bounded-async-queue-v4/expected"), root, {
      recursive: true,
    });
    await cp(
      path.join(base, "bounded-async-queue-v4/outcome.mjs"),
      path.join(root, "grade.mjs"),
    );
    const grade = (file = "grade.mjs") =>
      spawnSync(process.execPath, [file], {
        cwd: root,
        timeout: 10000,
        encoding: "utf8",
        env: { PATH: path.dirname(process.execPath) },
      });
    await action(root, grade);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.each(["TypeError", "RangeError", "Error"])(
  "v4 accepts %s for runJobs validation where the contract specifies no error class",
  (name) =>
    fixture(async (root, grade) => {
      const file = path.join(root, "src/queue.mjs");
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace(
          "new TypeError('Invalid queue options')",
          `new ${name}('Invalid queue options')`,
        ),
      );
      const result = grade();
      assert.equal(result.status, 0, result.stderr);
      await cp(
        path.join(base, "bounded-async-queue-v3/outcome.mjs"),
        path.join(root, "v3.mjs"),
      );
      assert.equal(grade("v3.mjs").status === 0, name === "TypeError");
    }),
);

test.each([
  ["sparse array omission", "Array.from(jobs).some", "jobs.some"],
  ["null signal acceptance", "signal!==undefined", "signal!=null"],
  [
    "signal duck typing",
    "!(signal instanceof AbortSignal)",
    "(!signal || typeof signal.aborted!=='boolean')",
  ],
])("v4 still rejects %s", (name, from, to) =>
  fixture(async (root, grade) => {
    const file = path.join(root, "src/queue.mjs"),
      original = await readFile(file, "utf8");
    const mutant = original.replace(from, to);
    assert.notEqual(mutant, original);
    await writeFile(file, mutant);
    assert.notEqual(grade().status, 0, name);
  }),
);

test("v4 still requires Promise validation from runJobs and TypeError from settleJob", () =>
  fixture(async (root, grade) => {
    const queue = path.join(root, "src/queue.mjs"),
      original = await readFile(queue, "utf8");
    await writeFile(
      queue,
      original.replace(
        "export async function runJobs(",
        "async function runValidJobs(",
      ) +
        "\nexport function runJobs(jobs, options={}) { if(options.concurrency===0) throw new RangeError('Invalid'); return runValidJobs(jobs,options); }\n",
    );
    assert.notEqual(grade().status, 0);
    await writeFile(queue, original);
    const helper = path.join(root, "src/job-result.mjs"),
      code = await readFile(helper, "utf8");
    await writeFile(
      helper,
      code.replace(
        "new TypeError('Job must be a function')",
        "new RangeError('Job must be a function')",
      ),
    );
    assert.notEqual(grade().status, 0);
  }));

test("v4 keeps exactly the same task and reference; only unspecified validation error matching changes", async () => {
  for (const directory of ["fixture", "expected"])
    assert.deepEqual(
      await inventorySuiteTree(
        path.join(base, "bounded-async-queue-v3", directory),
      ),
      await inventorySuiteTree(
        path.join(base, "bounded-async-queue-v4", directory),
      ),
    );
  assert.equal(
    await readFile(path.join(base, "bounded-async-queue-v3/prompt.md"), "utf8"),
    await readFile(path.join(base, "bounded-async-queue-v4/prompt.md"), "utf8"),
  );
  const old = await readFile(
    path.join(base, "bounded-async-queue-v3/outcome.mjs"),
    "utf8",
  );
  const expected = old
    .split("\n")
    .map((line) =>
      line.includes("assert.rejects(runJobs(")
        ? line.replaceAll(",TypeError)", ")")
        : line,
    )
    .join("\n");
  assert.equal(
    await readFile(
      path.join(base, "bounded-async-queue-v4/outcome.mjs"),
      "utf8",
    ),
    expected,
  );
});

test("core v4 preserves all thirty tasks and cannot count its queue version as a separate task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-core-v4-"));
  try {
    const old = JSON.parse(
      await readFile(
        path.resolve("benchmarks/harness-core-quality-suite-v3.json"),
        "utf8",
      ),
    );
    const file = path.resolve("benchmarks/harness-core-quality-suite-v4.json"),
      next = JSON.parse(await readFile(file, "utf8"));
    old.id = "harness_core_quality_v4";
    old.cases.find((item) =>
      item.path.endsWith("bounded-async-queue-v3"),
    ).path = "harness-optimization/bounded-async-queue-v4";
    assert.deepEqual(next, old);
    assert.equal(
      (await prepareHarnessSuite(file, path.join(root, "cases"))).cases.length,
      30,
    );
    for (const version of ["v3", "v4"])
      await cp(
        path.join(base, `bounded-async-queue-${version}`),
        path.join(root, version),
        { recursive: true },
      );
    await writeFile(
      path.join(root, "duplicates.json"),
      JSON.stringify({
        ...next,
        cases: ["v3", "v4"].map((version) => ({
          path: version,
          coverage: ["queue"],
        })),
      }),
    );
    await assert.rejects(
      prepareHarnessSuite(
        path.join(root, "duplicates.json"),
        path.join(root, "duplicates"),
      ),
      /Duplicate suite task inputs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

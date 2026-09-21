import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

const base = path.resolve("benchmarks/harness-optimization");
async function workspace(action, version = "v2") {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-queue-grade-"));
  try {
    await cp(path.join(base, `bounded-async-queue-${version}/fixture`), root, {
      recursive: true,
    });
    await cp(
      path.join(base, `bounded-async-queue-${version}/outcome.mjs`),
      path.join(root, "grade.mjs"),
    );
    const grade = (file = "grade.mjs") =>
      spawnSync(process.execPath, [file], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { PATH: path.dirname(process.execPath) },
      });
    await action(root, grade);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("stronger queue grader rejects defective input and accepts the same contract reference", () =>
  workspace(async (root, grade) => {
    assert.notEqual(grade().status, 0);
    await cp(path.join(base, "bounded-async-queue-v2/expected"), root, {
      recursive: true,
    });
    const result = grade();
    assert.equal(result.status, 0, result.stderr);
  }));

test("v3 rejects defective input and accepts the unchanged reference", () =>
  workspace(async (root, grade) => {
    assert.notEqual(grade().status, 0);
    await cp(path.join(base, "bounded-async-queue-v3/expected"), root, {
      recursive: true,
    });
    const result = grade();
    assert.equal(result.status, 0, result.stderr);
  }, "v3"));

test("v3 accepts both contract-permitted helper validation modes while v2 rejects a synchronous TypeError", () =>
  workspace(async (root, grade) => {
    await cp(path.join(base, "bounded-async-queue-v3/expected"), root, {
      recursive: true,
    });
    const file = path.join(root, "src/job-result.mjs");
    const original = await readFile(file, "utf8");
    const renamed = original.replace(
      "function settleJob(",
      "function settleValidJob(",
    );
    assert.notEqual(renamed, original);
    await writeFile(
      file,
      renamed +
        "\nexport function settleJob(job) { if (typeof job !== 'function') throw new TypeError('Invalid job'); return settleValidJob(job); }\n",
    );
    const corrected = grade();
    assert.equal(corrected.status, 0, corrected.stderr);
    await cp(
      path.join(base, "bounded-async-queue-v2/outcome.mjs"),
      path.join(root, "legacy.mjs"),
    );
    const legacy = grade("legacy.mjs");
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /TypeError: Invalid job/);
  }, "v3"));

test.each([
  "return {status:'rejected',reason:new TypeError('Invalid job')}",
  "throw new Error('Invalid job')",
  "return undefined",
])("v3 still rejects invalid helper behavior: %s", (invalid) =>
  workspace(async (root, grade) => {
    await cp(path.join(base, "bounded-async-queue-v3/expected"), root, {
      recursive: true,
    });
    const file = path.join(root, "src/job-result.mjs");
    const original = await readFile(file, "utf8");
    const mutant = original.replace(
      "throw new TypeError('Job must be a function')",
      invalid,
    );
    assert.notEqual(mutant, original);
    await writeFile(file, mutant);
    assert.notEqual(grade().status, 0);
  }, "v3"),
);

test.each([
  [
    "synchronous queue validation",
    "export async function runJobs(",
    "async function runValidJobs(",
  ],
  ["sparse-array omission", "Array.from(jobs).some", "jobs.some"],
  [
    "signal duck typing",
    "!(signal instanceof AbortSignal)",
    "(!(signal instanceof AbortSignal) && !(signal && typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function'))",
  ],
])("v3 preserves rejection of %s", (name, from, to) =>
  workspace(async (root, grade) => {
    await cp(path.join(base, "bounded-async-queue-v3/expected"), root, {
      recursive: true,
    });
    const file = path.join(root, "src/queue.mjs");
    const original = await readFile(file, "utf8");
    let mutant = original.replace(from, to);
    assert.notEqual(mutant, original);
    if (name === "synchronous queue validation") {
      mutant +=
        "\nexport function runJobs(jobs, options = {}) { if (options.concurrency === 0) throw new TypeError('Invalid concurrency'); return runValidJobs(jobs, options); }\n";
    }
    await writeFile(file, mutant);
    assert.notEqual(grade().status, 0);
  }, "v3"),
);

test("signal duck typing passes the retained old grader but fails the new boundary checks", () =>
  workspace(async (root, grade) => {
    await cp(path.join(base, "bounded-async-queue-v2/expected"), root, {
      recursive: true,
    });
    const file = path.join(root, "src/queue.mjs");
    const original = await readFile(file, "utf8");
    const mutant = original.replace(
      "!(signal instanceof AbortSignal)",
      "(!(signal instanceof AbortSignal) && !(signal && typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function'))",
    );
    assert.notEqual(mutant, original);
    await writeFile(file, mutant);
    await cp(
      path.join(base, "bounded-async-queue-v1/outcome.mjs"),
      path.join(root, "legacy.mjs"),
    );
    const legacy = grade("legacy.mjs");
    assert.equal(legacy.status, 0, legacy.stderr);
    const improved = grade();
    assert.notEqual(improved.status, 0);
    assert.match(improved.stderr, /Missing expected rejection/);
  }));

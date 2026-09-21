import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { inventorySuiteTree } from "./harness-suite.mjs";

const base = path.resolve("benchmarks/harness-optimization");
async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-booking-oracle-"));
  try {
    await cp(`${base}/booking-calendar-v2/expected`, root, { recursive: true });
    for (const version of ["v1", "v2"])
      await cp(
        `${base}/booking-calendar-${version}/outcome.mjs`,
        `${root}/${version}.mjs`,
      );
    const grade = (version = "v2") =>
      spawnSync(process.execPath, [`${version}.mjs`], {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
        env: {
          PATH: path.dirname(process.execPath),
          PYTHONDONTWRITEBYTECODE: "1",
        },
      });
    const mutate = async (file, before, after) => {
      const target = `${root}/src/${file}.py`,
        text = await readFile(target, "utf8");
      assert.ok(text.includes(before));
      await writeFile(target, text.replaceAll(before, after));
    };
    await work({ root, grade, mutate });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("booking oracle preserves all original task and reference bytes", async () => {
  for (const dir of ["fixture", "expected"])
    assert.deepEqual(
      await inventorySuiteTree(`${base}/booking-calendar-v1/${dir}`),
      await inventorySuiteTree(`${base}/booking-calendar-v2/${dir}`),
    );
  assert.equal(
    await readFile(`${base}/booking-calendar-v1/prompt.md`, "utf8"),
    await readFile(`${base}/booking-calendar-v2/prompt.md`, "utf8"),
  );
  const old = JSON.parse(
    await readFile(`${base}/booking-calendar-v1/manifest.json`, "utf8"),
  );
  old.id = "booking_calendar_v2";
  assert.deepEqual(
    JSON.parse(
      await readFile(`${base}/booking-calendar-v2/manifest.json`, "utf8"),
    ),
    old,
  );
});
test("booking reference passes and original defective fixture still fails", async () =>
  fixture(async ({ root, grade }) => {
    assert.equal(grade().status, 0);
    await cp(`${base}/booking-calendar-v2/fixture/src`, `${root}/src`, {
      recursive: true,
    });
    assert.equal(grade().status, 1);
  }));
test.each(["TypeError", "RuntimeError"])(
  "unspecified rejection classes accept %s without changing behavior checks",
  async (type) =>
    fixture(async ({ grade, mutate }) => {
      await mutate(
        "intervals",
        "ValueError('Invalid booking')",
        `${type}('Invalid booking')`,
      );
      await mutate(
        "intervals",
        "ValueError('Invalid interval')",
        `${type}('Invalid interval')`,
      );
      await mutate(
        "scheduling",
        "ValueError('Invalid search')",
        `${type}('Invalid search')`,
      );
      const result = grade();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(grade("v1").status, 1);
    }),
);
test.each([
  [
    "intervals",
    "ValueError('Timezone required')",
    "RuntimeError('Timezone required')",
  ],
  [
    "scheduling",
    "ValueError('Duplicate booking ID')",
    "TypeError('Duplicate booking ID')",
  ],
  [
    "scheduling",
    "raise ValueError('Invalid search')",
    "return '2026-09-01T00:00:00Z'",
  ],
])(
  "explicit error classes and invalid-input rejection remain required: %s %s",
  async (file, before, after) =>
    fixture(async ({ grade, mutate }) => {
      await mutate(file, before, after);
      assert.equal(grade().status, 1);
    }),
);

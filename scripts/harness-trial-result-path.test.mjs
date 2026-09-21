import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "vitest";
import { trialResultPath, trialJobStem } from "./harness-trial-result-path.mjs";

test("reads the actual offset trial and never a first-trial decoy", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "napier-trial-path-"));
  try {
    for (const trial of [0, 3]) {
      const file = trialResultPath({ output, trial });
      await mkdir(path.dirname(file));
      await writeFile(file, JSON.stringify({ trial, taskSuccess: trial === 0 }));
    }
    const report = JSON.parse(await readFile(trialResultPath({ output, trial: 3 })));
    assert.equal(report.trial, 3);
    assert.equal(report.taskSuccess, false);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
test("invalid offsets cannot create ambiguous report paths", () => {
  for (const trial of [-1, 0.5, "3", NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => trialResultPath({ output: "/tmp/run", trial }));
});

test("all three paired trials can persist separate immutable command and log receipts", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "napier-trial-logs-"));
  try {
    const names = new Set();
    for (const arm of ["baseline", "candidate"])
      for (const trial of [0, 1, 2]) {
        const job = { caseId: "example_v1", arm, trial };
        const stem = trialJobStem(job); names.add(stem);
        await writeFile(path.join(output, `${stem}.log`), JSON.stringify(job), { flag: "wx" });
        assert.deepEqual(JSON.parse(await readFile(path.join(output, `${stem}.log`))), job);
      }
    assert.equal(names.size, 6);
    for (const caseId of ["../task", "task/a", ""]) assert.throws(() => trialJobStem({ caseId, arm: "candidate", trial: 0 }));
    assert.throws(() => trialJobStem({ caseId: "task", arm: "unknown", trial: 0 }));
  } finally { await rm(output, { recursive: true, force: true }); }
});

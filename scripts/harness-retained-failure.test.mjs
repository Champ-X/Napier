import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";
import { inventorySuiteTree, prepareHarnessSuite } from "./harness-suite.mjs";
import { validateObservedWorkspaceReceipt } from "./harness-observed-workspace.mjs";

const retained = path.resolve(
  "benchmarks/harness-failures/bounded-queue-false-completion-v1",
);
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("retained real-model false completion remains an attributable failing regression", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "napier-retained-failure-"),
  );
  try {
    const evidence = JSON.parse(
      await readFile(path.join(retained, "reproduction.json"), "utf8"),
    );
    assert.equal(evidence.originalRunId, "run_cef83d950d1c416096e2");
    assert.equal(evidence.failure, "task_failure");
    const original = await inventorySuiteTree(path.join(retained, "fixture"));
    assert.deepEqual(original, evidence.files);
    assert.equal(sha(JSON.stringify(original)), evidence.fixtureSha256);
    const observed = validateObservedWorkspaceReceipt(
      evidence.observedWorkspace.receipt,
      evidence.originalRunId,
    );
    assert.deepEqual(
      await inventorySuiteTree(path.join(retained, "observed")),
      observed.files,
    );
    assert.notDeepEqual(observed.files, original);
    const grader = await readFile(path.join(retained, "outcome.mjs"));
    assert.equal(sha(grader), evidence.outcomeSha256);
    assert.equal(
      sha(await readFile(path.join(retained, "prompt.md"))),
      evidence.promptSha256,
    );

    for (const arm of ["observed", "reference"]) {
      const workspace = path.join(root, arm);
      await cp(
        path.join(retained, arm === "observed" ? "observed" : "fixture"),
        workspace,
        { recursive: true },
      );
      if (arm === "reference")
        await cp(
          path.resolve(
            "benchmarks/harness-optimization/bounded-async-queue-v4/expected/src",
          ),
          path.join(workspace, "src"),
          { recursive: true },
        );
      await writeFile(path.join(workspace, "__grader__.mjs"), grader);
      const result = spawnSync(process.execPath, ["__grader__.mjs"], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, arm === "observed" ? 1 : 0, result.stderr);
      if (arm === "observed")
        assert.match(result.stderr, /Missing expected rejection/);
      else
        assert.match(
          result.stdout,
          /AbortSignal-shaped plain objects rejected/,
        );
    }
    const suite = await prepareHarnessSuite(
      path.resolve("benchmarks/harness-failure-regression-suite-v1.json"),
      path.join(root, "inputs"),
    );
    assert.equal(suite.cases[0].id, evidence.originalCaseId);
    assert.equal(suite.cases[0].taskFamily, "async-queue");
    assert.equal(suite.cases[0].partition, "regression");
    assert.deepEqual(
      await inventorySuiteTree(path.join(suite.cases[0].path, "fixture")),
      original,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

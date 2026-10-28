import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-workflow-approval-recovery.json",
);
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-workflow-approval-evidence-"),
);
const files = [
  "packages/runtime/src/embedded-workflow-approvals.ts",
  "packages/runtime/src/workflow-execution-lock.ts",
  "packages/runtime/src/workflow-runtime.ts",
  "packages/runtime/src/workflow-context-factory.ts",
  "packages/runtime/src/workflow-approval-node.ts",
  "packages/runtime/src/workflow-approval-runtime.ts",
  "packages/runtime/src/workflow-approval-model.ts",
  "packages/runtime/src/workflow-ledger.ts",
  "packages/runtime/src/workflow-recovery.ts",
  "packages/runtime/src/workflow-result.ts",
  "packages/runtime/src/thread-interaction-repository.ts",
  "packages/runtime/src/operator-decision-payloads.ts",
  "packages/runtime/src/operator-decisions.ts",
  "packages/runtime/src/store.ts",
  "packages/runtime/src/sqlite-ledger.ts",
  "packages/runtime/src/sqlite-ledger-model.ts",
  "packages/runtime/src/sqlite-ledger-schema.ts",
  "packages/runtime/src/run-interruption-recovery.ts",
  "packages/runtime/src/run-lost-owner-recovery.ts",
  "packages/runtime/test/fixtures/workflow-approval-baseline.ts",
  "packages/runtime/test/fixtures/workflow-approval-recovery-setup.ts",
  "packages/runtime/test/fixtures/workflow-approval-recovery-crash.ts",
  "packages/runtime/test/workflow-approval-recovery.test.ts",
  "packages/runtime/test/embedded-workflow-approval-retry.test.ts",
  "packages/runtime/test/sqlite-ledger-migration.test.ts",
  "scripts/check-workflow-approval-recovery.mjs",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = () =>
  Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(path.join(root, file))),
    })),
  );
try {
  const sourceDigests = await sources();
  const results = path.join(temporary, "tests.json");
  const observationsPath = path.join(temporary, "observations.json");
  let testError;
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/workflow-approval-recovery.test.ts",
      "test/embedded-workflow-approval-retry.test.ts",
      "test/sqlite-ledger-migration.test.ts",
      "--maxWorkers=2",
      "--reporter=json",
      `--outputFile=${results}`,
    ],
    {
      cwd: path.join(root, "packages/runtime"),
      timeout: 120000,
      env: {
        ...process.env,
        NAPIER_WORKFLOW_APPROVAL_OBSERVATIONS: observationsPath,
      },
    },
  ).catch((error) => {
    testError = error;
  });
  const tests = JSON.parse(await readFile(results, "utf8"));
  if (testError) {
    for (const file of tests.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        if (test.status === "failed")
          console.error(test.fullName, test.failureMessages);
      }
    }
    throw testError;
  }
  const observations = JSON.parse(await readFile(observationsPath, "utf8"));
  assert.equal(tests.success, true);
  assert.equal(tests.numPassedTests, 29);
  assert.equal(observations.length, 17);
  assert.deepEqual(
    await sources(),
    sourceDigests,
    "Relevant sources changed during verification",
  );
  const sourceHead = (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: "napier.workflow-approval-recovery-evidence",
        schemaVersion: 1,
        evidenceClass: "deterministic_process_fault_injection",
        capturedAt: new Date().toISOString(),
        sourceHead,
        sourceState:
          "worktree with preserved unrelated user changes; relevant sources bound below",
        externalModelRequests: 0,
        modelProvider: "empty registry; approval and apply_patch only",
        faultMechanism:
          "process.exit(73) at real SQLite and Workflow checkpoints; synchronized independent retries; SIGSTOP/SIGKILL of a live owner",
        baselineCommit: "610a8ef54426fb3408d43d1e33f1ce6f419cd7ca",
        baselineScope:
          "fixed pre-change embedded approval service against the same actual saved answer with current Store/Workflow dependencies; not a full historical release",
        observations,
        tests: { passed: tests.numPassedTests, failed: tests.numFailedTests },
        sourceDigests,
        limitations: [
          "Local PID ownership only: no cross-host fencing, TTL takeover of a live owner, or power-loss claim. PID reuse can conservatively block until that process exits.",
          "SQLite schema migrates from version 7 to 8; older runtimes cannot open the upgraded ledger.",
          "Approval retries preserve the original answer and reuse the continuation; they do not authorize replay of arbitrary downstream write tools.",
          "The matrix covers approval/continuation and successful final-response loss. Interrupted downstream tools retain their existing recovery policy.",
          "Measured restart/resume timings are individual local samples, not comparative latency or model-quality evidence.",
          "No recovery UI acceptance, before-effect automatic continuation, live-model quality improvement or full G04/G01-G07 acceptance is claimed.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Verified 29 checks, including 17 process/baseline observations: ${output}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-patch-recovery-evidence-"),
);
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-settled-patch-recovery.json",
);
const files = [
  "packages/runtime/src/agent-run-recovery.ts",
  "packages/runtime/src/run-lost-owner-recovery.ts",
  "packages/runtime/src/run-interruption-recovery.ts",
  "packages/runtime/src/sqlite-effect-indeterminate-commit.ts",
  "packages/runtime/src/workspace-patch-commit.ts",
  "packages/runtime/src/workspace-patch-preparation.ts",
  "packages/runtime/src/workspace-patch-interruption-reconciliation.ts",
  "packages/runtime/src/workspace-patch-reconciled-evidence.ts",
  "packages/runtime/src/stateless-agent-tools.ts",
  "packages/runtime/src/tools.ts",
  "packages/contracts/src/run-event-tool-definitions-v1.ts",
  "packages/runtime/src/automatic-recovery.ts",
  "packages/runtime/src/run-tool-effect-observations.ts",
  "packages/runtime/src/run-patch-recovery-evidence.ts",
  "packages/runtime/src/workspace-patch-tool.ts",
  "packages/runtime/src/workspace-patch-model.ts",
  "packages/runtime/src/workspace-patch-result.ts",
  "packages/runtime/src/workspace-patch-recovery-capsule.ts",
  "packages/runtime/src/workspace-patch-result-capsule.ts",
  "packages/runtime/src/workspace-patch-result-recovery.ts",
  "packages/runtime/src/workspace-patch-reconciliation.ts",
  "packages/runtime/src/tool-effect-indeterminate-event.ts",
  "packages/runtime/test/settled-patch-recovery.test.ts",
  "packages/runtime/test/fixtures/patch-recovery-crash.ts",
  "packages/runtime/test/fixtures/patch-recovery-baseline.ts",
  "scripts/check-settled-patch-recovery.mjs",
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
  const observationsPath = path.join(temporary, "observations.json");
  const resultsPath = path.join(temporary, "tests.json");
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/settled-patch-recovery.test.ts",
      "--maxWorkers=1",
      "--reporter=json",
      `--outputFile=${resultsPath}`,
    ],
    {
      cwd: path.join(root, "packages/runtime"),
      timeout: 120000,
      env: {
        ...process.env,
        NAPIER_PATCH_RECOVERY_OBSERVATIONS: observationsPath,
      },
    },
  );
  const tests = JSON.parse(await readFile(resultsPath, "utf8"));
  const measurements = JSON.parse(await readFile(observationsPath, "utf8"));
  assert.equal(tests.success, true);
  assert.equal(tests.numPassedTests, 10);
  assert.equal(measurements.observations.length, 10);
  assert.deepEqual(
    await sources(),
    sourceDigests,
    "Sources changed during verification",
  );
  const head = (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
  const receipt = {
    kind: "napier.settled-patch-recovery-evidence",
    schemaVersion: 1,
    evidenceClass: "deterministic_process_fault_injection",
    capturedAt: new Date().toISOString(),
    sourceHead: head,
    sourceState:
      "dirty worktree including preserved user changes; relevant sources bound below",
    externalModelRequests: 0,
    modelProvider: "faux-patch-recovery",
    faultMechanism:
      "process.exit(73) at awaited Runtime checkpoints, without graceful shutdown",
    ...measurements,
    tests: { passed: tests.numPassedTests, failed: tests.numFailedTests },
    sourceDigests,
    limitations: [
      "Settled apply_patch may retain its terminal receipt or an exact effect-bound private result; postconditions are checked before continuation.",
      "Before-effect remains stopped. Effect-before-settlement can retain a write only with a bound intent, dead writer and matching file identity/postcondition; full G04 recovery is not accepted.",
      "Continuation retains the existing safe_read_only policy; no new write authority.",
      "Single deterministic observations are timing baselines, not live-model recovery-rate claims.",
      "No saved-answer/approval continuation or UI acceptance in this receipt.",
    ],
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(`Verified 10 process fault scenarios; evidence: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

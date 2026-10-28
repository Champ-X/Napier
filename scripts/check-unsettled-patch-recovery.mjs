import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-unsettled-patch-recovery.json",
);
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-unsettled-evidence-"),
);
const files = [
  "packages/contracts/src/run-event-tool-definitions-v1.ts",
  "packages/runtime/src/agent-run-recovery.ts",
  "packages/runtime/src/automatic-recovery.ts",
  "packages/runtime/src/run-interruption-recovery.ts",
  "packages/runtime/src/run-lost-owner-recovery.ts",
  "packages/runtime/src/run-tool-effect-observations.ts",
  "packages/runtime/src/run-patch-recovery-evidence.ts",
  "packages/runtime/src/sqlite-effect-indeterminate-commit.ts",
  "packages/runtime/src/sqlite-tool-effect-authority.ts",
  "packages/runtime/src/stateless-agent-tools.ts",
  "packages/runtime/src/tools.ts",
  "packages/runtime/src/workspace-patch-commit.ts",
  "packages/runtime/src/workspace-patch-model.ts",
  "packages/runtime/src/workspace-patch-tool.ts",
  "packages/runtime/src/workspace-patch-preparation.ts",
  "packages/runtime/src/workspace-patch-reconciled-evidence.ts",
  "packages/runtime/src/workspace-patch-interruption-reconciliation.ts",
  "packages/runtime/src/workspace-patch-reconciliation.ts",
  "packages/runtime/src/workspace-patch-recovery-capsule.ts",
  "packages/runtime/src/workspace-patch-result-capsule.ts",
  "packages/runtime/src/workspace-patch-result-recovery.ts",
  "packages/runtime/src/workspace-write-lock.ts",
  "packages/runtime/src/local-private-capsule-store.ts",
  "packages/runtime/src/tool-effect-indeterminate-event.ts",
  "packages/runtime/test/settled-patch-recovery.test.ts",
  "packages/runtime/test/unsettled-patch-recovery.test.ts",
  "packages/runtime/test/fixtures/patch-recovery-crash.ts",
  "packages/runtime/test/fixtures/patch-recovery-baseline.ts",
  "scripts/check-unsettled-patch-recovery.mjs",
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
  const settled = path.join(temporary, "settled.json");
  const unsettled = path.join(temporary, "unsettled.json");
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/settled-patch-recovery.test.ts",
      "test/unsettled-patch-recovery.test.ts",
      "--maxWorkers=2",
      "--reporter=json",
      `--outputFile=${results}`,
    ],
    {
      cwd: path.join(root, "packages/runtime"),
      timeout: 120000,
      env: {
        ...process.env,
        NAPIER_PATCH_RECOVERY_OBSERVATIONS: settled,
        NAPIER_UNSETTLED_PATCH_OBSERVATIONS: unsettled,
      },
    },
  );
  const tests = JSON.parse(await readFile(results, "utf8"));
  const prior = JSON.parse(await readFile(settled, "utf8"));
  const additional = JSON.parse(await readFile(unsettled, "utf8"));
  assert.equal(tests.success, true);
  assert.equal(tests.numPassedTests, 26);
  assert.equal(prior.observations.length, 10);
  assert.equal(additional.length, 16);
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
        kind: "napier.unsettled-patch-recovery-evidence",
        schemaVersion: 1,
        evidenceClass: "deterministic_process_fault_injection",
        capturedAt: new Date().toISOString(),
        sourceHead,
        sourceState:
          "worktree with preserved unrelated user changes; relevant sources bound below",
        modelProvider: "faux-patch-recovery",
        externalModelRequests: 0,
        faultMechanism:
          "process.exit(73) at awaited Runtime checkpoints and immediately after atomic link/rename; SIGKILL for the live-writer case; SQLite trigger rollback and explicit evidence/environment mutations",
        baselineCommit: prior.baselineCommit,
        baselineScope:
          "fixed historical automatic-recovery evaluator against current real event streams, not a whole historical runtime release",
        observations: [...prior.observations, ...additional],
        tests: { passed: tests.numPassedTests, failed: tests.numFailedTests },
        sourceDigests,
        limitations: [
          "Automatic continuation remains safe_read_only; original writes and tool result events are never replayed or fabricated.",
          "Write-ahead intent alone does not prove execution. Before-effect and before-target-commit interruptions remain stopped.",
          "Unsettled recovery requires the original writer process to have exited and checks both current file identity and content under the path lock.",
          "Old records without a prepared intent, unavailable evidence, workspace drift or live writers stay stopped.",
          "Process-fault evidence does not establish power-loss durability, cross-host fencing or live-model quality improvements.",
          "Post-write diagnostics may be missing; file postconditions do not accept the overall objective.",
          "No Workflow approval fault matrix or recovery UI acceptance is included.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Verified 26 process-fault scenarios: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

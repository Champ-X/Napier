import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-verified-patch-recovery.json",
);
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-verified-patch-evidence-"),
);
const files = [
  "packages/contracts/src/execution-core.ts",
  "packages/runtime/src/store.ts",
  "packages/runtime/src/process-run-readiness.ts",
  "packages/runtime/src/agent-runtime.ts",
  "packages/runtime/src/agent-runtime-options.ts",
  "packages/runtime/src/agent-capability-runtime.ts",
  "packages/runtime/src/agent-budget-policy.ts",
  "packages/runtime/src/internal-research-recovery-authorization.ts",
  "packages/runtime/src/run-execution-tool-surface.ts",
  "packages/runtime/src/run-config.ts",
  "packages/runtime/src/workspace-patch-input.ts",
  "packages/runtime/src/workspace-patch-invocation.ts",
  "packages/runtime/src/workspace-patch-not-committed.ts",
  "packages/runtime/src/workspace-patch-pending-inspection.ts",
  "packages/runtime/src/workspace-patch-recovery-plan.ts",
  "packages/runtime/src/workspace-patch-recovery-execution.ts",
  "packages/runtime/src/workspace-patch-uncommitted-evidence.ts",
  "packages/runtime/src/local-process-owner.ts",
  "packages/runtime/src/sqlite-tool-concurrency-leases.ts",
  "packages/runtime/src/tool-invocation-capture.ts",
  "packages/runtime/src/tool-execution-admission-service.ts",
  "packages/runtime/src/durable-tool-execution.ts",
  "packages/runtime/test/verified-patch-recovery.test.ts",
  "packages/runtime/test/uncommitted-patch-evidence.test.ts",
  "packages/runtime/test/fixtures/verified-patch-recovery-resume.ts",
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
  "scripts/check-verified-patch-recovery.mjs",
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
  const observationsFile = path.join(temporary, "observations.json");
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/verified-patch-recovery.test.ts",
      "test/uncommitted-patch-evidence.test.ts",
      "--maxWorkers=2",
      "--reporter=json",
      `--outputFile=${results}`,
    ],
    {
      cwd: path.join(root, "packages/runtime"),
      timeout: 180000,
      env: {
        ...process.env,
        NAPIER_VERIFIED_PATCH_OBSERVATIONS: observationsFile,
      },
    },
  );
  const tests = JSON.parse(await readFile(results, "utf8"));
  const observations = JSON.parse(await readFile(observationsFile, "utf8"));
  assert.equal(tests.success, true);
  assert.equal(tests.numPassedTests, 31);
  assert.ok(observations.length >= 20);
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
        kind: "napier.verified-patch-recovery-evidence",
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
        baselineCommit: "1671a7159f0d6d079c499d7c09df3db02bd27469",
        baselineScope:
          "The prior implementation stops unexecuted writes. verified_patches is a new explicit opt-in policy; safe_read_only still stops them. This is capability acceptance, not a same-policy live-model quality comparison.",
        observations,
        cases: tests.testResults.flatMap((file) =>
          file.assertionResults.map((test) => ({
            name: test.fullName,
            status: test.status,
            durationMs: test.duration,
          })),
        ),
        tests: { passed: tests.numPassedTests, failed: tests.numFailedTests },
        sourceDigests,
        limitations: [
          "Supports exact captured Agent apply_patch calls. Model continuation remains read-only; generic writes and Workflow pending writes are not granted recovery authority.",
          "A missing commit marker proves only that a v2 target commit was not entered. Already-created parent directories may remain; this does not claim every possible side effect was absent.",
          "A present commit marker with no verifiable postcondition remains indeterminate, even when the target is absent or unchanged.",
          "Recovery retains the frozen Agent revision and rechecks current write permissions. Tool-definition/compiler identity drift, missing private inputs, or changed file preconditions stop execution.",
          "Process death and restart fixtures use the same tsx loader. These results do not establish power-loss durability, cross-host fencing, or live-model quality improvement.",
          "Model-visible result summaries are bounded; omitted result bodies are marked. File state and completed Runs do not accept the overall objective.",
          "No unified recovery UI usability acceptance or all-G04/all-goal completion is claimed.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Verified 31 process-fault cases: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

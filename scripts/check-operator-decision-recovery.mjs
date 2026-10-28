import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const repository = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-decision-evidence-"),
);
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-operator-decision-recovery.json",
);
const files = [
  "packages/runtime/src/agent-run-recovery.ts",
  "packages/runtime/src/agent-operator-decision-continuation.ts",
  "packages/runtime/src/operator-decision-continuation.ts",
  "packages/runtime/src/operator-decision-recovery-context.ts",
  "packages/runtime/src/operator-decision-payloads.ts",
  "packages/runtime/src/thread-interaction-repository.ts",
  "packages/runtime/src/store.ts",
  "packages/runtime/src/store-run-query-guards.ts",
  "packages/runtime/src/store-event-service.ts",
  "packages/runtime/src/store-persistence.ts",
  "packages/runtime/src/workflow-tool-runtime.ts",
  "packages/runtime/src/workflow-tool-execution-evidence.ts",
  "packages/runtime/test/operator-decision-recovery.test.ts",
  "packages/runtime/test/fixtures/operator-decision-crash.ts",
  "packages/runtime/test/fixtures/operator-decision-baseline.ts",
  "packages/runtime/test/workflow-patch-output.test.ts",
  "apps/server/test/operator-decision-retry-http.test.ts",
  "apps/server/src/thread-execution-http.ts",
  "scripts/check-operator-decision-recovery.mjs",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = () =>
  Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: hash(await readFile(path.join(repository, file))),
    })),
  );
const run = promisify(execFile);
async function tests(workspace, paths, env = {}) {
  const resultPath = path.join(temporary, `${path.basename(workspace)}.json`);
  await run(
    process.execPath,
    [
      path.join(repository, "node_modules/vitest/vitest.mjs"),
      "run",
      ...paths,
      "--maxWorkers=1",
      "--reporter=json",
      `--outputFile=${resultPath}`,
    ],
    {
      cwd: path.join(repository, workspace),
      timeout: 120000,
      env: { ...process.env, ...env },
    },
  );
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.success, true);
  return { passed: result.numPassedTests, failed: result.numFailedTests };
}
try {
  const sourceDigests = await sources();
  const observationsPath = path.join(temporary, "observations.json");
  const runtime = await tests(
    "packages/runtime",
    [
      "test/operator-decision-recovery.test.ts",
      "test/workflow-patch-output.test.ts",
    ],
    { NAPIER_DECISION_RECOVERY_OBSERVATIONS: observationsPath },
  );
  const http = await tests("apps/server", [
    "test/operator-decision-retry-http.test.ts",
  ]);
  assert.equal(runtime.passed, 9);
  assert.equal(http.passed, 1);
  const measurements = JSON.parse(await readFile(observationsPath, "utf8"));
  assert.equal(measurements.observations.length, 5);
  assert.deepEqual(
    await sources(),
    sourceDigests,
    "Relevant source changed during verification",
  );
  const sourceHead = (
    await run("git", ["rev-parse", "HEAD"], { cwd: repository })
  ).stdout.trim();
  const receipt = {
    kind: "napier.operator-decision-recovery-evidence",
    schemaVersion: 1,
    evidenceClass: "deterministic_process_fault_injection_and_http_integration",
    capturedAt: new Date().toISOString(),
    sourceHead,
    sourceState:
      "dirty worktree with preserved user changes; relevant sources bound below",
    baselineCommit: "9ba6ed3d52f463a597c0750c7eeace762526c21b",
    baselineScope:
      "Pinned Store and ThreadInteractionRepository executed with current unchanged supporting dependencies; no full-release baseline claim.",
    faultMechanism:
      "process.exit(73) before/after the actual SQLite binding transaction; no graceful shutdown",
    externalModelRequests: 0,
    modelProvider: "explicit faux providers",
    tests: { runtime, http },
    ...measurements,
    sourceDigests,
    limitations: [
      "A committed continuation interrupted before its prompt returns interrupted on retry; explicit Run recovery retains the saved answer and continues. No new recovery authorization.",
      "Concurrent clients use independent stores/runtimes and HTTP requests; this is not a multiprocess race benchmark.",
      "Workflow approval's existing regression suite passed separately; no approval-specific process fault matrix is claimed.",
      "Single local timings are observations, not production latency or model-quality improvement claims.",
      "No browser answer-and-continue UX acceptance or whole-G04 acceptance in this receipt.",
    ],
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(`Verified 9 Runtime and 1 HTTP tests; evidence: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

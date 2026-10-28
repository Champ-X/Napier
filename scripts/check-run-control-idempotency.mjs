import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const repository = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  process.argv[2] ?? "/tmp/napier-control-idempotency.json",
);
const temporary = await mkdtemp(
  path.join(tmpdir(), "napier-control-evidence-"),
);
const run = promisify(execFile);
const files = [
  "packages/contracts/src/agent-thread-control-v1.ts",
  "packages/runtime/src/run-control-message-queue.ts",
  "packages/runtime/src/run-control-messages.ts",
  "packages/runtime/src/run-control-repository.ts",
  "packages/runtime/src/run-progress-control-epoch-codec.ts",
  "packages/runtime/test/run-control-idempotency.test.ts",
  "packages/runtime/test/fixtures/run-control-message-crash.ts",
  "apps/server/src/thread-control-http.ts",
  "apps/server/src/thread-control-http-validation.ts",
  "apps/server/src/thread-control-http-response.ts",
  "apps/server/test/run-control-idempotency-http.test.ts",
  "scripts/generate-management-openapi.mjs",
  "docs/artifacts/management-openapi-0.1.0.json",
  "scripts/check-run-control-idempotency.mjs",
];
const digests = () =>
  Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: createHash("sha256")
        .update(await readFile(path.join(repository, file)))
        .digest("hex"),
    })),
  );
async function test(label, workspace, paths, expected, pattern) {
  const reportPath = path.join(temporary, `${label}.json`);
  await run(
    process.execPath,
    [
      path.join(repository, "node_modules/vitest/vitest.mjs"),
      "run",
      ...paths,
      ...(pattern ? ["-t", pattern] : []),
      "--maxWorkers=1",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    { cwd: path.join(repository, workspace), timeout: 120000 },
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.success, true);
  assert.equal(report.numPassedTests, expected);
  return {
    label,
    workspace,
    paths,
    ...(pattern ? { pattern } : {}),
    passed: report.numPassedTests,
    skipped: report.numPendingTests,
    failed: report.numFailedTests,
  };
}
try {
  const sourceDigests = await digests();
  const tests = await Promise.all([
    test(
      "store-projection-fault",
      "packages/runtime",
      [
        "test/run-control-idempotency.test.ts",
        "test/run-control-messages.test.ts",
        "test/store.test.ts",
        "test/run-lifecycle-atomic-settlement.test.ts",
        "test/task-branch-control-history.test.ts",
        "test/run-progress-payload-adversarial.test.ts",
        "test/run-progress-payload-codec.test.ts",
      ],
      58,
    ),
    test(
      "runtime-delivery",
      "packages/runtime",
      ["test/agent-runtime.test.ts"],
      3,
      "injects a durable steering|delivers durable follow-up|cancels follow-up work",
    ),
    test(
      "http",
      "apps/server",
      ["test/run-control-idempotency-http.test.ts", "test/app.test.ts"],
      40,
    ),
  ]);
  assert.deepEqual(
    await digests(),
    sourceDigests,
    "Relevant source changed during verification",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: "napier.run-control-idempotency-evidence",
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        sourceHead: (
          await run("git", ["rev-parse", "HEAD"], { cwd: repository })
        ).stdout.trim(),
        sourceState: "dirty worktree; relevant source digests bound below",
        evidenceClass:
          "deterministic_runtime_process_fault_and_http_routing_integration",
        externalModelRequests: 0,
        tests,
        assertions: [
          "Five concurrent same-identity requests append one queued event and one delivered user instruction.",
          "Delivered, cancelled and terminal-settled messages retain their authoritative identity across reopen; retry adds no event.",
          "process.exit(73) after persistence, before response, then initialize(true): retry returns the original interrupted-run cancellation rather than requeueing.",
          "Same identity with changed text or mode rejects; identities are scoped to Thread and Run; new-message limits remain enforced.",
          "The model receives one keyed follow-up after duplicate submission: three faux model calls including memory extraction, two conversation turns.",
          "Queued request and strict progress projections validate the optional identity and its hash; invalid rehashed identity rejects.",
          "HTTP app.request response discarded after persistence: retry returns existing receipt, conflict is 409, invalid identity is 400.",
        ],
        sourceDigests,
        limitations: [
          "HTTP integration uses Hono app.request, not a socket or browser; new Web outbox wiring is still pending.",
          "No live-model quality or user success-rate claim; tests use deterministic faux providers.",
          "Client identity is optional for compatibility. Requests omitting it retain existing non-idempotent semantics.",
          "Delivered records control-message consumption at the existing Runtime boundary; it does not prove the instruction was fulfilled.",
          "No new resume, replay or cross-Run authorization; an interrupted/cancelled receipt is not silently requeued.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Verified ${tests.reduce((sum, result) => sum + result.passed, 0)} tests; evidence: ${output}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "napier-workspace-recovery-evidence-"));
const output = path.resolve(process.argv[2] ?? "/tmp/napier-workspace-runtime-recovery.json");
const sourceFiles = [
  "apps/server/test/workspace-runtime-recovery-process.test.ts",
  "apps/server/test/workspace-runtime-recovery-process-fixture.ts",
  "apps/server/test/process-run-readiness-test-fixture.ts",
  "scripts/check-workspace-runtime-recovery.mjs",
  "package-lock.json",
  "node_modules/@earendil-works/pi-ai/package.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/faux.js",
];
const trees = [
  ["apps/server/src", ".ts"],
  ["packages/contracts/src", ".ts"],
  ["packages/runtime/src", ".ts"],
  ["packages/contracts/dist", ".js"],
  ["packages/runtime/dist", ".js"],
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digestFiles = (files) => Promise.all(files.map(async (file) => ({
  path: file, sha256: hash(await readFile(path.join(root, file))),
})));

async function treeDigest(directory, suffix) {
  const files = (await readdir(path.join(root, directory), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
  assert.ok(files.length > 0, `Missing source/build files in ${directory}`);
  const entries = [];
  for (let offset = 0; offset < files.length; offset += 32) {
    entries.push(...await digestFiles(files.slice(offset, offset + 32)));
  }
  return { directory, suffix, fileCount: entries.length, sha256: hash(JSON.stringify(entries)) };
}

async function bindings() {
  return {
    files: await digestFiles(sourceFiles),
    trees: await Promise.all(trees.map(([directory, suffix]) => treeDigest(directory, suffix))),
  };
}

try {
  const sourceBindings = await bindings();
  const observationsPath = path.join(temporary, "observations.json");
  const resultsPath = path.join(temporary, "tests.json");
  await promisify(execFile)(process.execPath, [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run", "test/workspace-runtime-recovery-process.test.ts", "--maxWorkers=1",
    "--reporter=json", `--outputFile=${resultsPath}`,
  ], {
    cwd: path.join(root, "apps/server"), timeout: 60_000,
    env: { ...process.env, NAPIER_WORKSPACE_RECOVERY_OBSERVATIONS: observationsPath },
  });
  const tests = JSON.parse(await readFile(resultsPath, "utf8"));
  const measurements = JSON.parse(await readFile(observationsPath, "utf8"));
  assert.equal(tests.success, true);
  assert.equal(tests.numPassedTests, 1);
  assert.equal(measurements.observations.length, 3);
  assert.equal(measurements.fault.signal, "SIGKILL");
  assert.equal(new Set(measurements.processes.map((entry) => entry.pid)).size, 3);
  assert.deepEqual(measurements.observations.map((entry) => entry.attempts.length), [1, 1, 0]);
  assert.deepEqual(measurements.observations.map((entry) => entry.runs.length), [2, 2, 1]);
  assert.deepEqual(await bindings(), sourceBindings, "Source or consumed Runtime builds changed during verification");
  const head = (await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const receipt = {
    kind: "napier.workspace-runtime-recovery-evidence", schemaVersion: 1,
    evidenceClass: "deterministic_process_fault_injection",
    capturedAt: new Date().toISOString(), sourceHead: head,
    sourceState: "dirty worktree including retained user changes; source and consumed build trees bound independently below",
    modelProvider: "faux-workspace-recovery", externalModelRequests: 0,
    command: "node scripts/check-workspace-runtime-recovery.mjs <new-output-path>",
    faultMechanism: "SIGKILL after all three workspace Runs persist run.started; no graceful shutdown",
    ...measurements,
    tests: { passed: tests.numPassedTests, failed: tests.numFailedTests },
    sourceBindings,
    bindingFormat: "Each tree sha256 hashes UTF-8 JSON.stringify of sorted {path,sha256} entries for its suffix; paths are repository-relative with forward slashes.",
    limitations: [
      "Actual production workspace host and actual recovery workers run in independent child processes; the fixture installs a local faux provider before starting workers.",
      "This does not launch production index.ts for active recovery. Completed-ledger production-index reopening is covered by the separate workspace-runtime-integration receipt.",
      "The sandbox fixture executes readiness probes only; this is not OS-sandbox enforcement evidence.",
      "The fault is before model dispatch or tool execution. No arbitrary external side effects, uncertain writes, Workflow recovery, approval UI, or global budget coordination are accepted here.",
      "A/B use safe_read_only policy and recover exactly once; C's explicit manual policy remains stopped. These are fixture scenarios, not live-model quality or recovery-rate evidence.",
      "Timing is one observed local run, not a statistical latency result. Source and consumed build snapshots do not by themselves establish a clean release build.",
    ],
  };
  await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, workspaces: 3, independentProcesses: 3, testsPassed: tests.numPassedTests, externalModelRequests: 0 }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

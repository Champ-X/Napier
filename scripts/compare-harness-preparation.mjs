import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { createComparisonFixture, digest } from "./harness-preparation-comparison-fixture.mjs";
import { materializePreparationReference, REFERENCE_COMMIT, verifyPreparationReference } from "./harness-preparation-comparison-reference.mjs";
import { comparePreparationSemantics } from "./harness-preparation-comparison-semantics.mjs";

const root = path.resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
const { values, positionals } = parseArgs({
  options: {
    smoke: { type: "boolean", default: false },
    "keep-workdirs": { type: "boolean", default: false },
  },
  allowPositionals: true,
});
assert.equal(positionals.length, 1, "Usage: node scripts/compare-harness-preparation.mjs [--smoke] [--keep-workdirs] <new-receipt.json>");
const { smoke } = values;
const output = path.resolve(positionals[0]);
await access(output).then(() => { throw new Error("Refusing to overwrite evidence"); }, (error) => { if (error.code !== "ENOENT") throw error; });
const before = await bindings();
await mkdir(path.join(root, "benchmark-results"), { recursive: true });
const raw = await mkdtemp(path.join(root, "benchmark-results", "harness-preparation-comparison-"));
const workerCopies = path.join(raw, "worker-copies");
const referenceDirectory = path.join(raw, "reference", "runtime");
const runtime = path.join(root, "packages/runtime/dist");
const workers = [], comparisons = [], overhead = [];
let reference, fixture, semantics, after, failure;
const started = new Date().toISOString();
try {
  reference = await materializePreparationReference(root, referenceDirectory);
  await verifyPreparationReference(referenceDirectory, reference);
  fixture = await createComparisonFixture(path.join(raw, "fixture"), smoke);
  console.log(JSON.stringify({ stage: "fixture_ready", raw, leaseExpiresAt: fixture.fixtureLeaseExpiresAt, setupWallMs: fixture.setupWallMs }));
  for (const instrumented of [true, false]) {
    for (const order of ["AB", "BA"]) {
      for (const arm of order === "AB" ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
        await verifyFixture(fixture);
        const id = `${instrumented ? "probe-on" : "probe-off"}-${order}-${arm}`;
        const workerOutput = path.join(raw, `${id}.json`);
        const options = { fixture: path.join(raw, "fixture", "fixture-manifest.json"), reference: referenceDirectory, runtime, arm, order, instrumented,
          work: path.join(workerCopies, id), output: workerOutput };
        const processResult = await worker(options, id);
        let content;
        try { content = await readFile(workerOutput); } catch (error) {
          workers.push({ id, output: workerOutput, process: processResult, success: false, resultMissing: true }); throw error;
        }
        const result = JSON.parse(content);
        workers.push({ id, output: workerOutput, outputSha256: digest(content), process: processResult, ...result });
        console.log(JSON.stringify({ stage: "worker_finished", id, success: result.success, exitCode: processResult.exitCode, samples: result.samples.length }));
        assert.equal(processResult.exitCode, 0, `${id} subprocess failed: ${result.error?.message}`);
        assert.equal(result.success, true, `${id} failed`);
      }
      const baseline = workers.find((item) => item.arm === "baseline" && item.order === order && item.instrumented === instrumented);
      const candidate = workers.find((item) => item.arm === "candidate" && item.order === order && item.instrumented === instrumented);
      assert.deepEqual(candidate.deltas, baseline.deltas, "Arms did not observe identical appended events");
      assert.equal(candidate.samples.length, baseline.samples.length);
      for (let index = 0; index < baseline.samples.length; index++) {
        const a = baseline.samples[index], b = candidate.samples[index];
        assert.equal(key(a), key(b));
        assert.deepEqual(b.output, a.output, `${key(a)} output changed`);
        if (a.phase === "invocation_context") assert.deepEqual(b.receiptSemantic, a.receiptSemantic, `${key(a)} receipt semantics changed`);
        comparisons.push({ key: key(a), instrumented, order, exactOutputEqual: true, exactReceiptSemanticEqual: a.phase === "invocation_context" ? true : null,
          baselineWallMs: a.wallMs, candidateWallMs: b.wallMs, candidateOverBaselineWallRatio: b.wallMs / a.wallMs,
          baselineWorkerRows: a.metrics?.worker.eventReturnedRows ?? null, candidateWorkerRows: b.metrics?.worker.eventReturnedRows ?? null,
          baselineFileReads: a.metrics?.fileReadCalls ?? null, candidateFileReads: b.metrics?.fileReadCalls ?? null });
      }
    }
  }
  for (const arm of ["baseline", "candidate"]) for (const order of ["AB", "BA"]) {
    const on = workers.find((item) => item.arm === arm && item.order === order && item.instrumented);
    const off = workers.find((item) => item.arm === arm && item.order === order && !item.instrumented);
    for (let index = 0; index < on.samples.length; index++) {
      const observed = on.samples[index], unobserved = off.samples[index];
      assert.equal(key(observed), key(unobserved)); assert.deepEqual(observed.output, unobserved.output);
      if (observed.phase === "invocation_context") assert.deepEqual(observed.receiptSemantic, unobserved.receiptSemantic);
      overhead.push({ arm, order, key: key(observed), probeOnWallMs: observed.wallMs, probeOffWallMs: unobserved.wallMs, probeOnOverOffWallRatio: observed.wallMs / unobserved.wallMs });
    }
  }
  semantics = await comparePreparationSemantics({ reference: referenceDirectory, runtime, directory: path.join(raw, "semantics") });
  await writeFile(path.join(raw, "semantic-cases.json"), JSON.stringify(semantics, null, 2) + "\n", { flag: "wx" });
  await verifyFixture(fixture); await verifyPreparationReference(referenceDirectory, reference);
} catch (error) { failure = error; }
finally {
  after = await bindings();
  try { assert.deepEqual(after, before, "Source/build/scripts/lock changed during capture"); } catch (error) { failure ??= error; }
}
const result = { kind: "napier.harness-preparation-comparison", schemaVersion: 1, startedAt: started, capturedAt: new Date().toISOString(),
  success: !failure, smoke, rawEvidenceDirectory: raw, referenceCommit: REFERENCE_COMMIT,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  modelInvocations: 0, externalModelRequests: 0, workerPlan: "Fresh subprocesses: AB then BA with original probe on, then AB then BA with probe off",
  semanticExclusions: ["receipt.payload.index", "receipt.payload.dependencyValidation"],
  bindingsBefore: before, bindingsAfter: after, bindingsUnchanged: JSON.stringify(before) === JSON.stringify(after), reference, fixture,
  workers, comparisons, probeOverheadObservations: overhead, semanticCases: semantics,
  limits: [
    "Paired synthetic mechanism comparison, not model/provider quality, end-to-end Run latency, statistical significance, or complete G07 acceptance.",
    "Cold means a fresh loop cursor or empty application memory index; operating-system filesystem/page caches are not flushed.",
    "Fixture creation, batch bootstrap, copies, reopen validation, and delta writes/visibility checks are excluded from measured phases; no write-performance claim.",
    "Both arms share one fixed manifest and workspace files, with private ledger copies and FTS index roots. Reference Runtime algorithms come from unchanged pinned Git source; Contracts and external packages are shared and separately bound.",
    "SQL counts are returned rows, not SQLite internal rows scanned. Worker JSON decoding CPU is sampled every 32 calls per query, with counter/timer overhead.",
    "RSS is sampled at boundaries and 20ms intervals. Process high-water RSS includes setup and earlier phases; small allocation and synchronous peaks may be missed.",
    "Probe-on and probe-off are separate fresh processes. Ratios are observations, not observer overhead subtraction or causal estimates independent of order and cache effects.",
    "Synthetic reviewed facts enter production preparation via structuredClone; repository fact-loading cost is excluded. Invocation timing includes working-state and memory preparation only.",
    "During-index mutation deliberately differs from the old unsafe reference: the candidate must discard all facts using the changed shared dependency and resynchronize the actual index.",
  ],
  ...(failure ? { error: { message: String(failure), stack: failure.stack } } : {}),
};
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
if (!failure && !values["keep-workdirs"]) {
  await rm(workerCopies, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, success: !failure, workers: workers.length, comparisons: comparisons.length, error: failure ? String(failure) : null }));
if (failure) process.exitCode = 1;

function key(sample) { return [sample.phase, sample.eventCount, sample.stage ?? "", sample.workload ?? "", sample.iteration ?? ""].join(":"); }
async function worker(options, id) {
  const stdout = path.join(raw, `${id}.stdout.log`), stderr = path.join(raw, `${id}.stderr.log`);
  const out = await open(stdout, "wx"), err = await open(stderr, "wx");
  try {
    const child = spawn(process.execPath, [path.join(root, "scripts/harness-preparation-comparison-worker.mjs"), JSON.stringify(options)], { cwd: root, stdio: ["ignore", out.fd, err.fd] });
    return await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (exitCode, signal) => resolve({ pid: child.pid, exitCode, signal, stdout, stderr })); });
  } finally { await out.close(); await err.close(); }
}
async function verifyFixture(value) {
  assert.ok(Date.parse(value.fixtureLeaseExpiresAt) > Date.now() + 30_000, "Fixture lease expired or near expiry");
  for (const seed of value.seeds) assert.equal(digest(await readFile(seed.database)), seed.databaseSha256);
  for (const workload of value.workloads) assert.equal(digest(JSON.stringify(JSON.parse(await readFile(workload.factsFile, "utf8")))), workload.factsSha256);
  for (const file of value.contents) assert.equal(digest(await readFile(path.join(value.workspaceRoot, file.path))), file.sha256);
}
async function bindings() {
  const trees = [];
  for (const directory of ["packages/runtime/src", "packages/runtime/dist", "packages/contracts/src", "packages/contracts/dist", "node_modules/typebox"]) {
    const entries = (await readdir(path.join(root, directory), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(root, path.join(entry.parentPath, entry.name))).sort();
    const files = await Promise.all(entries.map(async (filename) => ({ path: filename, sha256: digest(await readFile(path.join(root, filename))) })));
    trees.push({ directory, sha256: digest(JSON.stringify(files)), files });
  }
  const files = await Promise.all([
    "package-lock.json", "package.json", "packages/runtime/package.json", "packages/contracts/package.json", "node_modules/typescript/package.json", "node_modules/typescript/lib/typescript.js",
    "scripts/compare-harness-preparation.mjs", "scripts/harness-preparation-comparison-reference.mjs", "scripts/harness-preparation-comparison-fixture.mjs", "scripts/harness-preparation-comparison-worker.mjs", "scripts/harness-preparation-comparison-semantics.mjs",
    "scripts/harness-preparation-probe.mjs", "scripts/profile-harness-preparation.mjs",
  ].map(async (filename) => ({ path: filename, sha256: digest(await readFile(path.join(root, filename))) })));
  const { stdout: head } = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
  return { head: head.trim(), trees, files };
}

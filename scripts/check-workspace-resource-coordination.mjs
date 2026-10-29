import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
const options = parseArguments(process.argv.slice(2));
const groups = [
  { name: "runtime", directory: "packages/runtime", tests: [
    "test/model-call-admission.test.ts", "test/model-stream-cancellation.test.ts",
    "test/model-adapter-capture.test.ts", "test/model-adapters.test.ts",
    "test/model-route-integration.test.ts", "test/run-context-compaction-runtime.test.ts",
    "test/workspace-processes.test.ts", ...options.runtimeTests,
  ] },
  { name: "server", directory: "apps/server", tests: [
    "test/workspace-model-admission.test.ts", "test/workspace-model-host.test.ts",
    "test/workspace-runtime-process-lifetime.test.ts", "test/browser-task.test.ts",
    "test/workspace-runtime-host.test.ts", "test/workspace-runtime-registry.test.ts",
    "test/workspace-runtime-http.test.ts", "test/workspace-runtime-owner-process.test.ts",
    "test/workspace-runtime-live-http.test.ts", "test/workspace-runtime-recovery-process.test.ts",
    ...options.serverTests,
  ] },
].map((group) => ({ ...group, tests: [...new Set(group.tests)].sort() }));
const sourceFiles = [...new Set([
  ...groups.flatMap((group) => group.tests.map((file) => `${group.directory}/${file}`)),
  "packages/runtime/test/process-run-readiness-test-fixture.ts",
  "packages/runtime/test/run-progress-vector-test-support.ts",
  "packages/runtime/test/run-context-compaction-test-support.ts",
  "packages/runtime/test/active-run-test-fixture.ts",
  "apps/server/test/workspace-runtime-test-fixture.ts",
  "apps/server/test/workspace-runtime-owner-process-fixture.ts",
  "apps/server/test/workspace-runtime-recovery-process-fixture.ts",
  "apps/server/test/workspace-model-admission-fixture.ts",
  "apps/server/test/workspace-model-admission-owner-fixture.ts",
  "apps/server/test/process-run-readiness-test-fixture.ts",
  "scripts/check-workspace-resource-coordination.mjs",
  "scripts/check-workspace-runtime-ui.mjs", "scripts/web-ui-e2e-runtime.mjs",
  "scripts/production-server-test-environment.mjs", "package-lock.json",
  "node_modules/@earendil-works/pi-ai/package.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/faux.js",
])].sort();
const trees = [
  { directory: "apps/server/src", suffixes: [".ts"] },
  { directory: "packages/contracts/src", suffixes: [".ts"] },
  { directory: "packages/runtime/src", suffixes: [".ts"] },
  { directory: "apps/web/src", suffixes: null },
  { directory: "packages/contracts/dist", suffixes: [".js"] },
  { directory: "packages/runtime/dist", suffixes: [".js"] },
  { directory: "apps/server/dist", suffixes: [".js"] },
  { directory: "apps/web/dist", suffixes: null },
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

await assertNewOutput(options.output);
await Promise.all(sourceFiles.map((file) => access(path.join(root, file))));
const temporary = await mkdtemp(path.join(tmpdir(), "napier-workspace-resource-evidence-"));
let completed = false;
let afterBindingsPersisted = false;
try {
  const sourceHead = (await executeCaptured("git-head", "git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const before = await captureBindings("before");
  const recoveryObservations = path.join(temporary, "recovery-observations.json");
  const results = await Promise.allSettled(groups.map((group) => runTests(group, recoveryObservations)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Resource coordination regression failed");
  const testResults = results.map((result) => result.value);
  const recovery = JSON.parse(await readFile(recoveryObservations, "utf8"));
  assert.equal(recovery.fault.signal, "SIGKILL");
  assert.equal(recovery.observations.length, 3);
  assert.deepEqual(recovery.observations.map((entry) => entry.attempts.length), [1, 1, 0]);
  const browser = options.browser ? await runBrowser() : null;
  assert.deepEqual(await captureBindings("after"), before, "Source or consumed build trees changed during verification");
  const receipt = {
    kind: "napier.workspace-resource-coordination-evidence", schemaVersion: 1,
    evidenceClass: "deterministic_runtime_http_process_integration",
    capturedAt: new Date().toISOString(), sourceHead,
    sourceState: "dirty worktree including retained user changes; source and consumed build trees independently bound",
    command: ["node", "scripts/check-workspace-resource-coordination.mjs", ...process.argv.slice(2)],
    externalModelRequests: 0,
    scope: {
      modelAccountingUnit: "ModelRegistry provider invocation; not provider HTTP attempts or provider invoices",
      budgets: "durable invocation quotas, token allowances and nominal USD estimates at a frozen model tariff",
      lifetime: "workspace retention and draining for unsettled model invocations and process/browser lifecycle obligations",
      globalPhysicalProcessCoordination: "pending",
      globalPhysicalBrowserCoordination: "pending",
      browserVerification: options.browser ? "existing A/B navigation, assets and completed-history production restart scenario" : "not run",
    },
    tests: {
      files: testResults.reduce((sum, result) => sum + result.files.length, 0),
      passed: testResults.reduce((sum, result) => sum + result.counts.passed, 0),
      failed: testResults.reduce((sum, result) => sum + result.counts.failed, 0),
      groups: testResults,
    },
    recovery,
    browser,
    sourceBindings: before,
    bindingFormat: "Tree sha256 hashes UTF-8 JSON.stringify of sorted {path,sha256} entries matching suffixes (null means all regular files); paths are repository-relative with forward slashes.",
    limitations: [
      "Deterministic faux providers, fake backends and local process/SQLite/HTTP fixtures are used; no live-model quality or external billing claim.",
      "Invocation quotas and nominal estimates do not count provider-internal HTTP retries or guarantee an external invoice ceiling. Missing or uncertain usage must not be interpreted as zero.",
      "Physical process and browser global coordination remains pending. Lifetime retention/draining checks do not establish host-wide CPU, RSS, process or browser concurrency limits.",
      "Process recovery uses the production host with an injected faux provider and a readiness-only sandbox, after SIGKILL before model dispatch. It does not verify arbitrary side effects or production-index active execution recovery.",
      "When present, browser evidence is embedded unchanged from its existing navigation verifier. Its boundaries describe that scenario, not the admission tests in this receipt; it does not test quota UX or approval/review isolation.",
      "Recorded timings are local observations, not a statistical performance result. Stable source/build snapshots do not establish a clean release build or complete G05-B/G01-G07 acceptance.",
    ],
  };
  await writeFile(options.output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  completed = true;
  console.log(JSON.stringify({ output: options.output, files: receipt.tests.files, testsPassed: receipt.tests.passed, browser: options.browser, externalModelRequests: 0 }));
} finally {
  if (completed) await rm(temporary, { recursive: true, force: true });
  else {
    if (!afterBindingsPersisted) {
      try { await captureBindings("after"); }
      catch (error) {
        await writeFile(path.join(temporary, "bindings-after-error.json"), JSON.stringify(errorDetails(error), null, 2) + "\n")
          .catch((writeError) => console.error("Could not persist final binding diagnostics", writeError));
      }
    }
    console.error(`Evidence capture did not complete; raw test JSON, command logs and binding snapshots retained in ${temporary}`);
  }
}

async function runTests(group, recoveryObservations) {
  const resultFile = path.join(temporary, `${group.name}-tests.json`);
  const args = [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...group.tests,
    "--maxWorkers=1", "--reporter=json", `--outputFile=${resultFile}`];
  console.log(JSON.stringify({ phase: "tests-start", group: group.name, files: group.tests.length }));
  const startedAt = performance.now();
  let failure;
  try {
    await executeCaptured(group.name, process.execPath, args, {
      cwd: path.join(root, group.directory), timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NAPIER_WORKSPACE_RECOVERY_OBSERVATIONS: recoveryObservations },
    });
  } catch (error) { failure = error; }
  const wallMs = Math.round(performance.now() - startedAt);
  const report = await readFile(resultFile, "utf8").then(JSON.parse).catch((error) => {
    throw new AggregateError([...(failure ? [failure] : []), error], `No ${group.name} test report`);
  });
  const files = report.testResults.map((file) => ({
    path: relative(file.name), status: file.status,
    startTime: file.startTime, endTime: file.endTime,
    durationMs: file.endTime - file.startTime,
    assertions: file.assertionResults.map((test) => ({
      name: test.fullName, title: test.title, ancestors: test.ancestorTitles,
      status: test.status, durationMs: test.duration ?? null,
      ...(test.failureMessages?.length ? { failureMessages: test.failureMessages } : {}),
    })),
  }));
  for (const file of files) for (const test of file.assertions) {
    if (test.status !== "passed") console.error(test.name, test.status, test.failureMessages ?? []);
  }
  if (failure) throw failure;
  assert.equal(report.success, true, `${group.name} report did not pass`);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPassedTests, report.numTotalTests, `${group.name} tests were skipped or not executed`);
  assert.deepEqual(files.map((file) => file.path).sort(), group.tests.map((file) => `${group.directory}/${file}`).sort(), "Requested test file coverage differs");
  for (const file of files) {
    assert.ok(file.assertions.length > 0, `${file.path} has no assertions`);
    assert.ok(file.assertions.every((test) => test.status === "passed"), `${file.path} contains unpassed assertions`);
  }
  const assertionCount = files.reduce((sum, file) => sum + file.assertions.length, 0);
  assert.equal(assertionCount, report.numPassedTests, "Assertion totals differ from test counts");
  console.log(JSON.stringify({ phase: "tests-complete", group: group.name, testsPassed: report.numPassedTests, wallMs }));
  return { name: group.name, directory: group.directory, requestedTests: group.tests, wallMs,
    counts: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests,
      pending: report.numPendingTests ?? 0, todo: report.numTodoTests ?? 0 }, files };
}

async function runBrowser() {
  const filename = `${path.basename(options.output, path.extname(options.output))}-${path.basename(temporary)}-browser.json`;
  const resultFile = path.join(temporary, filename);
  const startedAt = performance.now();
  console.log(JSON.stringify({ phase: "browser-start" }));
  await executeCaptured("browser", process.execPath, ["scripts/check-workspace-runtime-ui.mjs", resultFile], {
    cwd: root, timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  });
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  assert.equal(result.externalModelRequests, 0);
  assert.equal(result.productionProcessRestartVerified, true);
  assert.deepEqual(result.viewports.map((viewport) => viewport.width), [1440, 320]);
  const screenshots = [];
  for (const viewport of result.viewports) {
    assert.equal(viewport.overflowPx, 0);
    assert.deepEqual(viewport.pageErrors, []);
    assert.deepEqual(viewport.wrongResponses, []);
    const file = `benchmark-results/workspace-runtime/${filename}/workspace-${viewport.width}.png`;
    screenshots.push({ path: file, sha256: hash(await readFile(path.join(root, file))) });
  }
  return { wallMs: Math.round(performance.now() - startedAt), result, screenshots };
}

async function digestFiles(files) {
  return Promise.all(files.map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
}

async function treeDigest(specification) {
  const { directory, suffixes } = specification;
  const files = (await readdir(path.join(root, directory), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && (suffixes === null || suffixes.some((suffix) => entry.name.endsWith(suffix))))
    .map((entry) => relative(path.join(entry.parentPath, entry.name))).sort();
  assert.ok(files.length > 0, `Missing source/build files in ${directory}`);
  const entries = [];
  for (let offset = 0; offset < files.length; offset += 32) entries.push(...await digestFiles(files.slice(offset, offset + 32)));
  return { directory, suffixes, fileCount: entries.length, sha256: hash(JSON.stringify(entries)) };
}

async function bindings() {
  return { files: await digestFiles(sourceFiles), trees: await Promise.all(trees.map(treeDigest)) };
}

async function captureBindings(stage) {
  const snapshot = await bindings();
  await writeFile(path.join(temporary, `bindings-${stage}.json`), JSON.stringify(snapshot, null, 2) + "\n");
  if (stage === "after") afterBindingsPersisted = true;
  return snapshot;
}

async function executeCaptured(label, command, args, executionOptions) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let result;
  let failure;
  try { result = await execute(command, args, executionOptions); }
  catch (error) { failure = error; }
  const observed = result ?? failure;
  const writes = await Promise.allSettled([
    writeFile(path.join(temporary, `${label}.stdout.log`), observed?.stdout ?? ""),
    writeFile(path.join(temporary, `${label}.stderr.log`), observed?.stderr ?? ""),
    writeFile(path.join(temporary, `${label}.command.json`), JSON.stringify({
      command, args, cwd: executionOptions.cwd, timeoutMs: executionOptions.timeout ?? null,
      startedAt, wallMs: Math.round(performance.now() - started),
      success: failure === undefined,
      ...(failure ? { error: errorDetails(failure) } : {}),
    }, null, 2) + "\n"),
  ]);
  const writeFailures = writes.filter((entry) => entry.status === "rejected");
  if (writeFailures.length) throw new AggregateError([
    ...(failure ? [failure] : []), ...writeFailures.map((entry) => entry.reason),
  ], `Could not persist ${label} command diagnostics`);
  if (failure) throw failure;
  return result;
}

function errorDetails(error) {
  return {
    name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null,
    code: error?.code ?? null, signal: error?.signal ?? null, killed: error?.killed ?? null,
  };
}

async function assertNewOutput(output) {
  try { await access(output); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Evidence output already exists: ${output}`);
}

function parseArguments(args) {
  const result = { output: undefined, browser: false, runtimeTests: [], serverTests: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--browser") result.browser = true;
    else if (argument === "--runtime-test" || argument === "--server-test") {
      const file = args[++index];
      assert.ok(file && /^test\/[a-zA-Z0-9_./-]+\.test\.tsx?$/u.test(file) && !file.split("/").includes(".."), "Additional test must be a package-relative test/*.test.ts or .tsx file");
      result[argument === "--runtime-test" ? "runtimeTests" : "serverTests"].push(file);
    } else if (!argument.startsWith("-") && result.output === undefined) result.output = path.resolve(argument);
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  assert.ok(result.output, "Usage: node scripts/check-workspace-resource-coordination.mjs <new-output-path> [--browser] [--runtime-test test/file.test.ts] [--server-test test/file.test.ts]");
  return result;
}

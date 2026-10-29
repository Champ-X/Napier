import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = process.cwd();
const output = path.resolve(process.argv[2] ?? "/tmp/napier-child-run-foundation.json");
const raw = await mkdtemp(path.join(tmpdir(), "napier-child-run-foundation-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = execFileSync("rg", ["--files", "packages", "apps", "scripts",
  "-g", "*.ts", "-g", "*.tsx", "-g", "*.mjs", "-g", "*.json"], { encoding: "utf8" })
  .trim().split("\n").concat(["package.json", "package-lock.json", "tsconfig.base.json", "docs/architecture-budget.json"])
  .sort();
const snapshot = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file, hash(await readFile(file))])));
const sourceBefore = await snapshot();
const checks = [];

async function check(name, args, { cwd = root, required = true } = {}) {
  const startedAt = new Date().toISOString();
  let result, exitCode = 0;
  try { result = await execute(args[0], args.slice(1), { cwd, maxBuffer: 32 * 1024 * 1024 }); }
  catch (error) { exitCode = typeof error.code === "number" ? error.code : -1; result = error; }
  const log = path.join(raw, `${name}.log`);
  await writeFile(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  const record = { name, command: args, cwd, required, exitCode, startedAt,
    finishedAt: new Date().toISOString(), log, logSha256: hash(await readFile(log)) };
  checks.push(record);
  process.stdout.write(`${name}: ${exitCode}\n`);
  return record;
}

const tsc = path.join(root, "node_modules/typescript/bin/tsc");
await check("contracts-compile", [process.execPath, tsc, "-p", "packages/contracts/tsconfig.json"]);
await check("runtime-compile", [process.execPath, tsc, "-p", "packages/runtime/tsconfig.json"]);
await check("server-compile", [process.execPath, tsc, "-p", "apps/server/tsconfig.json"]);
await check("benchmark-typecheck", [process.execPath, tsc, "-p", "packages/benchmark-kit/tsconfig.json", "--noEmit"]);
await check("web-typecheck", [process.execPath, tsc, "-p", "apps/web/tsconfig.json", "--noEmit"]);
const emittedPaths = [...new Set([
  ...execFileSync("git", ["diff", "--name-only", "HEAD", "--", "packages/contracts/src", "packages/runtime/src", "apps/server/src"], { encoding: "utf8" }).trim().split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "packages/contracts/src", "packages/runtime/src", "apps/server/src"], { encoding: "utf8" }).trim().split("\n"),
])].filter((file) => file.endsWith(".ts")).map((file) => file.replace("/src/", "/dist/").replace(/\.ts$/u, ".js")).sort();
const emittedSnapshot = async () => Object.fromEntries(await Promise.all(emittedPaths.map(async (file) => [file, hash(await readFile(file))])));
const emittedBefore = await emittedSnapshot();

const runtimeTests = files.filter((file) => /^packages\/runtime\/test\/subagent.*\.test\.ts$/u.test(file)).concat([
  "packages/runtime/test/agent-coder-subagent.test.ts",
  "packages/runtime/test/model-session.test.ts",
  "packages/runtime/test/model-capture-cancellation.test.ts",
  "packages/runtime/test/agent-context-overflow-recovery.test.ts",
  "packages/runtime/test/model-adapter-capture.test.ts",
  "packages/runtime/test/research-source-continuity.test.ts",
  "packages/runtime/test/source-continuity-lineage.test.ts",
  "packages/runtime/test/web-fetch-continuity.test.ts",
  "packages/runtime/test/run-recovery-checkpoint.test.ts",
  "packages/runtime/test/agent-manual-run-recovery.test.ts",
  "packages/runtime/test/automatic-recovery.test.ts",
  "packages/runtime/test/tool-effect-indeterminate-recovery.test.ts",
  "packages/runtime/test/run-context-compaction.test.ts",
  "packages/runtime/test/run-context-compaction-runtime.test.ts",
  "packages/runtime/test/run-context-compaction-invocation-port.test.ts",
  "packages/runtime/test/local-private-capsule-store.test.ts",
]);
const webTests = ["subagent-primary-view", "manual-run-recovery", "environment-degradation-view",
  "task-narrative-view-model", "task-narrative-protocol", "thread-run-stream-state", "active-run-view-state",
  "conversation-recoveries-protocol", "recovered-active-run"].map((stem) =>
    files.find((file) => file.startsWith(`apps/web/test/${stem}.test.`)));
if (webTests.some((file) => !file)) throw new Error("Web regression test was not found");
const benchmarkTests = ["workflow-benchmark-child-usage", "workflow-benchmark", "workflow-benchmark-sqlite-evidence",
  "workflow-benchmark-security", "workflow-benchmark-data", "workflow-benchmark-long-horizon", "workflow-benchmark-data-frame"]
  .map((stem) => `packages/benchmark-kit/test/${stem}.test.ts`);
const scriptTests = ["scripts/harness-usage-evidence.test.mjs", "scripts/harness-campaign-analysis.test.mjs"];
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
const suites = await Promise.all([
  suite("runtime", runtimeTests), suite("web", webTests, path.join(root, "apps/web")),
  suite("benchmark", benchmarkTests), suite("usage-campaign", scriptTests),
]);

async function suite(name, tests, cwd = root) {
  const report = path.join(raw, `${name}.json`);
  const result = await check(`${name}-tests`, [process.execPath, vitest, "run",
    ...tests.map((file) => path.relative(cwd, path.join(root, file))), "--maxWorkers=2", "--testTimeout=30000",
    "--reporter=json", `--outputFile=${report}`], { cwd });
  const parsed = JSON.parse(await readFile(report, "utf8"));
  return { name, tests, report, reportSha256: hash(await readFile(report)), exitCode: result.exitCode,
    passed: parsed.numPassedTests, failed: parsed.numFailedTests, skipped: parsed.numPendingTests };
}

const strictTests = files.filter((file) => /^packages\/runtime\/test\/(?:subagent-(?:child|execution-tools|working-set|checkpoint|context-compaction)|model-capture-cancellation|local-private-capsule-store|run-context-compaction-invocation-port).*\.test\.ts$/u.test(file));
await check("new-runtime-tests-strict", [process.execPath, tsc, "--noEmit", "--strict", "--skipLibCheck",
  "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--esModuleInterop",
  "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--noUnusedLocals", "--noUnusedParameters",
  "--resolveJsonModule", "--isolatedModules", "--noFallthroughCasesInSwitch", "--noImplicitOverride",
  "--forceConsistentCasingInFileNames", "--verbatimModuleSyntax", "--lib", "ES2023,DOM,DOM.Iterable", ...strictTests]);
await check("new-web-tests-strict", [process.execPath, tsc, "--noEmit", "--strict", "--skipLibCheck",
  "--target", "ES2023", "--module", "ESNext", "--moduleResolution", "Bundler", "--jsx", "react-jsx",
  "--esModuleInterop", "--types", "vite/client", "apps/web/test/subagent-primary-view.test.tsx"]);
await check("release-build", ["npm", "run", "build", "-w", "@napier/runtime"], { required: false });
await check("architecture", [process.execPath, "scripts/check-architecture.mjs"], { required: false });
await check("public-api", [process.execPath, "scripts/check-public-api.mjs"], { required: false });
await check("diff-check", ["git", "diff", "--check"]);

const sourceAfter = await snapshot();
const sourceDrift = files.filter((file) => sourceBefore[file] !== sourceAfter[file]);
const emittedAfter = await emittedSnapshot();
const emittedDrift = emittedPaths.filter((file) => emittedBefore[file] !== emittedAfter[file]);
const preservedPath = "/tmp/napier-overlay-preserved-user-files-20261029.json";
const preserved = JSON.parse(await readFile(preservedPath, "utf8"));
const preservedDrift = [];
for (const [file, digest] of Object.entries(preserved)) if (hash(await readFile(file)) !== digest) preservedDrift.push(file);
const content = {
  schemaVersion: 1, kind: "napier.subagent-child-run-regression",
  generatedAt: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  root, raw, providerMode: "local fixtures; live-provider tests excluded", checks, suites,
  sourceManifest: sourceBefore, sourceCount: files.length, sourceDrift,
  emittedModuleManifest: emittedBefore, emittedCount: emittedPaths.length, emittedDrift,
  preserved: { manifest: preservedPath, count: Object.keys(preserved).length, changed: preservedDrift },
  passedRequiredChecks: checks.filter((item) => item.required).every((item) => item.exitCode === 0) &&
    suites.every((item) => item.failed === 0 && item.skipped === 0) && sourceDrift.length === 0 && emittedDrift.length === 0 && preservedDrift.length === 0,
  releaseAccepted: false,
  limitations: ["Fixture behavior is not live-model quality evidence", "Private checkpoints do not yet enable safe child restart continuation",
    "Child compaction shares invocation, measurement and summary policy; full child prompt compiler parity remains incomplete",
    "No hard shared-parent token/cost reservation across concurrent children",
    "Late physical usage after an ignored abort remains unknown", "Historical release/API/architecture failures retained"],
};
await writeFile(output, `${JSON.stringify({ ...content, contentSha256: hash(JSON.stringify(content)) }, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`Receipt: ${output}\n`);
if (!content.passedRequiredChecks) process.exitCode = 1;

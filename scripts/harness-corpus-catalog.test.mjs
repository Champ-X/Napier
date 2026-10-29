import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "vitest";
import { buildHarnessCorpusInventory, corpusDigest } from "./harness-corpus-inventory.mjs";
import { loadHarnessCorpusCatalog } from "./harness-corpus-catalog.mjs";
import { prepareHarnessSuite } from "./harness-suite.mjs";
import { syntheticCorpusForInputs } from "./harness-corpus-test-fixture.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-corpus-")); roots.push(root);
  await mkdir(path.join(root, "case/fixture"), { recursive: true });
  await writeFile(path.join(root, "case/fixture/input.txt"), "Synthetic sealed input");
  await writeFile(path.join(root, "case/prompt.md"), "Synthetic sealed task");
  await writeFile(path.join(root, "case/outcome.mjs"), "// synthetic grader");
  await writeFile(path.join(root, "case/manifest.json"), JSON.stringify({ id: "synthetic-sealed-case", fixturePath: "fixture",
    promptPath: "prompt.md", outcomeTestPath: "outcome.mjs" }));
  const suite = path.join(root, "suite.json");
  await writeFile(suite, JSON.stringify({ kind: "napier.harness-optimization-suite", schemaVersion: 1, id: "synthetic-sealed-suite",
    cases: [{ path: "case", coverage: ["synthetic"], taskFamily: "synthetic-sealed-family", partition: "holdout" }] }));
  const inputs = await prepareHarnessSuite(suite, path.join(root, "inputs"));
  const supplement = await syntheticCorpusForInputs(inputs, root), file = path.join(root, "supplement.json");
  await writeFile(file, JSON.stringify(supplement));
  return { root, suite, inputs, supplement, file };
}

test("real corpus inventory retains every source, suite, historical report binding and exact alias", async () => {
  const catalog = await loadHarnessCorpusCatalog(), { catalog: regenerated, audit } = await buildHarnessCorpusInventory(process.cwd(), catalog);
  assert.equal(corpusDigest(regenerated), corpusDigest(catalog));
  assert.equal(audit.sourceRoots, 52); assert.equal(audit.optimizationRoots, 49); assert.equal(audit.suiteCount, 15);
  assert.equal(audit.taskCount, 41); assert.equal(audit.familyCount, 35); assert.equal(audit.campaignEvidenceCount, 184);
  assert.equal(audit.verifiedRawReports.length + audit.unavailableRawReports.length, 25);
  assert.equal(catalog.suites.filter((suite) => suite.cases.every((item) => item.partition === "tuning")).length, 14);
  assert.equal(catalog.suites.flatMap((suite) => suite.cases).filter((item) => item.partition === "holdout").length, 0);
  const retained = catalog.tasks.find((task) => task.aliases.some((alias) => alias.path.startsWith("benchmarks/harness-failures/")));
  assert.equal(retained.familyId, "async-queue"); assert.ok(retained.aliases.length >= 2);
});

test("existing suite snapshots acquire conservative catalog partitions without rewriting source files", async () => {
  const f = await fixture(), catalog = await loadHarnessCorpusCatalog();
  const source = path.resolve("benchmarks/harness-core-quality-suite-v6.json"), before = await readFile(source);
  const input = await prepareHarnessSuite(source, path.join(f.root, "known"), { catalog });
  assert.equal(input.cases.length, 30); assert.ok(input.cases.every((item) => item.partition === "tuning" && item.taskSha256));
  assert.deepEqual(await readFile(source), before);
});

test("valid explicit fixture provenance is read and hash-bound before catalog selection", async () => {
  const f = await fixture(), catalog = await loadHarnessCorpusCatalog(f.file);
  const inputs = await prepareHarnessSuite(f.suite, path.join(f.root, "selected"), { catalog });
  assert.equal(inputs.cases[0].partition, "holdout");
  assert.equal(inputs.corpusCatalog.contentSha256, catalog.contentSha256);
});

test.each(["missing", "bytes", "pointer"])("denies %s provenance in a separate preflight process before its dispatch marker", async (mode) => {
  const f = await fixture(), evidence = f.supplement.evidence[0], artifact = path.join(f.root, evidence.path);
  if (mode === "missing") await rm(artifact);
  if (mode === "bytes") await writeFile(artifact, "{}");
  if (mode === "pointer") {
    evidence.jsonPointer = "/missing";
    const { contentSha256: _old, ...content } = f.supplement; f.supplement.contentSha256 = corpusDigest(content);
    await writeFile(f.file, JSON.stringify(f.supplement));
  }
  const marker = path.join(f.root, "dispatched"), module = new URL("./harness-corpus-catalog.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {loadHarnessCorpusCatalog} from ${JSON.stringify(module)}; import {writeFile} from 'node:fs/promises'; await loadHarnessCorpusCatalog(process.argv[1]); await writeFile(process.argv[2],'dispatched');`,
    f.file, marker], { encoding: "utf8", timeout: 10000 });
  assert.notEqual(child.status, 0); await assert.rejects(readFile(marker), { code: "ENOENT" });
});

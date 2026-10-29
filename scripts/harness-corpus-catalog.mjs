import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskInputIdentity } from "./harness-sample-identity.mjs";

const engine = () => import("../packages/harness-eval/dist/harness-experiments.js");
export async function loadHarnessCorpusCatalog(supplementPath) {
  const { currentHarnessCorpusCatalog, mergeHarnessCorpusCatalogs, validateHarnessCorpusCatalog } = await engine();
  let supplement = supplementPath ? validateHarnessCorpusCatalog(JSON.parse(await readFile(supplementPath, "utf8"))) : undefined;
  if (supplement) supplement = await verifyHoldoutArtifacts(supplement, path.dirname(path.resolve(supplementPath)));
  return mergeHarnessCorpusCatalogs(currentHarnessCorpusCatalog(), supplement);
}

export async function verifyHoldoutArtifacts(catalog, root) {
  const families = catalog.families.filter((family) => family.exposure === "sealed_holdout");
  if (!families.length) return catalog;
  assert.ok(typeof root === "string" && path.isAbsolute(root), "Frozen holdout provenance directory is required");
  const canonicalRoot = await realpath(root);
  for (const family of families) {
    const evidence = catalog.evidence.find((item) => item.id === family.holdoutProvenance.evidenceId);
    const file = path.join(root, evidence.path), stats = await lstat(file);
    assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.size <= 1024 * 1024, "Holdout provenance must be a bounded regular file");
    assert.equal(await realpath(file), path.join(canonicalRoot, evidence.path), "Holdout provenance uses an alias or escapes its catalog directory");
    const bytes = await readFile(file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.fileSha256, "Holdout provenance artifact bytes changed");
    let record = JSON.parse(bytes);
    for (const component of evidence.jsonPointer.split("/").slice(1)) {
      const key = component.replaceAll("~1", "/").replaceAll("~0", "~");
      assert.ok(record && typeof record === "object" && Object.hasOwn(record, key), "Holdout provenance pointer is missing");
      record = record[key];
    }
    const { harnessHoldoutDeclaration, captureHarnessCorpusArtifact } = await engine();
    assert.deepEqual(record, harnessHoldoutDeclaration(family), "Holdout provenance artifact record changed");
    const serialized = bytes.toString("utf8");
    if (evidence.artifactUtf8 !== serialized) catalog = captureHarnessCorpusArtifact(catalog, evidence.id, serialized);
  }
  return catalog;
}

export async function freezeHoldoutArtifacts(catalog, sourceRoot, destination) {
  await verifyHoldoutArtifacts(catalog, sourceRoot);
  const paths = new Set(catalog.families.filter((family) => family.exposure === "sealed_holdout")
    .map((family) => catalog.evidence.find((item) => item.id === family.holdoutProvenance.evidenceId).path));
  if (!paths.size) return undefined;
  await mkdir(destination, { recursive: false });
  for (const relative of paths) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(sourceRoot, relative)), { flag: "wx" });
  }
  await verifyHoldoutArtifacts(catalog, destination);
  return destination;
}

export function resolveHarnessCorpusCase({ catalog, suiteId, suiteSha256, item, caseId, inputSha256, inputs }) {
  const taskSha256 = createHash("sha256").update(taskInputIdentity({
    fixtureSha256: createHash("sha256").update(JSON.stringify(inputs.fixture)).digest("hex"),
    promptSha256: inputs.promptPath, memorySeedSha256: inputs.memorySeedPath ?? null,
  })).digest("hex");
  const task = catalog.tasks.find((task) => task.taskSha256 === taskSha256);
  assert.ok(task && task.aliases.some((alias) => alias.caseId === caseId && alias.inputSha256 === inputSha256),
    "Task inputs are absent from the frozen corpus catalog");
  const suite = catalog.suites.find((suite) => suite.id === suiteId);
  if (suite) assert.equal(suite.fileSha256, suiteSha256, "Known suite source differs from the corpus catalog");
  const member = suite?.cases.find((entry) => entry.caseId === caseId && entry.taskSha256 === taskSha256);
  const family = catalog.families.find((family) => family.id === task.familyId);
  if (item.taskFamily !== undefined)
    assert.ok([family.id, ...family.aliases].includes(item.taskFamily), "Declared task family differs from the corpus");
  const partition = item.partition ?? member?.partition;
  assert.ok(["tuning", "regression", "holdout"].includes(partition), "Catalog-bound custom suite requires an explicit study partition");
  if (partition === "holdout") assert.equal(family.exposure, "sealed_holdout", "Exposed family cannot be declared holdout");
  return { taskFamily: family.id, partition, taskSha256 };
}

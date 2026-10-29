import assert from "node:assert/strict";
import type { HarnessCorpusBinding, HarnessCorpusCatalog, HarnessCorpusFamily, HarnessCorpusSelection,
  HarnessCorpusTask, HarnessExperimentCase } from "@napier/contracts/harness-experiments";
import { canonicalJson, sha256 } from "@napier/runtime/harness-eval-support";
import { CURRENT_HARNESS_CORPUS_REVISION, readKnownHarnessCorpus } from "./harness-corpus-baseline.js";

const HASH = /^[a-f0-9]{64}$/u, ID = /^[a-z][a-z0-9_.-]{1,100}$/u;
const digest = (value: unknown) => sha256(canonicalJson(value));
export const harnessCorpusTaskSha256 = (task: Pick<HarnessCorpusTask, "fixtureSha256" | "promptSha256" | "memorySeedSha256">) =>
  sha256(JSON.stringify([task.fixtureSha256, task.promptSha256, task.memorySeedSha256 ?? null]));
export function harnessCorpusFamilyTaskSetSha256(catalog: Pick<HarnessCorpusCatalog, "tasks">, familyId: string): string {
  return digest(catalog.tasks.filter((task) => task.familyId === familyId).map((task) => ({ taskSha256: task.taskSha256,
    aliases: [...task.aliases].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))) }))
    .sort((left, right) => left.taskSha256.localeCompare(right.taskSha256)));
}
export function harnessHoldoutDeclaration(family: HarnessCorpusFamily) {
  const provenance = family.holdoutProvenance!;
  return { kind: "napier.harness-holdout-declaration", schemaVersion: 1, familyId: family.id,
    taskSetSha256: provenance.taskSetSha256, custodian: provenance.custodian, source: provenance.source,
    sealedAt: provenance.sealedAt, exclusionScope: provenance.exclusionScope };
}

export function validateHarnessCorpusCatalog(input: unknown): HarnessCorpusCatalog {
  assert.ok(input && typeof input === "object", "Harness corpus catalog is required");
  const catalog = input as HarnessCorpusCatalog;
  assert.equal(catalog.kind, "napier.harness-corpus-catalog"); assert.equal(catalog.schemaVersion, 1);
  assert.match(catalog.id, ID); assert.ok(Number.isSafeInteger(catalog.revision) && catalog.revision > 0);
  assert.ok(catalog.previousCatalogSha256 === null || HASH.test(catalog.previousCatalogSha256));
  const { contentSha256, ...content } = catalog;
  assert.equal(digest(content), contentSha256, "Harness corpus catalog hash changed");
  for (const key of ["tasks", "families", "suites", "evidence"] as const)
    assert.ok(Array.isArray(catalog[key]) && catalog[key].length <= 10_000, `Invalid corpus ${key}`);
  unique(catalog.tasks.map((task) => task.taskSha256), "task identity");
  unique(catalog.families.map((family) => family.id), "family");
  unique(catalog.evidence.map((evidence) => evidence.id), "evidence");
  unique(catalog.suites.map((suite) => suite.id), "suite");
  validateEvidence(catalog);
  const familyNames = new Map<string, string>();
  for (const family of catalog.families) validateFamily(family, catalog, familyNames);
  const definitions = new Map<string, string>();
  for (const task of catalog.tasks) validateTask(task, catalog, definitions);
  for (const suite of catalog.suites) validateSuite(suite, catalog);
  return structuredClone(catalog);
}

function validateEvidence(catalog: HarnessCorpusCatalog): void {
  for (const item of catalog.evidence) {
    assert.match(item.id, ID); relativePath(item.path); assert.match(item.fileSha256, HASH);
    assert.ok(typeof item.jsonPointer === "string" && (item.jsonPointer === "" || item.jsonPointer.startsWith("/")));
    assert.ok(["source", "campaign", "retained_failure", "holdout_provenance"].includes(item.kind));
    for (const hash of [item.recordSha256, item.taskSha256, item.sourceIdentitySha256,
      item.fixtureSha256, item.promptSha256, item.outcomeSha256, item.reportSha256])
      if (hash !== undefined) assert.match(hash, HASH);
  }
}
function validateFamily(family: HarnessCorpusFamily, catalog: HarnessCorpusCatalog, names: Map<string, string>): void {
  assert.match(family.id, ID); assert.ok(Array.isArray(family.aliases));
  for (const name of [family.id, ...family.aliases]) {
    assert.match(name, ID);
    assert.ok(!names.has(name), "Harness corpus family alias is ambiguous"); names.set(name, family.id);
  }
  assert.ok(["development_visible", "observed_campaign", "sealed_holdout"].includes(family.exposure));
  assert.ok(Array.isArray(family.evidenceIds) && family.evidenceIds.length > 0, "Corpus family requires provenance");
  for (const id of family.evidenceIds) assert.ok(catalog.evidence.some((item) => item.id === id), "Corpus evidence is missing");
  if (family.exposure !== "sealed_holdout") {
    assert.equal(family.holdoutProvenance, undefined, "Exposed family cannot carry holdout provenance"); return;
  }
  const provenance = family.holdoutProvenance;
  assert.ok(provenance, "Holdout family requires explicit provenance");
  for (const value of [provenance.custodian, provenance.source, provenance.exclusionScope])
    assert.ok(typeof value === "string" && value.trim().length > 0, "Holdout provenance is incomplete");
  assert.ok(Number.isFinite(Date.parse(provenance.sealedAt))); assert.match(provenance.artifactSha256, HASH);
  const evidence = catalog.evidence.find((item) => item.id === provenance.evidenceId);
  assert.ok(evidence?.kind === "holdout_provenance" && family.evidenceIds.includes(evidence.id) &&
    evidence.fileSha256 === provenance.artifactSha256, "Holdout provenance artifact is unbound");
  assert.equal(provenance.taskSetSha256, harnessCorpusFamilyTaskSetSha256(catalog, family.id), "Holdout seal task set differs");
  assert.equal(evidence.recordSha256, digest(harnessHoldoutDeclaration(family)), "Holdout seal declaration differs from its artifact record");
  if (evidence.artifactUtf8 !== undefined) validateDeclarationSnapshot(evidence, family);
  assert.ok(family.evidenceIds.every((id) => catalog.evidence.find((item) => item.id === id)?.kind === "holdout_provenance"),
    "Exposed family cannot be declared holdout");
  assert.ok(!catalog.evidence.some((item) => [family.id, ...family.aliases].includes(item.familyId ?? "") &&
    item.kind !== "holdout_provenance"), "Global exposure evidence forbids this holdout family");
}
function validateDeclarationSnapshot(evidence: HarnessCorpusCatalog["evidence"][number], family: HarnessCorpusFamily): void {
  assert.ok(typeof evidence.artifactUtf8 === "string" && Buffer.byteLength(evidence.artifactUtf8) <= 1024 * 1024,
    "Frozen holdout declaration exceeds its byte limit");
  assert.equal(sha256(evidence.artifactUtf8), evidence.fileSha256, "Frozen holdout declaration bytes changed");
  let record: unknown = JSON.parse(evidence.artifactUtf8);
  for (const component of evidence.jsonPointer.split("/").slice(1)) {
    const key = component.replaceAll("~1", "/").replaceAll("~0", "~");
    assert.ok(record && typeof record === "object" && Object.hasOwn(record, key), "Frozen holdout declaration pointer is missing");
    record = (record as Record<string, unknown>)[key];
  }
  assert.equal(digest(record), digest(harnessHoldoutDeclaration(family)), "Frozen holdout declaration record changed");
}

export function captureHarnessCorpusArtifact(input: HarnessCorpusCatalog, evidenceId: string, artifactUtf8: string): HarnessCorpusCatalog {
  const catalog = structuredClone(input), evidence = catalog.evidence.find((item) => item.id === evidenceId);
  assert.ok(evidence?.kind === "holdout_provenance", "Only holdout declaration artifacts may be captured");
  evidence.artifactUtf8 = artifactUtf8;
  const { contentSha256: _old, ...content } = catalog;
  catalog.contentSha256 = digest(content);
  return validateHarnessCorpusCatalog(catalog);
}
function validateTask(task: HarnessCorpusTask, catalog: HarnessCorpusCatalog, definitions: Map<string, string>): void {
  for (const hash of [task.taskSha256, task.fixtureSha256, task.promptSha256]) assert.match(hash, HASH);
  assert.ok(task.memorySeedSha256 === null || HASH.test(task.memorySeedSha256));
  assert.equal(task.taskSha256, harnessCorpusTaskSha256(task), "Corpus task identity differs from its inputs");
  assert.ok(catalog.families.some((family) => family.id === task.familyId), "Corpus task family is unknown");
  if (catalog.families.find((family) => family.id === task.familyId)?.exposure === "sealed_holdout")
    assert.ok(!catalog.evidence.some((item) => item.taskSha256 === task.taskSha256 && item.kind !== "holdout_provenance"),
      "Historically exposed task cannot acquire a new holdout family");
  assert.ok(Array.isArray(task.aliases) && task.aliases.length > 0);
  for (const alias of task.aliases) {
    assert.match(alias.caseId, ID); relativePath(alias.path);
    for (const hash of [alias.inputSha256, alias.outcomeSha256, alias.manifestSha256]) assert.match(hash, HASH);
    const key = `${alias.caseId}:${alias.inputSha256}`;
    assert.ok(!definitions.has(key) || definitions.get(key) === task.taskSha256, "Corpus task definition is ambiguous");
    definitions.set(key, task.taskSha256);
  }
}
function validateSuite(suite: HarnessCorpusCatalog["suites"][number], catalog: HarnessCorpusCatalog): void {
  assert.match(suite.id, ID); relativePath(suite.path); assert.match(suite.fileSha256, HASH);
  assert.ok(Array.isArray(suite.cases)); unique(suite.cases.map((item) => item.caseId), "suite case");
  for (const item of suite.cases) {
    const task = catalog.tasks.find((task) => task.taskSha256 === item.taskSha256);
    assert.ok(task?.familyId === item.familyId && task.aliases.some((alias) => alias.caseId === item.caseId && alias.path === item.path),
      "Corpus suite case differs from its task");
    assert.ok(["tuning", "regression", "holdout"].includes(item.partition));
    if (item.partition === "holdout") assert.equal(catalog.families.find((family) => family.id === item.familyId)?.exposure,
      "sealed_holdout", "Exposed family cannot be declared holdout");
  }
}

export function currentHarnessCorpusCatalog(): HarnessCorpusCatalog {
  return validateHarnessCorpusCatalog(readKnownHarnessCorpus());
}

/** A supplement is additive. It cannot erase or reinterpret known exposure or task identity. */
export function mergeHarnessCorpusCatalogs(baseInput: unknown, supplementInput?: unknown): HarnessCorpusCatalog {
  const base = validateHarnessCorpusCatalog(baseInput);
  if (supplementInput === undefined) return base;
  const supplement = validateHarnessCorpusCatalog(supplementInput);
  const content = { kind: base.kind, schemaVersion: base.schemaVersion, id: base.id, revision: base.revision,
    previousCatalogSha256: base.previousCatalogSha256,
    tasks: mergeBy(base.tasks, supplement.tasks, (item) => item.taskSha256),
    families: mergeBy(base.families, supplement.families, (item) => item.id),
    suites: mergeBy(base.suites, supplement.suites, (item) => item.id),
    evidence: mergeBy(base.evidence, supplement.evidence, (item) => item.id) };
  return validateHarnessCorpusCatalog({ ...content, contentSha256: digest(content) });
}
function mergeBy<T>(base: T[], supplement: T[], key: (value: T) => string): T[] {
  const result = new Map(base.map((item) => [key(item), item]));
  for (const item of supplement) {
    const existing = result.get(key(item));
    assert.ok(!existing || canonicalJson(existing) === canonicalJson(item), "Supplement conflicts with known corpus exposure");
    result.set(key(item), item);
  }
  return [...result.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

export function createHarnessCorpusBinding(catalog: HarnessCorpusCatalog, selection: HarnessCorpusSelection[],
  registeredAt: string = new Date().toISOString()): HarnessCorpusBinding {
  const baseline = currentHarnessCorpusCatalog();
  const content = { kind: "napier.harness-corpus-binding" as const, schemaVersion: 1 as const, registeredAt,
    baselineCatalogRevision: CURRENT_HARNESS_CORPUS_REVISION, baselineCatalogSha256: baseline.contentSha256,
    catalog, selection: [...selection].sort((left, right) => left.caseId.localeCompare(right.caseId)) };
  return validateHarnessCorpusBinding({ ...content, contentSha256: digest(content) });
}

export function validateHarnessCorpusBinding(input: unknown, cases?: readonly HarnessExperimentCase[]): HarnessCorpusBinding {
  assert.ok(input && typeof input === "object", "Harness corpus binding is required");
  const binding = input as HarnessCorpusBinding, { contentSha256, ...content } = binding;
  assert.equal(binding.kind, "napier.harness-corpus-binding"); assert.equal(binding.schemaVersion, 1);
  assert.equal(digest(content), contentSha256, "Harness corpus binding hash changed");
  assert.ok(Number.isFinite(Date.parse(binding.registeredAt)), "Corpus registration time is invalid");
  const catalog = validateHarnessCorpusCatalog(binding.catalog);
  for (const family of catalog.families.filter((family) => family.exposure === "sealed_holdout"))
    assert.ok(typeof catalog.evidence.find((item) => item.id === family.holdoutProvenance!.evidenceId)?.artifactUtf8 === "string",
      "Frozen holdout declaration artifact is required for qualification");
  const baseline = validateHarnessCorpusCatalog(readKnownHarnessCorpus(binding.baselineCatalogRevision));
  assert.equal(binding.baselineCatalogSha256, baseline.contentSha256, "Known corpus baseline differs");
  assertExposureFloor(catalog, baseline);
  assert.ok(Array.isArray(binding.selection) && binding.selection.length > 0);
  unique(binding.selection.map((item) => item.caseId), "selection case");
  unique(binding.selection.map((item) => item.taskSha256), "selection task");
  const partitions = new Map<string, string>();
  for (const item of binding.selection) validateSelection(item, catalog, binding.registeredAt, partitions);
  if (cases) {
    assert.deepEqual([...binding.selection.map((item) => item.caseId)].sort(), [...cases.map((item) => item.id)].sort(), "Corpus selection differs from experiment");
    for (const item of cases) {
      const selected = binding.selection.find((entry) => entry.caseId === item.id)!;
      assert.ok(selected.inputSha256 === item.inputSha256 && selected.familyId === item.taskFamily && selected.partition === item.partition,
        "Corpus selection contradicts experiment partition or inputs");
    }
  }
  return structuredClone(binding);
}
function assertExposureFloor(catalog: HarnessCorpusCatalog, baseline: HarnessCorpusCatalog): void {
  for (const field of ["tasks", "families", "suites", "evidence"] as const) {
    const retained = new Set(catalog[field].map((item) => canonicalJson(item)));
    for (const item of baseline[field]) assert.ok(retained.has(canonicalJson(item)), "Known corpus exposure cannot be removed or changed");
  }
  const sourceFamilies = new Map<string, string>();
  for (const task of baseline.tasks) for (const alias of task.aliases) {
    sourceFamilies.set(`case:${alias.caseId}`, task.familyId);
    sourceFamilies.set(`path:${alias.path}`, task.familyId);
  }
  for (const task of catalog.tasks) for (const alias of task.aliases)
    for (const key of [`case:${alias.caseId}`, `path:${alias.path}`]) {
      const known = sourceFamilies.get(key);
      assert.ok(!known || known === task.familyId, "Known source identity cannot acquire a new task family");
    }
}
function validateSelection(item: HarnessCorpusSelection, catalog: HarnessCorpusCatalog, registeredAt: string, partitions: Map<string, string>): void {
  const task = catalog.tasks.find((task) => task.taskSha256 === item.taskSha256);
  assert.ok(task && task.familyId === item.familyId && task.aliases.some((alias) => alias.caseId === item.caseId && alias.inputSha256 === item.inputSha256),
    "Corpus selection task inputs or family differ");
  assert.ok(["tuning", "regression", "holdout"].includes(item.partition));
  assert.ok(!partitions.has(item.familyId) || partitions.get(item.familyId) === item.partition, "Corpus family cannot span study partitions");
  partitions.set(item.familyId, item.partition);
  if (item.partition === "holdout") {
    const family = catalog.families.find((family) => family.id === item.familyId)!;
    assert.ok(family.exposure === "sealed_holdout" && family.holdoutProvenance &&
      Date.parse(family.holdoutProvenance.sealedAt) <= Date.parse(registeredAt), "Exposed or unsealed family cannot be declared holdout");
  }
}
export function harnessCorpusQualificationBlockers(corpus: HarnessCorpusBinding | undefined, cases: readonly HarnessExperimentCase[]): string[] {
  if (!corpus) return ["corpus_provenance_missing"];
  validateHarnessCorpusBinding(corpus, cases);
  return corpus.selection.some((item) => item.partition === "holdout") ? [] : ["untuned_task_family_evidence_missing"];
}
function unique(values: readonly string[], label: string): void { assert.equal(new Set(values).size, values.length, `Duplicate corpus ${label}`); }
function relativePath(value: string): void {
  assert.ok(typeof value === "string" && /^[a-z0-9][a-z0-9._/-]*$/u.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Corpus paths must be canonical lowercase relative references");
}

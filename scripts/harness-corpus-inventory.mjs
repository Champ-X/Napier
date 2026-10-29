import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { inventorySuiteTree } from "./harness-suite.mjs";
import { taskInputIdentity } from "./harness-sample-identity.mjs";

export const corpusDigest = (value) => hash(JSON.stringify(sorted(value)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
const reportSources = ["harness-optimization-pilots-2026-09-13.json", "cross-domain-qualification-2026-09-13.json",
  "python-debugger-oci-2026-09-13.json"];
const rawReportSources = ["bounded-eleven-pair-statistics-2026-09-15.json", "bounded-queue-contract-failure-2026-09-15.json"];
const readJson = async (file) => { const bytes = await readFile(file); return { value: JSON.parse(bytes), fileSha256: hash(bytes) }; };

/** Deterministic offline inventory. Semantic family assignments are explicit in the reviewed map. */
export async function buildHarnessCorpusInventory(repoRoot, retained) {
  const mapping = await readJson(path.join(repoRoot, "benchmarks/harness-corpus-family-map-v1.json"));
  const suites = await sourceSuites(repoRoot), roots = new Set(suites.flatMap(({ value, relative }) =>
    value.cases.map((item) => path.posix.join(path.posix.dirname(relative), item.path))));
  for (const item of await readdir(path.join(repoRoot, "benchmarks/harness-optimization"), { withFileTypes: true }))
    if (item.isDirectory()) roots.add(`benchmarks/harness-optimization/${item.name}`);
  assert.deepEqual([...roots].sort(), Object.keys(mapping.value.families).sort(), "Corpus family map must cover every current source root");
  const tasks = new Map(), evidence = [], families = new Map(), byPath = new Map();
  for (const root of [...roots].sort()) {
    const familyId = mapping.value.families[root], task = await taskSource(repoRoot, root, familyId);
    const existing = tasks.get(task.taskSha256);
    assert.ok(!existing || existing.familyId === familyId, "Exact task aliases require the same family");
    if (existing) existing.aliases.push(...task.aliases); else tasks.set(task.taskSha256, task);
    byPath.set(root, task);
    const id = `source-${hash(root).slice(0, 24)}`;
    evidence.push({ id, kind: "source", path: `${root}/manifest.json`, fileSha256: task.aliases[0].manifestSha256,
      jsonPointer: "", taskSha256: task.taskSha256, caseId: task.aliases[0].caseId, familyId });
    const family = families.get(familyId) ?? { id: familyId, aliases: familyId === "async-queue" ? ["bounded-async-queue"] : [],
      exposure: "development_visible", evidenceIds: [] };
    family.evidenceIds.push(id); families.set(familyId, family);
  }
  const reportAudit = await campaignEvidence(repoRoot, retained, [...tasks.values()]);
  for (const item of reportAudit.evidence) {
    evidence.push(item);
    if (item.familyId) {
      const family = families.get(item.familyId); family.exposure = "observed_campaign"; family.evidenceIds.push(item.id);
    }
  }
  const mappedSuites = suites.map(({ value, relative, fileSha256 }) => ({ id: value.id, path: relative, fileSha256,
    cases: value.cases.map((item) => {
      const root = path.posix.join(path.posix.dirname(relative), item.path), task = byPath.get(root);
      return { caseId: task.aliases[0].caseId, path: root, taskSha256: task.taskSha256, familyId: task.familyId,
        partition: relative === "benchmarks/harness-failure-regression-suite-v1.json" ? "regression" : "tuning" };
    }) }));
  const content = { kind: "napier.harness-corpus-catalog", schemaVersion: 1, id: "napier-harness-corpus", revision: 1,
    previousCatalogSha256: null, tasks: [...tasks.values()].sort((a, b) => a.taskSha256.localeCompare(b.taskSha256)),
    families: [...families.values()].map((family) => ({ ...family, evidenceIds: [...new Set(family.evidenceIds)].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)), suites: mappedSuites.sort((a, b) => a.id.localeCompare(b.id)),
    evidence: evidence.sort((a, b) => a.id.localeCompare(b.id)) };
  return { catalog: { ...content, contentSha256: corpusDigest(content) }, audit: { sourceRoots: roots.size,
    optimizationRoots: [...roots].filter((root) => root.startsWith("benchmarks/harness-optimization/")).length,
    suiteCount: suites.length, taskCount: tasks.size, familyCount: families.size, ...reportAudit.audit } };
}
async function sourceSuites(repoRoot) {
  const result = [];
  for (const name of (await readdir(path.join(repoRoot, "benchmarks"))).sort()) {
    if (!name.endsWith(".json")) continue;
    const relative = `benchmarks/${name}`, source = await readJson(path.join(repoRoot, relative));
    if (source.value.kind === "napier.harness-optimization-suite") result.push({ ...source, relative });
  }
  return result;
}
async function taskSource(repoRoot, relative, familyId) {
  const root = path.join(repoRoot, relative), source = await readJson(path.join(root, "manifest.json")), manifest = source.value;
  const inputs = {};
  for (const key of ["promptPath", "outcomeTestPath", "memorySeedPath"]) {
    if (key === "memorySeedPath" && !manifest[key]) continue;
    assert.ok(typeof manifest[key] === "string" && !path.isAbsolute(manifest[key]) && !manifest[key].split(/[\\/]/u).includes(".."));
    inputs[key] = hash(await readFile(path.join(root, manifest[key])));
  }
  inputs.fixture = await inventorySuiteTree(path.join(root, manifest.fixturePath));
  const identity = { fixtureSha256: hash(JSON.stringify(inputs.fixture)), promptSha256: inputs.promptPath,
    memorySeedSha256: inputs.memorySeedPath ?? null };
  return { taskSha256: hash(taskInputIdentity(identity)), familyId, ...identity, aliases: [{ caseId: manifest.id,
    path: relative, inputSha256: hash(JSON.stringify(inputs)), outcomeSha256: inputs.outcomeTestPath, manifestSha256: source.fileSha256 }] };
}
async function campaignEvidence(repoRoot, retained, tasks) {
  const evidence = [], unavailableRawReports = [], verifiedRawReports = [];
  const knownCases = new Map(tasks.flatMap((task) => task.aliases.map((alias) => [alias.caseId, task.familyId])));
  for (const name of reportSources) {
    const relative = `docs/artifacts/${name}`, source = await readJson(path.join(repoRoot, relative));
    for (const { value, pointer } of reportsIn(source.value))
      evidence.push(reportEvidence(relative, source.fileSha256, pointer, value, knownCases));
  }
  for (const name of rawReportSources) {
    const relative = `docs/artifacts/${name}`, source = await readJson(path.join(repoRoot, relative));
    for (const { value, pointer } of reportReferences(source.value)) {
      const id = `campaign-${hash(`${relative}#${pointer}`).slice(0, 24)}`;
      try {
        const raw = await readJson(value.path);
        assert.equal(raw.fileSha256, value.sha256, "Bound raw campaign report digest changed");
        evidence.push(reportEvidence(relative, source.fileSha256, pointer, raw.value, knownCases, raw.fileSha256));
        verifiedRawReports.push({ path: relative, pointer, reportSha256: raw.fileSha256 });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const previous = retained?.evidence.find((item) => item.id === id);
        assert.ok(previous && previous.fileSha256 === source.fileSha256 && previous.reportSha256 === value.sha256,
          "Unavailable raw campaign evidence requires its retained exact provenance");
        evidence.push(previous); unavailableRawReports.push({ path: relative, pointer, reportSha256: value.sha256 });
      }
    }
  }
  const relative = "benchmarks/harness-failures/bounded-queue-false-completion-v1/reproduction.json";
  const reproduction = await readJson(path.join(repoRoot, relative)), report = reproduction.value;
  evidence.push({ id: "retained-bounded-queue-failure", kind: "retained_failure", path: relative,
    fileSha256: reproduction.fileSha256, jsonPointer: "", recordSha256: corpusDigest(report),
    runId: report.originalRunId, caseId: report.originalCaseId, familyId: "async-queue",
    taskSha256: hash(taskInputIdentity(report)), fixtureSha256: report.fixtureSha256, promptSha256: report.promptSha256,
    memorySeedSha256: report.memorySeedSha256 ?? null, outcomeSha256: report.outcomeSha256,
    sourceIdentitySha256: corpusDigest(report.sourceIdentity),
    ...(report.reportSha256 ? { reportSha256: report.reportSha256, hashEncoding: "parsed_json" } : {}) });
  return { evidence, audit: { campaignEvidenceCount: evidence.filter((item) => item.kind === "campaign").length,
    distinctObservedRunCount: new Set(evidence.map((item) => item.runId).filter(Boolean)).size,
    verifiedRawReports, unavailableRawReports } };
}
function reportEvidence(relative, fileSha256, pointer, report, knownCases, rawSha256) {
  const id = `campaign-${hash(`${relative}#${pointer}`).slice(0, 24)}`;
  assert.ok(report.runId && report.caseId && report.fixtureSha256 && report.promptSha256 && report.outcomeSha256,
    "Campaign exposure requires exact task identity");
  return { id, kind: "campaign", path: relative, fileSha256, jsonPointer: pointer, recordSha256: corpusDigest(report),
    runId: report.runId, caseId: report.caseId, taskSha256: hash(taskInputIdentity(report)),
    ...(knownCases.has(report.caseId) ? { familyId: knownCases.get(report.caseId) } : {}),
    fixtureSha256: report.fixtureSha256, promptSha256: report.promptSha256, memorySeedSha256: report.memorySeedSha256 ?? null,
    outcomeSha256: report.outcomeSha256, reportSha256: rawSha256 ?? hash(JSON.stringify(report)),
    hashEncoding: rawSha256 ? "raw_bytes" : "parsed_json",
    ...(report.sourceIdentity ? { sourceIdentitySha256: corpusDigest(report.sourceIdentity) } : {}) };
}
function* reportsIn(value, pointer = "") {
  if (!value || typeof value !== "object") return;
  if (value.runId && value.caseId && value.fixtureSha256 && value.promptSha256 && value.outcomeSha256) { yield { value, pointer }; return; }
  for (const [key, child] of Object.entries(value)) yield* reportsIn(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
}
function* reportReferences(value, pointer = "") {
  if (!value || typeof value !== "object") return;
  if (typeof value.reportPath === "string" && typeof value.reportSha256 === "string") {
    yield { value: { path: value.reportPath, sha256: value.reportSha256 }, pointer }; return;
  }
  if (typeof value.path === "string" && value.path.endsWith("/result.json") && typeof value.sha256 === "string") { yield { value, pointer }; return; }
  for (const [key, child] of Object.entries(value)) yield* reportReferences(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
}

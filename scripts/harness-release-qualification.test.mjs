import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../packages/runtime/dist/harness-eval-support.js";
import { createHarnessCorpusBinding, createHarnessExperiment, createHarnessExperimentReleaseEvidence,
  createModelHarnessExperimentProfile, currentHarnessCorpusCatalog, evaluateHarnessExperiment,
  harnessCorpusFamilyTaskSetSha256, harnessCorpusTaskSha256, harnessHoldoutDeclaration,
  mergeHarnessCorpusCatalogs, qualifyHarnessExperimentReleaseEvidence,
  validateHarnessExperimentReleaseEvidence } from "../packages/harness-eval/dist/harness-experiments.js";
import { auditReleaseArtifacts } from "./check-release-artifacts.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const historicalPath = "docs/artifacts/harness-experiment-release-evidence-0.1.3.json";
const sourceManifestPath = "docs/artifacts/default-product-source-manifest-0.1.3.json";
const execFile = promisify(execFileCallback);
const roots = [];
const hashed = (content) => ({ ...content, contentSha256: sha256(canonicalJson(content)) });

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function linkedAuditRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-harness-release-gate-")); roots.push(root);
  // The audit only reads these retained inputs. New scenario evidence lives in this temporary root.
  for (const name of [".github", "apps", "benchmarks", "benchmark-results", "docker", "docs", "packages", "scripts", "skills", "package.json", "package-lock.json", "tsconfig.base.json"])
    await symlink(path.join(repoRoot, name), path.join(root, name));
  return root;
}

function syntheticCorpus(cases) {
  const tasks = cases.map((item) => {
    const identity = { fixtureSha256: sha256(`synthetic fixture ${item.id}`), promptSha256: sha256(`synthetic prompt ${item.id}`), memorySeedSha256: null };
    return { ...identity, taskSha256: harnessCorpusTaskSha256(identity), familyId: item.taskFamily,
      aliases: [{ caseId: item.id, path: `synthetic/${item.id}`, inputSha256: item.inputSha256,
        outcomeSha256: sha256(`synthetic grader ${item.id}`), manifestSha256: sha256(`synthetic manifest ${item.id}`) }] };
  });
  const families = cases.map((item) => ({ id: item.taskFamily, aliases: [], exposure: "sealed_holdout", evidenceIds: [`seal-${item.id}`],
    holdoutProvenance: { custodian: "Synthetic contract test", source: "Generated test data; no real model observations",
      sealedAt: "2026-01-01T00:00:00.000Z", exclusionScope: "Synthetic mechanism test only", taskSetSha256: "", artifactSha256: "", evidenceId: `seal-${item.id}` } }));
  const content = { kind: "napier.harness-corpus-catalog", schemaVersion: 1, id: "release-gate-synthetic", revision: 1,
    previousCatalogSha256: null, tasks, families, suites: [], evidence: [] };
  for (const family of families) {
    family.holdoutProvenance.taskSetSha256 = harnessCorpusFamilyTaskSetSha256(content, family.id);
    const declaration = harnessHoldoutDeclaration(family), artifactUtf8 = JSON.stringify(declaration);
    family.holdoutProvenance.artifactSha256 = sha256(artifactUtf8);
    content.evidence.push({ id: family.holdoutProvenance.evidenceId, kind: "holdout_provenance", path: `synthetic/${family.id}.json`,
      fileSha256: sha256(artifactUtf8), jsonPointer: "", recordSha256: sha256(canonicalJson(declaration)), artifactUtf8 });
  }
  return createHarnessCorpusBinding(mergeHarnessCorpusCatalogs(currentHarnessCorpusCatalog(), hashed(content)),
    tasks.map((task, index) => ({ caseId: cases[index].id, inputSha256: cases[index].inputSha256,
      taskSha256: task.taskSha256, familyId: task.familyId, partition: "holdout" })), "2026-01-02T00:00:00.000Z");
}

async function syntheticEvidence(withCorpus) {
  // Observations and claimed provenance are synthetic values for exercising the consumer contract.
  const cases = Array.from({ length: 30 }, (_, index) => ({ id: `release-gate-case-${index}`, inputSha256: sha256(`release gate input ${index}`),
    tags: ["synthetic"], taskFamily: `release-gate-family-${index}`, partition: "holdout" }));
  const experiment = createHarnessExperiment({ id: "release-gate-synthetic", cases,
    baselineProfile: createModelHarnessExperimentProfile({ id: "release-gate-base", maxActiveTools: 20 }),
    candidateProfile: createModelHarnessExperimentProfile({ id: "release-gate-candidate", maxActiveTools: 12 }),
    modelRouteLock: { role: "default", servingModel: { provider: "declared-provider", id: "declared-model" }, fallbackSamples: "separate_stratum" },
    seeds: [11, 22, 33], primaryMetrics: ["task_success"], guardrailMetrics: ["intervention_count"],
    analysis: { evidenceKind: "live_model", clusterBy: "task_family" }, ...(withCorpus ? { corpus: syntheticCorpus(cases) } : {}) });
  const executions = ["2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z"].map((finishedAt, round) => {
    const trials = experiment.cases.flatMap((item, caseIndex) => experiment.seeds.flatMap((seed, seedIndex) => {
      const arms = (caseIndex * experiment.seeds.length + seedIndex) % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
      return arms.map((arm) => ({ caseId: item.id, seed, arm, runId: `synthetic-${round}-${item.id}-${seed}-${arm}`,
        servingModel: experiment.modelRouteLock.servingModel, fallbackUsed: false, evidenceKind: "live_model",
        profileSha256: (arm === "baseline" ? experiment.baselineProfile : experiment.candidateProfile).contentSha256,
        harnessReceiptSha256: sha256(`synthetic receipt ${round} ${item.id} ${seed} ${arm}`),
        metrics: { task_success: 1, intervention_count: 0, tool_schema_tokens: arm === "baseline" ? 100 : 60 } }));
    }));
    return hashed({ kind: "napier.harness-experiment-execution", schemaVersion: 1, experimentId: experiment.id,
      experimentSha256: experiment.contentSha256, startedAt: finishedAt, finishedAt, trials, failures: [], evaluation: evaluateHarnessExperiment(experiment, trials) });
  });
  const manifest = JSON.parse(await readFile(path.join(repoRoot, sourceManifestPath), "utf8"));
  return createHarnessExperimentReleaseEvidence({ generatedAt: "2026-01-05T00:00:00.000Z", productVersion: manifest.productVersion, experiment, executions,
    bindings: executions.map((execution) => ({ executionSha256: execution.contentSha256, sourceManifestSha256: manifest.contentSha256,
      configurationSha256: sha256("synthetic configuration"), environmentSha256: sha256("synthetic environment"), graderSha256: sha256("synthetic grader"), credentialClass: "workload_identity" })) });
}

describe("production Harness release qualification consumers", () => {
  it("reads historical evidence unchanged but rejects its raw promotion flag in the release audit", async () => {
    const before = await readFile(path.join(repoRoot, historicalPath)), historical = validateHarnessExperimentReleaseEvidence(JSON.parse(before));
    expect(historical.promotionReady).toBe(true);
    const result = await auditReleaseArtifacts({ repoRoot: await linkedAuditRoot() });
    expect(result.errors).toContain("harness experiment release evidence: corpus_provenance_missing,evidence_does_not_support_live_quality");
    expect(result.artifacts.find((artifact) => artifact.kind === "harness-experiment-release-evidence")?.valid).toBe(false);
    expect(await readFile(path.join(repoRoot, historicalPath))).toEqual(before);
  });

  it.each([false, true])("enforces corpus provenance on declared live qualification (corpus=%s)", async (withCorpus) => {
    const root = await linkedAuditRoot(), evidence = await syntheticEvidence(withCorpus);
    expect(qualifyHarnessExperimentReleaseEvidence(evidence).promotionReady).toBe(withCorpus);
    await writeFile(path.join(root, "synthetic-harness.json"), JSON.stringify(evidence));
    const result = await auditReleaseArtifacts({ repoRoot: root, harnessExperimentReleaseEvidencePath: "synthetic-harness.json" });
    const errors = result.errors.filter((error) => error.startsWith("harness experiment release evidence:"));
    expect(errors).toEqual(withCorpus ? [] : ["harness experiment release evidence: corpus_provenance_missing"]);
    expect(result.artifacts.find((artifact) => artifact.kind === "harness-experiment-release-evidence")?.valid).toBe(withCorpus);
    // Other retained artifacts are intentionally not requalified by this scoped consumer test.
    expect(result.ok).toBe(false);
  });

  it("stops the actual acceptance generator at corpus rejection before collection or artifact writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-harness-acceptance-gate-")); roots.push(root);
    await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
    await symlink(path.join(repoRoot, "packages"), path.join(root, "packages"));
    await cp(path.join(repoRoot, historicalPath), path.join(root, historicalPath));
    await cp(path.join(repoRoot, "scripts/create-agent-harness-acceptance-evidence.mjs"), path.join(root, "scripts/create-agent-harness-acceptance-evidence.mjs"));
    await symlink(path.join(repoRoot, "scripts/release-product-source-manifest.mjs"), path.join(root, "scripts/release-product-source-manifest.mjs"));
    // If the production guard regresses, the first collector marks the boundary and fails before any model or storage work.
    const marker = path.join(root, "collection-started");
    for (const [name, exported] of [["bridge", "collectCodeBridgeEvidence"], ["route-tools", "collectRouteAndToolEvidence"], ["subagents", "collectSubagentEvidence"], ["token", "collectTokenEvidence"]])
      await writeFile(path.join(root, `scripts/agent-harness-acceptance-${name}.mjs`), `import { writeFile } from "node:fs/promises"; export async function ${exported}() { await writeFile(${JSON.stringify(marker)}, "called"); throw new Error("Unexpected evidence collection"); }`);
    const before = await readFile(path.join(root, historicalPath));
    const result = await execFile(process.execPath, [path.join(root, "scripts/create-agent-harness-acceptance-evidence.mjs")], { cwd: root, timeout: 30_000 }).then(
      () => ({ accepted: true, stderr: "" }), (error) => ({ accepted: false, stderr: error.stderr }));
    expect(result.accepted).toBe(false);
    expect(result.stderr).toContain("Harness experiment evidence is blocked: corpus_provenance_missing,evidence_does_not_support_live_quality");
    expect(await readdir(root)).not.toContain("collection-started");
    expect(await readdir(path.join(root, "docs/artifacts"))).toEqual([path.basename(historicalPath)]);
    expect(await readFile(path.join(root, historicalPath))).toEqual(before);
  });
});

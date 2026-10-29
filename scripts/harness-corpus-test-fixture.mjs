import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { corpusDigest } from "./harness-corpus-inventory.mjs";
import { taskInputIdentity } from "./harness-sample-identity.mjs";

/** Synthetic provenance for contract tests only. Never register this as a real held-out corpus. */
export async function syntheticCorpusForInputs(inputs, provenanceRoot) {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const tasks = [], families = new Map(), evidence = [];
  for (const item of inputs.cases) {
    const manifest = JSON.parse(await readFile(path.join(item.path, "manifest.json"), "utf8"));
    const fixture = Object.fromEntries(Object.entries(item.files).filter(([name]) => name.startsWith(`${manifest.fixturePath}/`))
      .map(([name, digest]) => [name.slice(manifest.fixturePath.length + 1), digest]));
    const identity = { fixtureSha256: hash(JSON.stringify(fixture)), promptSha256: item.files[manifest.promptPath],
      memorySeedSha256: item.files[manifest.memorySeedPath] ?? null };
    tasks.push({ taskSha256: hash(taskInputIdentity(identity)), ...identity, familyId: item.taskFamily,
      aliases: [{ caseId: item.id, path: `synthetic/${item.id}`, inputSha256: item.inputSha256,
        outcomeSha256: item.files[manifest.outcomeTestPath], manifestSha256: item.files["manifest.json"] }] });
    if (!families.has(item.taskFamily)) {
      const id = `fixture-${item.taskFamily}`, artifactSha256 = hash(`Synthetic declaration ${item.taskFamily}`);
      const holdout = item.partition === "holdout";
      evidence.push({ id, kind: holdout ? "holdout_provenance" : "source", path: `synthetic/${item.taskFamily}.json`, fileSha256: artifactSha256, jsonPointer: "" });
      families.set(item.taskFamily, { id: item.taskFamily, aliases: [], exposure: holdout ? "sealed_holdout" : "development_visible", evidenceIds: [id],
        ...(holdout ? { holdoutProvenance: { custodian: "Synthetic test fixture", source: "Generated contract test data",
          sealedAt: "2026-01-01T00:00:00.000Z", exclusionScope: "Synthetic scope only; no real model quality claim", taskSetSha256: "",
          artifactSha256, evidenceId: id } } : {}) });
    }
  }
  const content = { kind: "napier.harness-corpus-catalog", schemaVersion: 1, id: "synthetic-corpus", revision: 1,
    previousCatalogSha256: null, tasks, families: [...families.values()], suites: [], evidence };
  const { harnessCorpusFamilyTaskSetSha256, harnessHoldoutDeclaration } = await import("../packages/harness-eval/dist/harness-experiments.js");
  for (const family of content.families.filter((family) => family.exposure === "sealed_holdout")) {
    family.holdoutProvenance.taskSetSha256 = harnessCorpusFamilyTaskSetSha256(content, family.id);
    const declaration = harnessHoldoutDeclaration(family), bytes = JSON.stringify(declaration);
    const source = evidence.find((item) => item.id === family.holdoutProvenance.evidenceId);
    source.fileSha256 = family.holdoutProvenance.artifactSha256 = hash(bytes);
    source.recordSha256 = corpusDigest(declaration);
    source.artifactUtf8 = bytes;
    if (provenanceRoot) {
      await mkdir(path.dirname(path.join(provenanceRoot, source.path)), { recursive: true });
      await writeFile(path.join(provenanceRoot, source.path), bytes);
    }
  }
  return { ...content, contentSha256: corpusDigest(content) };
}

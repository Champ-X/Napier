import { describe, expect, it } from "vitest";
import type { HarnessCorpusCatalog, HarnessCorpusSelection } from "@napier/contracts/harness-experiments";
import { canonicalJson, sha256 } from "@napier/runtime/harness-eval-support";
import { createHarnessCorpusBinding, currentHarnessCorpusCatalog, harnessCorpusQualificationBlockers,
  harnessCorpusTaskSha256, mergeHarnessCorpusCatalogs, validateHarnessCorpusBinding,
  validateHarnessCorpusCatalog, harnessCorpusFamilyTaskSetSha256, harnessHoldoutDeclaration } from "../src/harness-corpus.js";

const digest = (value: unknown) => sha256(canonicalJson(value));
function rehash<T extends { contentSha256: string }>(value: T): T {
  const { contentSha256: _old, ...content } = value; value.contentSha256 = digest(content); return value;
}
function reseal(catalog: HarnessCorpusCatalog): void {
  const family = catalog.families.find((family) => family.exposure === "sealed_holdout")!;
  family.holdoutProvenance!.taskSetSha256 = harnessCorpusFamilyTaskSetSha256(catalog, family.id);
  const evidence = catalog.evidence.find((item) => item.id === family.holdoutProvenance!.evidenceId)!;
  const declaration = harnessHoldoutDeclaration(family);
  evidence.recordSha256 = digest(declaration); evidence.artifactUtf8 = JSON.stringify(declaration);
  evidence.fileSha256 = family.holdoutProvenance!.artifactSha256 = sha256(evidence.artifactUtf8);
}
function syntheticHoldout() {
  const identity = { fixtureSha256: sha256("fixture"), promptSha256: sha256("prompt"), memorySeedSha256: null };
  const artifactSha256 = sha256("Synthetic test provenance; not real held-out evidence");
  const content: Omit<HarnessCorpusCatalog, "contentSha256"> = {
    kind: "napier.harness-corpus-catalog", schemaVersion: 1, id: "synthetic-corpus", revision: 1, previousCatalogSha256: null,
    tasks: [{ ...identity, taskSha256: harnessCorpusTaskSha256(identity), familyId: "synthetic-family", aliases: [{
      caseId: "synthetic-case", path: "synthetic/case", inputSha256: sha256("input"), outcomeSha256: sha256("outcome"), manifestSha256: sha256("manifest") }] }],
    families: [{ id: "synthetic-family", aliases: [], exposure: "sealed_holdout", evidenceIds: ["synthetic-evidence"],
      holdoutProvenance: { custodian: "Contract test", source: "Synthetic generation", sealedAt: "2026-01-01T00:00:00.000Z",
        exclusionScope: "Synthetic fixture only", taskSetSha256: "", artifactSha256, evidenceId: "synthetic-evidence" } }], suites: [],
    evidence: [{ id: "synthetic-evidence", kind: "holdout_provenance", path: "synthetic/provenance.json", fileSha256: artifactSha256, jsonPointer: "" }],
  };
  const family = content.families[0]!;
  family.holdoutProvenance!.taskSetSha256 = harnessCorpusFamilyTaskSetSha256(content, family.id);
  content.evidence[0]!.recordSha256 = digest(harnessHoldoutDeclaration(family));
  content.evidence[0]!.artifactUtf8 = JSON.stringify(harnessHoldoutDeclaration(family));
  content.evidence[0]!.fileSha256 = family.holdoutProvenance!.artifactSha256 = sha256(content.evidence[0]!.artifactUtf8);
  const catalog = { ...content, contentSha256: digest(content) };
  const selection: HarnessCorpusSelection = { caseId: "synthetic-case", inputSha256: sha256("input"),
    taskSha256: content.tasks[0]!.taskSha256, familyId: "synthetic-family", partition: "holdout" };
  return { catalog, selection };
}

describe("Harness corpus exposure boundary", () => {
  it("retains all known task/family exposure and permits only explicitly sealed new fixture provenance", () => {
    const base = currentHarnessCorpusCatalog(), fixture = syntheticHoldout();
    expect(base.suites).toHaveLength(15); expect(base.tasks).toHaveLength(41);
    expect(base.families.every((family) => family.exposure !== "sealed_holdout")).toBe(true);
    const merged = mergeHarnessCorpusCatalogs(base, fixture.catalog);
    const binding = createHarnessCorpusBinding(merged, [fixture.selection]);
    expect(validateHarnessCorpusBinding(binding)).toEqual(binding);
    expect(harnessCorpusQualificationBlockers(undefined, [])).toEqual(["corpus_provenance_missing"]);
  });

  it("cannot omit the known corpus floor from an otherwise self-consistent new binding", () => {
    const fixture = syntheticHoldout();
    expect(() => createHarnessCorpusBinding(fixture.catalog, [fixture.selection])).toThrow("Known corpus exposure cannot");
  });

  it("rejects changing an exposed family to holdout even after every hash is recomputed", () => {
    const base = currentHarnessCorpusCatalog(), task = base.tasks[0]!, alias = task.aliases[0]!;
    expect(() => createHarnessCorpusBinding(base, [{ caseId: alias.caseId, inputSha256: alias.inputSha256,
      taskSha256: task.taskSha256, familyId: task.familyId, partition: "holdout" }])).toThrow("Exposed or unsealed");
    const fixture = syntheticHoldout(), family = base.families.find((family) => family.id === task.familyId)!;
    family.exposure = "sealed_holdout"; family.evidenceIds = [fixture.catalog.evidence[0]!.id];
    family.holdoutProvenance = fixture.catalog.families[0]!.holdoutProvenance!;
    base.evidence.push(fixture.catalog.evidence[0]!);
    expect(() => createHarnessCorpusBinding(rehash(base), [{ caseId: alias.caseId, inputSha256: alias.inputSha256,
      taskSha256: task.taskSha256, familyId: task.familyId, partition: "holdout" }])).toThrow();
  });

  it.each(["rename", "grader"])("rejects an exact exposed task hidden behind a new %s", (mode) => {
    const base = currentHarnessCorpusCatalog(), fixture = syntheticHoldout(), task = structuredClone(base.tasks[0]!);
    task.familyId = "synthetic-family";
    task.aliases = [{ ...task.aliases[0]!, ...(mode === "rename" ? { caseId: "renamed-case", path: "new/path" }
      : { inputSha256: sha256("new-input"), outcomeSha256: sha256("new-grader") }) }];
    fixture.catalog.tasks = [task];
    reseal(fixture.catalog);
    expect(() => mergeHarnessCorpusCatalogs(base, rehash(fixture.catalog))).toThrow("conflicts with known corpus");
  });

  it("rejects changed inputs reusing a known case or source path under a new sealed family", () => {
    const base = currentHarnessCorpusCatalog(), fixture = syntheticHoldout();
    fixture.catalog.tasks[0]!.aliases[0]!.caseId = base.tasks[0]!.aliases[0]!.caseId;
    fixture.catalog.tasks[0]!.aliases[0]!.path = base.tasks[0]!.aliases[0]!.path;
    fixture.selection.caseId = base.tasks[0]!.aliases[0]!.caseId;
    reseal(fixture.catalog);
    expect(() => createHarnessCorpusBinding(mergeHarnessCorpusCatalogs(base, rehash(fixture.catalog)), [fixture.selection]))
      .toThrow("Known source identity cannot acquire");
  });

  it("checks global exposure facts even if a holdout family omits them from its own evidence list", () => {
    const fixture = syntheticHoldout();
    fixture.catalog.evidence.push({ id: "omitted-source", kind: "source", path: "known/source.json",
      fileSha256: sha256("source"), jsonPointer: "", familyId: "synthetic-family" });
    expect(() => validateHarnessCorpusCatalog(rehash(fixture.catalog))).toThrow("Global exposure");
  });

  it("cannot reuse the same holdout seal after substituting task bytes", () => {
    const fixture = syntheticHoldout();
    fixture.catalog.tasks[0]!.fixtureSha256 = sha256("substituted");
    fixture.catalog.tasks[0]!.taskSha256 = harnessCorpusTaskSha256(fixture.catalog.tasks[0]!);
    expect(() => validateHarnessCorpusCatalog(rehash(fixture.catalog))).toThrow("seal task set differs");
  });

  it("requires the exact frozen declaration bytes for standalone qualification", () => {
    const fixture = syntheticHoldout(); delete fixture.catalog.evidence[0]!.artifactUtf8;
    expect(() => createHarnessCorpusBinding(mergeHarnessCorpusCatalogs(currentHarnessCorpusCatalog(), rehash(fixture.catalog)),
      [fixture.selection])).toThrow("Frozen holdout declaration artifact is required");
  });

  it.each(["./known/case", "known/../case", "known//case", "Known/case", "known/case/"])("rejects noncanonical source alias %s", (source) => {
    const fixture = syntheticHoldout(); fixture.catalog.tasks[0]!.aliases[0]!.path = source; reseal(fixture.catalog);
    expect(() => validateHarnessCorpusCatalog(rehash(fixture.catalog))).toThrow("canonical lowercase relative");
  });

  it("does not turn a historical input variant into a new holdout family", () => {
    const base = currentHarnessCorpusCatalog(), fixture = syntheticHoldout();
    const observed = base.evidence.find((item) => item.taskSha256 && item.fixtureSha256 && item.promptSha256 &&
      !base.tasks.some((task) => task.taskSha256 === item.taskSha256))!;
    expect(observed).toBeDefined();
    fixture.catalog.tasks[0] = { ...fixture.catalog.tasks[0]!, fixtureSha256: observed.fixtureSha256!,
      promptSha256: observed.promptSha256!, memorySeedSha256: observed.memorySeedSha256 ?? null, taskSha256: observed.taskSha256! };
    reseal(fixture.catalog);
    expect(() => mergeHarnessCorpusCatalogs(base, rehash(fixture.catalog))).toThrow("Historically exposed task");
  });

  it.each(["absent", "late", "artifact"])("rejects %s sealed-family provenance", (mode) => {
    const fixture = syntheticHoldout(), family = fixture.catalog.families[0]!;
    if (mode === "absent") delete family.holdoutProvenance;
    if (mode === "late") family.holdoutProvenance!.sealedAt = "2099-01-01T00:00:00.000Z";
    if (mode === "artifact") family.holdoutProvenance!.artifactSha256 = sha256("unbound");
    expect(() => createHarnessCorpusBinding(mergeHarnessCorpusCatalogs(currentHarnessCorpusCatalog(), rehash(fixture.catalog)),
      [fixture.selection], "2026-10-30T00:00:00.000Z")).toThrow();
  });

  it("binds experiment family, partition and exact source to the selected corpus receipt", () => {
    const fixture = syntheticHoldout(), binding = createHarnessCorpusBinding(mergeHarnessCorpusCatalogs(currentHarnessCorpusCatalog(), fixture.catalog), [fixture.selection]);
    expect(() => validateHarnessCorpusBinding(binding, [{ id: fixture.selection.caseId, inputSha256: fixture.selection.inputSha256,
      tags: [], taskFamily: "renamed-family", partition: "holdout" }])).toThrow("contradicts experiment");
    const changed = structuredClone(binding); changed.catalog.tasks = changed.catalog.tasks.slice(1); rehash(changed.catalog); rehash(changed);
    expect(() => validateHarnessCorpusBinding(changed)).toThrow();
    expect(() => validateHarnessCorpusCatalog({ ...fixture.catalog, contentSha256: "0".repeat(64) })).toThrow("hash changed");
  });
});

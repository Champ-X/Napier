import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { digest } from "./harness-preparation-comparison-fixture.mjs";

// Deliberately outside timed captures: real filesystem evidence and real SQLite
// indexing. This observer mutates a source immediately after the first actual
// ranking query, then allows the production preparation to finish normally.
export async function comparePreparationSemantics({ reference, runtime, directory }) {
  const modules = {
    baseline: await import(pathToFileURL(path.join(reference, "task-memory-context.js"))),
    candidate: await import(pathToFileURL(path.join(runtime, "task-memory-context.js"))),
  };
  const memory = await import(pathToFileURL(path.join(runtime, "memory.js")));
  const workspaceRoot = path.join(directory, "workspace"); await mkdir(workspaceRoot, { recursive: true });
  const filename = path.join(workspaceRoot, "shipping.ts");
  const original = "export const shippingThreshold = 5000;\n";
  const revised = "export const shippingThreshold = 8000;\n";
  const now = new Date();
  const fact = (id, file = "shipping.ts", sha256 = digest(original)) => ({
    ...memory.reviewMemoryFact(memory.createMemoryFact({ content: `${id}: shipping threshold uses integer cents`, category: "context" },
      { type: "manual", fileDependencies: [{ path: file, sha256 }] }), { action: "approve" }), id,
  });
  const facts = [fact("memory_shared_a"), fact("memory_shared_b"), fact("memory_wrong_hash", "shipping.ts", "0".repeat(64))];
  const cases = [];
  const prepare = async (arm, name, records) => modules[arm].formatTaskMemoryContext({
    facts: structuredClone(records), agentId: "semantic_agent", query: "shipping threshold integer cents", workspaceRoot,
    dataRoot: path.join(directory, arm, name), now, policy: "task-aware-v1",
  });
  const semantic = ({ index, dependencyValidation, ...rest }) => rest;
  const paired = async (name, records, expectedSelected, expectedStale) => {
    const baseline = await prepare("baseline", "persistent", records);
    const candidate = await prepare("candidate", "persistent", records);
    assert.deepEqual(semantic(candidate), semantic(baseline), `Semantic mismatch: ${name}`);
    assert.deepEqual([...candidate.factIds].sort(), [...expectedSelected].sort(), `${name}: selected facts`);
    assert.deepEqual([...candidate.staleFactIds].sort(), [...expectedStale].sort(), `${name}: stale facts`);
    cases.push({ name, equivalent: true, baseline, candidate });
  };
  await writeFile(filename, original, { flag: "wx" });
  await paired("stable_shared_path_and_conflicting_expected_hash", facts, ["memory_shared_a", "memory_shared_b"], ["memory_wrong_hash"]);
  await writeFile(filename, revised);
  await paired("edited_between_invocations", facts, [], facts.map((item) => item.id));
  await writeFile(filename, original);
  await paired("restored_between_invocations", facts, ["memory_shared_a", "memory_shared_b"], ["memory_wrong_hash"]);
  const controls = [
    { ...fact("memory_revoked"), status: "archived" },
    { ...fact("memory_expired"), reviewDueAt: "2000-01-01T00:00:00Z" },
    { ...fact("memory_foreign"), scope: "agent", agentId: "foreign_agent" },
    { ...fact("memory_unreviewed"), status: "proposed" },
  ];
  const previouslyEligible = controls.map((item) => ({ ...item, status: "active", scope: "workspace", reviewDueAt: undefined }));
  await paired("controls_before_revocation", previouslyEligible, previouslyEligible.map((item) => item.id), []);
  await paired("revoked_expired_foreign_unreviewed_after_warm_index", controls, [], []);
  await unlink(filename);
  await paired("missing_dependency", facts, [], facts.map((item) => item.id));
  await writeFile(filename, Buffer.from([0xc3, 0x28]));
  await paired("invalid_utf8_dependency", facts, [], facts.map((item) => item.id));
  await unlink(filename);
  const escaped = path.join(directory, "outside-workspace.ts"); await writeFile(escaped, original, { flag: "wx" });
  await symlink(escaped, filename);
  await paired("symlink_escape", facts, [], facts.map((item) => item.id));
  await unlink(filename);
  const drifting = [fact("memory_drift_a"), fact("memory_drift_b")];
  const duringIndex = {};
  for (const arm of ["baseline", "candidate"]) {
    await writeFile(filename, original);
    let mutations = 0, rankingQueries = 0;
    const originalPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql, ...args) {
      const statement = originalPrepare.call(this, sql, ...args);
      if (/SELECT id, bm25\(memory_search\)/u.test(sql)) {
        const originalAll = statement.all.bind(statement);
        statement.all = (...parameters) => {
          const rows = originalAll(...parameters); rankingQueries++;
          if (mutations === 0) { writeFileSync(filename, revised); mutations++; }
          return rows;
        };
      }
      return statement;
    };
    let output;
    try { output = await prepare(arm, "during-index", drifting); }
    finally { DatabaseSync.prototype.prepare = originalPrepare; }
    assert.equal(mutations, 1, "Mutation must happen inside the actual SQLite ranking query");
    const indexRoot = path.join(directory, arm, "during-index", "memory-search-v1");
    const indexFiles = (await readdir(indexRoot)).filter((entry) => entry.endsWith(".sqlite")); assert.equal(indexFiles.length, 1);
    const db = new DatabaseSync(path.join(indexRoot, indexFiles[0]));
    let indexedIds;
    try { indexedIds = db.prepare("SELECT id FROM memory_search ORDER BY id").all().map((row) => row.id); }
    finally { db.close(); }
    duringIndex[arm] = { output, mutations, rankingQueries, indexedIds };
  }
  assert.deepEqual(duringIndex.candidate.output.factIds, []);
  assert.deepEqual([...duringIndex.candidate.output.staleFactIds].sort(), drifting.map((item) => item.id).sort());
  assert.deepEqual(duringIndex.candidate.indexedIds, []);
  assert.equal(duringIndex.candidate.rankingQueries, 2);
  assert.equal(duringIndex.candidate.output.index.deleted, 2);
  assert.equal(duringIndex.candidate.output.dependencyValidation.changedPaths, 1);
  assert.equal(duringIndex.candidate.output.dependencyValidation.readCount, 2);
  assert.deepEqual([...duringIndex.baseline.output.factIds].sort(), drifting.map((item) => item.id).sort());
  cases.push({ name: "shared_dependency_changed_during_index", expectedDifference: "Pinned baseline retains the two stale facts; candidate invalidates both and resynchronizes the actual index before selection", equivalent: false, ...duringIndex });
  return { success: true, timed: false, cases, semanticExclusions: ["index", "dependencyValidation"],
    supplementalCoverage: "Production dependency and context tests cover additional permission, alias, revalidation and policy cases; this capture does not claim those as measured workloads." };
}

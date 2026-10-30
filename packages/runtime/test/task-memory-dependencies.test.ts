import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import { TaskMemoryDependencySnapshot } from "../src/task-memory-dependencies.js";
import { formatTaskMemoryContext } from "../src/task-memory-context.js";
import * as index from "../src/task-memory-index.js";
import { readWorkspaceTextEvidence } from "../src/tools.js";

const roots: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-memory-dependencies-"));
  roots.push(root);
  await writeFile(path.join(root, "shipping.ts"), "threshold=5000");
  return root;
}
function fact(content: string, dependency = "shipping.ts", digest = sha("threshold=5000")) {
  return reviewMemoryFact(createMemoryFact({ content }, {
    type: "manual", fileDependencies: [{ path: dependency, sha256: digest }],
  }), { action: "approve" });
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("invocation-scoped memory dependency observations", () => {
  it("shares exact-path digests but compares each fact's declared version and rechecks after indexing", async () => {
    const workspaceRoot = await fixture();
    const facts = [fact("Shipping uses cents"), fact("Shipping threshold is 5000"), fact("Old shipping threshold", "shipping.ts", sha("old"))];
    const result = await formatTaskMemoryContext({ facts, agentId: "a", query: "shipping", workspaceRoot });
    expect(result.factIds).toEqual(expect.arrayContaining(facts.slice(0, 2).map((item) => item.id)));
    expect(result.staleFactIds).toEqual([facts[2]!.id]);
    expect(result.dependencyValidation).toEqual({ uniquePaths: 1, readCount: 2, reusedChecks: 2, changedPaths: 0 });
  });

  it("reads fresh content again in each invocation and never retains a removed source", async () => {
    const workspaceRoot = await fixture();
    const linked = fact("Shipping threshold is 5000");
    const input = { facts: [linked], agentId: "a", query: "shipping", workspaceRoot };
    expect((await formatTaskMemoryContext(input)).factIds).toEqual([linked.id]);
    await writeFile(path.join(workspaceRoot, "shipping.ts"), "threshold=6000");
    expect((await formatTaskMemoryContext(input)).staleFactIds).toEqual([linked.id]);
    await unlink(path.join(workspaceRoot, "shipping.ts"));
    const missing = await formatTaskMemoryContext(input);
    expect(missing.factIds).toEqual([]);
    expect(missing.dependencyValidation.readCount).toBe(1);
  });

  it.each(["change", "remove", "escape"] as const)("removes all dependent facts if a source %s occurs during index preparation", async (operation) => {
    const workspaceRoot = await fixture();
    const outside = await fixture();
    const facts = [fact("Shipping uses cents"), fact("Shipping threshold is 5000")];
    const independent = reviewMemoryFact(createMemoryFact({ content: "Shipping constraints remain readable" }, { type: "manual" }), { action: "approve" });
    const search = index.searchTaskMemoryIndex;
    let calls = 0;
    vi.spyOn(index, "searchTaskMemoryIndex").mockImplementation(async (input) => {
      const result = await search(input);
      if (calls++ === 0) {
        if (operation === "change") await writeFile(path.join(workspaceRoot, "shipping.ts"), "threshold=6000");
        else {
          await unlink(path.join(workspaceRoot, "shipping.ts"));
          if (operation === "escape") await symlink(path.join(outside, "shipping.ts"), path.join(workspaceRoot, "shipping.ts"));
        }
      }
      return result;
    });
    const result = await formatTaskMemoryContext({ facts: [...facts, independent], agentId: "a", query: "shipping", workspaceRoot, dataRoot: path.join(workspaceRoot, "data") });
    expect(result.factIds).toEqual([independent.id]);
    expect(result.staleFactIds).toEqual(facts.map((item) => item.id));
    expect(result.dependencyValidation.changedPaths).toBe(1);
    expect(result.index.deleted).toBe(2);
    expect(calls).toBe(2);
  });

  it("checks eligibility before opening dependencies and preserves path boundaries and UTF-8 validation", async () => {
    const workspaceRoot = await fixture();
    const outside = await fixture();
    await symlink(path.join(outside, "shipping.ts"), path.join(workspaceRoot, "outside.ts"));
    await writeFile(path.join(workspaceRoot, "binary.ts"), Buffer.from([0xff, 0xfe]));
    const foreign = { ...fact("Shipping foreign secret"), scope: "agent" as const, agentId: "foreign" };
    const pending = createMemoryFact({ content: "Shipping unreviewed" }, { type: "manual", fileDependencies: [{ path: "shipping.ts", sha256: sha("threshold=5000") }] });
    const expired = { ...fact("Shipping expired"), reviewDueAt: "2000-01-01T00:00:00Z" };
    const excluded = await formatTaskMemoryContext({ facts: [foreign, pending, expired], agentId: "a", query: "shipping", workspaceRoot });
    expect(excluded.dependencyValidation.readCount).toBe(0);
    expect(() => fact("Shipping outside", path.join(outside, "shipping.ts"))).toThrow("Invalid memory file dependency");
    const boundary = [fact("Shipping escaped", "outside.ts"), fact("Shipping invalid text", "binary.ts")];
    const result = await formatTaskMemoryContext({ facts: boundary, agentId: "a", query: "shipping", workspaceRoot });
    expect(result.factIds).toEqual([]);
    expect(result.staleFactIds).toEqual(boundary.map((item) => item.id));
  });

  it("does not equate differently addressed dependencies or promote a failed initial observation", async () => {
    const root = await fixture();
    const snapshot = new TaskMemoryDependencySnapshot(async (filename) =>
      (await readWorkspaceTextEvidence(root, { path: filename })).fileSha256,
    );
    const missing = fact("Shipping future", "missing.ts");
    expect(await snapshot.accepts(missing)).toBe(false);
    await writeFile(path.join(root, "missing.ts"), "threshold=5000");
    expect(await snapshot.accepts(fact("Shipping alias", "./shipping.ts"))).toBe(true);
    expect(await snapshot.accepts(fact("Shipping canonical"))).toBe(true);
    await snapshot.revalidate();
    expect(snapshot.retains(missing)).toBe(false);
    expect(snapshot.receipt()).toEqual({ uniquePaths: 3, readCount: 5, reusedChecks: 0, changedPaths: 0 });
  });
});

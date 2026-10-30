import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import { formatTaskMemoryContext } from "../src/task-memory-context.js";
import * as index from "../src/task-memory-index.js";

const roots: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fact(content: string, filename: string) {
  return reviewMemoryFact(createMemoryFact({ content }, {
    type: "manual", fileDependencies: [{ path: filename, sha256: sha("version=1") }],
  }), { action: "approve" });
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it.each(["change", "remove", "escape"] as const)("rejects a uniquely referenced dependency after native FTS ranking: %s", async operation => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "napier-memory-unique-race-")); roots.push(workspaceRoot);
  const outside = await mkdtemp(path.join(tmpdir(), "napier-memory-outside-")); roots.push(outside);
  await writeFile(path.join(outside, "shipping.ts"), "version=1");
  await writeFile(path.join(workspaceRoot, "shipping.ts"), "version=1");
  const linked = fact("Shipping uses version one", "shipping.ts");
  const independent = reviewMemoryFact(createMemoryFact({ content: "Shipping independent rule" }, { type: "manual" }), { action: "approve" });
  const search = index.searchTaskMemoryIndex; let calls = 0;
  vi.spyOn(index, "searchTaskMemoryIndex").mockImplementation(async input => {
    const result = await search(input);
    if (calls++ === 0) {
      if (operation === "change") await writeFile(path.join(workspaceRoot, "shipping.ts"), "version=2");
      else {
        await unlink(path.join(workspaceRoot, "shipping.ts"));
        if (operation === "escape") await symlink(path.join(outside, "shipping.ts"), path.join(workspaceRoot, "shipping.ts"));
      }
    }
    return result;
  });
  const result = await formatTaskMemoryContext({ facts: [linked, independent], agentId: "a", query: "shipping", workspaceRoot,
    dataRoot: path.join(workspaceRoot, "data") });
  expect(result.factIds).toEqual([independent.id]);
  expect(result.staleFactIds).toEqual([linked.id]);
  expect(calls).toBe(2);
  expect(result.dependencyValidation).toMatchObject({ readCount: 2, reusedChecks: 0, changedPaths: 1 });
});

it("rejects a second dependency changed while reranking after the first invalidation", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "napier-memory-rerank-race-")); roots.push(workspaceRoot);
  for (const filename of ["shipping.ts", "billing.ts"]) await writeFile(path.join(workspaceRoot, filename), "version=1");
  const facts = [fact("Shipping first", "shipping.ts"), fact("Shipping second", "shipping.ts"),
    fact("Shipping billing first", "billing.ts"), fact("Shipping billing second", "billing.ts")];
  const independent = reviewMemoryFact(createMemoryFact({ content: "Shipping independent rule" }, { type: "manual" }), { action: "approve" });
  const search = index.searchTaskMemoryIndex; let calls = 0;
  vi.spyOn(index, "searchTaskMemoryIndex").mockImplementation(async input => {
    const result = await search(input);
    const filename = ["shipping.ts", "billing.ts"][calls++];
    if (filename) await writeFile(path.join(workspaceRoot, filename), "version=2");
    return result;
  });
  const result = await formatTaskMemoryContext({ facts: [...facts, independent], agentId: "a", query: "shipping", workspaceRoot,
    dataRoot: path.join(workspaceRoot, "data") });
  expect(result.factIds).toEqual([independent.id]);
  expect(result.staleFactIds).toEqual(facts.map(item => item.id));
  expect(calls).toBe(3);
  expect(result.dependencyValidation).toMatchObject({ readCount: 5, changedPaths: 2 });
});

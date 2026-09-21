import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { MemoryCategory } from "@napier/contracts";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import {
  formatTaskMemoryContext,
  captureMemoryFileDependencies,
} from "../src/task-memory-context.js";
import {
  prepareInvocationMemoryContext,
  invocationMemoryForContext,
} from "../src/agent-memory-context.js";
import {
  presetHarnessPolicy,
  createHarnessPolicyProfile,
} from "../src/harness-policy-profile.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const value = await mkdtemp(path.join(tmpdir(), "napier-memory-selection-"));
  roots.push(value);
  return value;
}
function fact(content: string, category: MemoryCategory = "context") {
  return reviewMemoryFact(
    createMemoryFact({ content, category }, { type: "manual" }),
    { action: "approve" },
  );
}
const policy = "task-aware-selective-v2" as const;

it("removes unmatched spare-budget filler only under the explicit new policy", async () => {
  const relevant = fact("Shipping threshold is 5000 cents.");
  const unrelated = fact("The logo uses violet stars.");
  const general = ["preference", "constraint", "identity", "behavior"].map(
    (category) =>
      fact("Durable reviewed information.", category as MemoryCategory),
  );
  const input = {
    facts: [unrelated, relevant, ...general],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
  };
  const legacy = await formatTaskMemoryContext(input);
  expect(legacy.factIds).toContain(unrelated.id);
  expect(legacy.retrievalVersion).toBe("sqlite-fts5-v1");
  const selected = await formatTaskMemoryContext({ ...input, policy });
  expect(new Set(selected.factIds)).toEqual(
    new Set([relevant.id, ...general.map((item) => item.id)]),
  );
  expect(selected.text).not.toContain("violet");
  expect(selected.truncated).toBe(false);
  expect(selected.selection).toMatchObject({
    mode: "matched_and_general",
    eligibleCount: 6,
    matchedCount: 1,
    candidateCount: 5,
    excludedCount: 1,
  });
});

it.each([
  "",
  "please use the file",
  "继续",
  "Repair delivery pricing",
  "修复运费规则",
])("preserves recall through the no-match fallback for %j", async (query) => {
  const relevant = fact("Shipping threshold is 5000 cents.");
  const input = {
    facts: [relevant],
    agentId: "a",
    query,
    workspaceRoot: await root(),
  };
  const original = await formatTaskMemoryContext(input);
  const selected = await formatTaskMemoryContext({ ...input, policy });
  expect(selected.text).toBe(original.text);
  expect(selected.factIds).toEqual([relevant.id]);
  expect(selected.selection.mode).toMatch(/^fallback_/u);
});

it("matches dependency paths while removing stale facts before both selection and fallback", async () => {
  const workspaceRoot = await root();
  await writeFile(path.join(workspaceRoot, "shipping.ts"), "threshold=5000");
  const linked = fact("The business threshold is 5000 cents.");
  linked.source.fileDependencies = await captureMemoryFileDependencies(
    "`shipping.ts`",
    workspaceRoot,
  );
  const general = fact("All money uses integer cents.", "constraint");
  const unrelated = fact("The logo uses violet stars.");
  const input = {
    facts: [linked, general, unrelated],
    agentId: "a",
    query: "shipping",
    workspaceRoot,
    policy,
  };
  expect((await formatTaskMemoryContext(input)).factIds).toEqual([
    linked.id,
    general.id,
  ]);
  await writeFile(path.join(workspaceRoot, "shipping.ts"), "threshold=7000");
  const after = await formatTaskMemoryContext(input);
  expect(after.staleFactIds).toEqual([linked.id]);
  expect(after.factIds).not.toContain(linked.id);
  expect(after.factIds).toContain(general.id);
  expect(after.selection.mode).toBe("fallback_no_match");
});

it("keeps earlier request terms for terse continuation and records selection at invocation", async () => {
  const relevant = fact("Shipping threshold is 5000 cents.");
  const unrelated = fact("The logo uses violet stars.");
  const context = {
    messages: [
      { role: "user" as const, timestamp: 1, content: "Fix shipping" },
      { role: "user" as const, timestamp: 2, content: "继续" },
    ],
  };
  const events: unknown[] = [];
  await prepareInvocationMemoryContext({
    context,
    store: {
      workspaceRoot: await root(),
      listMemories: () => [relevant, unrelated],
    },
    run: { id: "run_memory", threadId: "thread_memory", agentId: "a" },
    enabled: true,
    policy,
    record: async (event) => {
      events.push(event);
    },
  });
  expect(invocationMemoryForContext(context)).toContain("5000");
  expect(invocationMemoryForContext(context)).not.toContain("violet");
  expect(events).toMatchObject([
    {
      payload: {
        retrievalVersion: "sqlite-fts5-selective-v2",
        selection: { mode: "matched_and_general", excludedCount: 1 },
      },
    },
  ]);
});

it("binds selection to a distinct profile hash without changing existing preset compositions", () => {
  const {
    contentSha256: oldHash,
    schemaVersion: _schema,
    ...base
  } = presetHarnessPolicy("coding-node.v1");
  const next = createHarnessPolicyProfile({
    ...base,
    id: "coding-node.memory-selection.v2",
    context: { ...base.context, memory: policy },
  });
  expect(next.contentSha256).not.toBe(oldHash);
  expect(presetHarnessPolicy("coding-node.v1").context.memory).toBe(
    "task-aware-v1",
  );
  expect(presetHarnessPolicy("coding-node.v1").contentSha256).toBe(oldHash);
});

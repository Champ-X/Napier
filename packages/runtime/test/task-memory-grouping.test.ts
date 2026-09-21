import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { MemoryFact, MemorySource } from "@napier/contracts";
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
  createHarnessPolicyProfile,
  presetHarnessPolicy,
} from "../src/harness-policy-profile.js";

const policy = "task-aware-grouped-v3" as const;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function root() {
  const p = await mkdtemp(path.join(tmpdir(), "napier-memory-grouping-"));
  roots.push(p);
  return p;
}
function fact(
  content: string,
  source: MemorySource = { type: "manual" },
): MemoryFact {
  return reviewMemoryFact(createMemoryFact({ content }, source), {
    action: "approve",
  });
}
const source = {
  type: "conversation" as const,
  threadId: "thread_rules",
  messageIds: ["event_rules"],
};

it("preserves unlinked multilingual rules when only one matches the request", async () => {
  const rules = [
    fact("Shipping costs 599 cents below the free threshold."),
    fact("会员配送费用减免二百分。"),
  ];
  const result = await formatTaskMemoryContext({
    facts: rules,
    agentId: "a",
    query: "shipping for a member",
    workspaceRoot: await root(),
    policy,
  });
  expect(result.factIds).toEqual(rules.map((f) => f.id));
  expect(result.retrievalVersion).toBe("sqlite-fts5-grouped-v3");
  expect(result.selection.excludedCount).toBe(0);
});

it("uses shared source messages to recall the other rule ahead of recent unrelated facts under the same budget", async () => {
  const english = fact("Shipping costs 599 cents.", source);
  const chinese = fact("会员配送费用减免二百分。", source);
  const noise = fact("Decorate the homepage with a circular badge.");
  chinese.updatedAt = "2000-01-01T00:00:00Z";
  const input = {
    facts: [noise, english, chinese],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
    maxCharacters: 235,
  };
  const before = await formatTaskMemoryContext(input);
  expect(before.factIds).not.toContain(chinese.id);
  const after = await formatTaskMemoryContext({ ...input, policy });
  expect(after.factIds).toContain(english.id);
  expect(after.factIds).toContain(chinese.id);
  expect(after.factIds).not.toContain(noise.id);
  expect(after.text.length).toBeLessThanOrEqual(235);
  expect(after.grouping.sourceBoostedFactIds).toContain(chinese.id);
});

it("deduplicates exact category and content without losing source IDs or merging different rules", async () => {
  const first = fact("Shipping standard fee is 599 cents.");
  const duplicate = fact(first.content, source);
  const different = fact("Shipping standard fee is 699 cents.");
  const otherCategory = {
    ...fact(first.content),
    category: "decision" as const,
  };
  const result = await formatTaskMemoryContext({
    facts: [first, duplicate, different, otherCategory],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
    policy,
  });
  expect(
    result.text.match(/\[context\] Shipping standard fee is 599 cents/gu),
  ).toHaveLength(1);
  expect(result.text).toContain(
    "[decision] Shipping standard fee is 599 cents",
  );
  expect(result.text).toContain("699 cents");
  expect(new Set(result.factIds)).toEqual(
    new Set([first.id, duplicate.id, different.id, otherCategory.id]),
  );
  expect(
    result.grouping.renderedGroups.find((g) => g.factIds.includes(first.id))
      ?.factIds,
  ).toEqual([first.id, duplicate.id]);
});

it("never lets a rejected or foreign duplicate or source bridge participate in recall", async () => {
  const approved = fact("Shipping costs 599 cents.", source);
  const proposed = {
    ...fact(approved.content, source),
    status: "proposed" as const,
  };
  const foreign = {
    ...fact("秘密会员规则。", source),
    scope: "agent" as const,
    agentId: "b",
  };
  const result = await formatTaskMemoryContext({
    facts: [approved, proposed, foreign],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
    policy,
  });
  expect(result.factIds).toEqual([approved.id]);
  expect(JSON.stringify(result)).not.toContain(foreign.id);
  expect(JSON.stringify(result)).not.toContain(proposed.id);
});

it("rechecks source hashes before grouping and keeps identical current text when one duplicate becomes stale", async () => {
  const workspaceRoot = await root();
  await writeFile(path.join(workspaceRoot, "policy.json"), "{}");
  const deps = await captureMemoryFileDependencies(
    "`policy.json`",
    workspaceRoot,
  );
  const stale = fact("Shipping costs 599 cents.", {
    type: "manual",
    fileDependencies: deps,
  });
  const current = fact(stale.content);
  await writeFile(path.join(workspaceRoot, "policy.json"), '{"fee":700}');
  const result = await formatTaskMemoryContext({
    facts: [stale, current],
    agentId: "a",
    query: "shipping",
    workspaceRoot,
    policy,
  });
  expect(result.staleFactIds).toEqual([stale.id]);
  expect(result.factIds).toEqual([current.id]);
  expect(result.grouping.renderedGroups[0]?.factIds).toEqual([current.id]);
});

it("does not infer a shared source from a thread or a task title alone", async () => {
  const english = fact("Shipping costs 599 cents.", source);
  const other = fact("首页使用圆形徽章。", {
    ...source,
    messageIds: ["event_different"],
  });
  const result = await formatTaskMemoryContext({
    facts: [english, other],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
    policy,
  });
  expect(result.grouping.sourceBoostedFactIds).toEqual([]);
});

it("ranks transitive source links but keeps a same-named message in another thread independent", async () => {
  const first = fact("Shipping costs 599 cents.", source);
  const bridge = fact("会员配送费减免二百分。", {
    ...source,
    messageIds: ["event_rules", "event_limits"],
  });
  const related = fact("费用最低为零分。", {
    ...source,
    messageIds: ["event_limits"],
  });
  const independent = fact("横幅显示圆形徽章。", {
    ...source,
    threadId: "thread_design",
  });
  const result = await formatTaskMemoryContext({
    facts: [first, bridge, related, independent],
    agentId: "a",
    query: "shipping",
    workspaceRoot: await root(),
    policy,
  });
  expect(new Set(result.grouping.sourceBoostedFactIds)).toEqual(
    new Set([bridge.id, related.id]),
  );
});

it("uses a shared current file version as affinity without discarding another independently sourced rule", async () => {
  const workspaceRoot = await root();
  await writeFile(path.join(workspaceRoot, "rules.json"), "{}");
  const fileDependencies = await captureMemoryFileDependencies(
    "`rules.json`",
    workspaceRoot,
  );
  const first = fact("Shipping costs 599 cents.", {
    type: "manual",
    fileDependencies,
  });
  const second = fact("会员配送费减免二百分。", {
    type: "manual",
    fileDependencies,
  });
  const unlinked = fact("所有优惠叠加后费用最低为零分。");
  const result = await formatTaskMemoryContext({
    facts: [first, second, unlinked],
    agentId: "a",
    query: "shipping",
    workspaceRoot,
    policy,
  });
  expect(result.grouping.sourceBoostedFactIds).toEqual([second.id]);
  expect(result.factIds).toContain(unlinked.id);
});

it("records exact duplicate provenance in the actual invocation projection", async () => {
  const facts = [
    fact("Shipping costs 599 cents."),
    fact("Shipping costs 599 cents."),
  ];
  const context = {
    messages: [{ role: "user" as const, timestamp: 1, content: "shipping" }],
  };
  const events: unknown[] = [];
  await prepareInvocationMemoryContext({
    context,
    run: { id: "run_grouping", threadId: "thread_grouping", agentId: "a" },
    store: { workspaceRoot: await root(), listMemories: () => facts },
    enabled: true,
    policy,
    record: async (e) => {
      events.push(e);
    },
  });
  expect(
    invocationMemoryForContext(context)?.match(/Shipping costs/gu),
  ).toHaveLength(1);
  expect(events).toMatchObject([
    {
      payload: {
        count: 2,
        grouping: { renderedGroups: [{ factIds: facts.map((f) => f.id) }] },
      },
    },
  ]);
});

it("binds grouped retrieval to a new hash while preserving v1 and rejected v2 strategies", () => {
  const {
    contentSha256: oldHash,
    schemaVersion: _schema,
    ...base
  } = presetHarnessPolicy("coding-node.v1");
  const profile = createHarnessPolicyProfile({
    ...base,
    id: "coding-node.memory-grouping.v3",
    context: { ...base.context, memory: policy },
  });
  expect(profile.contentSha256).not.toBe(oldHash);
  expect(presetHarnessPolicy("coding-node.v1").contentSha256).toBe(oldHash);
});

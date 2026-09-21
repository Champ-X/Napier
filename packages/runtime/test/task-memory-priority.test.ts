import { expect, it } from "vitest";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import { formatGroupedTaskMemory } from "../src/task-memory-grouping.js";

const source = {
  type: "conversation" as const,
  threadId: "thread_contract",
  messageIds: ["event_contract"],
};
function fact(content: string, shared = false) {
  return reviewMemoryFact(
    createMemoryFact({ content }, shared ? source : { type: "manual" }),
    { action: "approve" },
  );
}

it("keeps direct query matches and general constraints ahead of affinity-only expansions", () => {
  const strongest = fact("Delivery threshold is 5000 cents.", true);
  const expanded = fact("配送费减免适用于会员。", true);
  const direct = fact("International delivery costs 999 cents.");
  const constraint = {
    ...fact("All money uses integer cents."),
    category: "constraint" as const,
  };
  const result = formatGroupedTaskMemory({
    facts: [strongest, expanded, direct, constraint],
    scores: new Map([
      [strongest.id, 2.00002],
      [direct.id, 2.000002],
      [constraint.id, 1],
    ]),
    agentId: "a",
    now: new Date(),
    maxCharacters: 6000,
  });
  expect(result.factIds).toEqual([
    strongest.id,
    direct.id,
    constraint.id,
    expanded.id,
  ]);
});

it("does not turn an unmatched general constraint into a query hit for its source siblings", () => {
  const constraint = {
    ...fact("All money uses integer cents.", true),
    category: "constraint" as const,
  };
  const sibling = fact("配送费减免适用于会员。", true);
  const result = formatGroupedTaskMemory({
    facts: [constraint, sibling],
    scores: new Map([[constraint.id, 1]]),
    agentId: "a",
    now: new Date(),
    maxCharacters: 6000,
  });
  expect(result.grouping.sourceBoostedFactIds).toEqual([]);
});

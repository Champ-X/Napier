import type { MemoryFact } from "@napier/contracts";
import type { ContextPolicy } from "@napier/contracts/harness-experiments";

const GENERAL = new Set(["preference", "constraint", "identity", "behavior"]);

/** Selection is not semantic relevance or authority. The caller has already
 * checked authorization and freshness. No lexical evidence means preserving
 * the ranked fallback, including for terse or cross-language requests. */
export function selectTaskMemoryCandidates(input: {
  facts: readonly MemoryFact[];
  scores: ReadonlyMap<string, number>;
  queryTermCount: number;
  policy?: ContextPolicy["memory"] | undefined;
}) {
  const matchedCount = input.facts.filter((fact) =>
    input.scores.has(fact.id),
  ).length;
  const mode =
    input.policy === "task-aware-grouped-v3"
      ? "ranked_with_source_groups"
      : input.policy !== "task-aware-selective-v2"
        ? "ranked_v1"
        : input.queryTermCount === 0
          ? "fallback_empty_query"
          : matchedCount === 0
            ? "fallback_no_match"
            : "matched_and_general";
  const facts = input.facts.filter(
    (fact) =>
      mode !== "matched_and_general" ||
      input.scores.has(fact.id) ||
      GENERAL.has(fact.category),
  );
  const scores = new Map(input.scores);
  if (input.queryTermCount > 0)
    for (const fact of facts)
      if (GENERAL.has(fact.category) && !scores.has(fact.id))
        scores.set(fact.id, 1);
  return {
    facts,
    scores,
    receipt: {
      mode,
      queryTermCount: input.queryTermCount,
      eligibleCount: input.facts.length,
      matchedCount,
      candidateCount: facts.length,
      excludedCount: input.facts.length - facts.length,
    },
  };
}

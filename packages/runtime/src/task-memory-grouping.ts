import type { MemoryFact } from "@napier/contracts";
import { formatMemoryContext } from "./memory.js";
import { sha256 } from "./ed25519.js";

/** Source affinity affects ordering only. It is neither semantic relevance nor
 * permission to include facts; callers must supply only currently eligible facts.
 * Exact text deduplication preserves all eligible fact IDs in the receipt. */
export function formatGroupedTaskMemory(input: {
  facts: readonly MemoryFact[];
  scores: ReadonlyMap<string, number>;
  agentId: string;
  maxCharacters: number;
  now: Date;
}) {
  const scores = sourceAffinityScores(input.facts, input.scores);
  const groups = new Map<
    string,
    { fact: MemoryFact; factIds: string[]; score: number }
  >();
  for (const fact of input.facts) {
    const key = JSON.stringify([fact.category, fact.content]);
    const score = scores.get(fact.id) ?? 0;
    const group = groups.get(key);
    if (group) {
      group.factIds.push(fact.id);
      group.score = Math.max(group.score, score);
      if (
        fact.confidence > group.fact.confidence ||
        (fact.confidence === group.fact.confidence &&
          fact.updatedAt > group.fact.updatedAt)
      )
        group.fact = fact;
    } else groups.set(key, { fact, factIds: [fact.id], score });
  }
  const representatives = new Map(
    [...groups.values()].map((group) => [group.fact.id, group]),
  );
  const context = formatMemoryContext(
    [...representatives.values()].map((group) => group.fact),
    input.agentId,
    input.maxCharacters,
    input.now,
    new Map([...representatives].map(([id, group]) => [id, group.score])),
  );
  const renderedGroups = context.factIds.map((id) => {
    const group = representatives.get(id)!;
    return {
      representativeId: id,
      factIds: group.factIds,
      contentSha256: sha256(
        JSON.stringify([group.fact.category, group.fact.content]),
      ),
    };
  });
  return {
    ...context,
    factIds: renderedGroups.flatMap((group) => group.factIds),
    grouping: {
      uniqueCandidateCount: representatives.size,
      duplicateCount: input.facts.length - representatives.size,
      sourceBoostedFactIds: input.facts
        .filter(
          (fact) =>
            (scores.get(fact.id) ?? 0) > (input.scores.get(fact.id) ?? 0),
        )
        .map((fact) => fact.id),
      renderedGroups,
    },
  };
}

function sourceAffinityScores(
  facts: readonly MemoryFact[],
  scores: ReadonlyMap<string, number>,
) {
  const parents = new Map(facts.map((fact) => [fact.id, fact.id]));
  const anchors = new Map<string, string>();
  for (const fact of facts)
    for (const key of sourceKeys(fact)) {
      const other = anchors.get(key);
      if (other) parents.set(rootId(parents, fact.id), rootId(parents, other));
      else anchors.set(key, fact.id);
    }
  const maxima = new Map<string, number>();
  for (const fact of facts) {
    const root = rootId(parents, fact.id);
    maxima.set(root, Math.max(maxima.get(root) ?? 0, scores.get(fact.id) ?? 0));
  }
  return new Map(
    facts.map((fact) => [
      fact.id,
      Math.max(
        scores.get(fact.id) ?? 0,
        // FTS matches score above 2 and general categories score 1. Affinity
        // only lifts zero-score facts above other fallback candidates.
        (maxima.get(rootId(parents, fact.id)) ?? 0) > 1 ? 0.5 : 0,
      ),
    ]),
  );
}

function rootId(parents: Map<string, string>, id: string): string {
  const visited: string[] = [];
  while (parents.get(id) !== id) {
    visited.push(id);
    id = parents.get(id)!;
  }
  for (const prior of visited) parents.set(prior, id);
  return id;
}

function sourceKeys(fact: MemoryFact): string[] {
  const messages = fact.source.threadId
    ? (fact.source.messageIds ?? []).map((id) =>
        JSON.stringify(["message", fact.source.threadId, id]),
      )
    : [];
  const files = (fact.source.fileDependencies ?? []).map((file) =>
    JSON.stringify(["file", file.path, file.sha256]),
  );
  return [...messages, ...files];
}

import type { MemoryFact, MemorySource } from "@napier/contracts";
import type { ContextPolicy } from "@napier/contracts/harness-experiments";
import { formatMemoryContext, isMemoryReviewDue } from "./memory.js";
import { readWorkspaceTextEvidence } from "./tools.js";
import { searchTaskMemoryIndex } from "./task-memory-index.js";
import { selectTaskMemoryCandidates } from "./task-memory-selection.js";
import { formatGroupedTaskMemory } from "./task-memory-grouping.js";

const COMMON = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "use",
  "file",
  "files",
  "please",
  "需要",
  "使用",
  "这个",
  "进行",
]);
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/** The FTS index is a disposable projection of already authorized/reviewed facts.
 * It contains no other agents' facts and never becomes memory authority.
 */
export async function formatTaskMemoryContext(input: {
  facts: readonly MemoryFact[];
  agentId: string;
  query: string;
  workspaceRoot: string;
  dataRoot?: string;
  maxCharacters?: number;
  now?: Date;
  policy?: ContextPolicy["memory"] | undefined;
}) {
  const now = input.now ?? new Date();
  const eligible = input.facts.filter(
    (fact) =>
      fact.status === "active" &&
      !isMemoryReviewDue(fact, now) &&
      (fact.scope === "workspace" || fact.agentId === input.agentId),
  );
  const staleFactIds: string[] = [];
  const facts: MemoryFact[] = [];
  for (const fact of eligible) {
    if (await dependenciesCurrent(fact, input.workspaceRoot)) facts.push(fact);
    else staleFactIds.push(fact.id);
  }
  const terms = tokenize(input.query).slice(0, 64);
  const index = await searchTaskMemoryIndex({
    documents: facts.map((fact) => ({
      id: fact.id,
      content: `${fact.content} ${
        fact.source.fileDependencies
          ?.map((dependency) => dependency.path)
          .join(" ") ?? ""
      }`,
    })),
    queryTerms: terms,
    tokenize,
    workspaceRoot: input.workspaceRoot,
    agentId: input.agentId,
    ...(input.dataRoot ? { dataRoot: input.dataRoot } : {}),
  });
  const selected = selectTaskMemoryCandidates({
    facts,
    scores: index.scores,
    queryTermCount: terms.length,
    policy: input.policy,
  });
  const grouped =
    input.policy === "task-aware-grouped-v3"
      ? formatGroupedTaskMemory({
          facts: selected.facts,
          scores: selected.scores,
          agentId: input.agentId,
          maxCharacters: input.maxCharacters ?? 6000,
          now,
        })
      : undefined;
  return {
    ...(grouped ??
      formatMemoryContext(
        selected.facts,
        input.agentId,
        input.maxCharacters ?? 6000,
        now,
        selected.scores,
      )),
    grouping: grouped?.grouping,
    staleFactIds,
    retrievalVersion:
      input.policy === "task-aware-grouped-v3"
        ? "sqlite-fts5-grouped-v3"
        : input.policy === "task-aware-selective-v2"
          ? "sqlite-fts5-selective-v2"
          : "sqlite-fts5-v1",
    selection: selected.receipt,
    index: {
      storage: index.storage,
      updated: index.updated,
      deleted: index.deleted,
      reused: index.reused,
      ...("failureSha256" in index
        ? { failureSha256: index.failureSha256 }
        : {}),
    },
  };
}

function tokenize(text: string): string[] {
  const normalized = text.replace(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
  return [
    ...new Set(
      [...segmenter.segment(normalized)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment)
        .filter((word) => word.length > 1 && !COMMON.has(word)),
    ),
  ];
}

async function dependenciesCurrent(
  fact: MemoryFact,
  root: string,
): Promise<boolean> {
  for (const expected of fact.source.fileDependencies ?? []) {
    try {
      const actual = await readWorkspaceTextEvidence(root, {
        path: expected.path,
      });
      if (actual.fileSha256 !== expected.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Bind only concrete, backtick-delimited file references that can be read
 * inside the workspace. Missing/ambiguous references grant no evidence.
 */
export async function captureMemoryFileDependencies(
  content: string,
  workspaceRoot: string,
): Promise<NonNullable<MemorySource["fileDependencies"]>> {
  const candidates = [...content.matchAll(/`([^`\n]{1,500})`/gu)]
    .map((match) => match[1]!)
    .filter(
      (value) =>
        /\.[a-z0-9]{1,12}$/iu.test(value) &&
        !/^(?:\/|[A-Za-z]:)/u.test(value) &&
        !value.split(/[\\/]/u).includes(".."),
    );
  const dependencies: NonNullable<MemorySource["fileDependencies"]> = [];
  for (const target of [...new Set(candidates)].slice(0, 16)) {
    try {
      const observed = await readWorkspaceTextEvidence(workspaceRoot, {
        path: target,
      });
      dependencies.push({ path: target, sha256: observed.fileSha256 });
    } catch {
      /* A mention is not evidence that a file exists or is readable. */
    }
  }
  return dependencies;
}

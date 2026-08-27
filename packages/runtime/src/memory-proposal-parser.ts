import type { CreateMemoryRequest, MemoryCategory } from "@napier/contracts";

const MEMORY_CATEGORIES = new Set<MemoryCategory>([
  "preference",
  "context",
  "goal",
  "constraint",
  "decision",
  "identity",
  "behavior",
  "correction",
  "other",
]);
const MEMORY_ID = /^memory_[a-z0-9]{8,80}$/;
const MIN_MEMORY_CONSOLIDATION_TARGETS = 2;
const MAX_MEMORY_CONSOLIDATION_TARGETS = 8;

interface ParsedMemoryProposal extends CreateMemoryRequest {
  sourceMessageIds?: string[];
}

export function parseMemoryProposalResponse(
  text: string,
  allowedReplacementMemoryIds: readonly string[] = [],
  allowedSourceMessageIds: readonly string[] = [],
): ParsedMemoryProposal[] {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const unfenced = withoutThinking
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Memory extractor response did not contain a JSON object");
  }
  const payload = JSON.parse(unfenced.slice(start, end + 1)) as {
    facts?: unknown;
  };
  if (!Array.isArray(payload.facts)) {
    throw new Error("Memory extractor response must contain a facts array");
  }
  const allowedTargets = new Set(allowedReplacementMemoryIds);
  const allowedMessages = new Set(allowedSourceMessageIds);
  const proposals = payload.facts
    .slice(0, 5)
    .flatMap((candidate) =>
      parseMemoryProposalCandidate(candidate, allowedTargets, allowedMessages),
    );
  assertUniqueReplacementTargets(proposals);
  return proposals;
}

function parseMemoryProposalCandidate(
  candidate: unknown,
  allowedTargets: ReadonlySet<string>,
  allowedMessages: ReadonlySet<string>,
): ParsedMemoryProposal[] {
  if (!candidate || Array.isArray(candidate) || typeof candidate !== "object")
    return [];
  const record = candidate as Record<string, unknown>;
  if (typeof record["content"] !== "string") return [];
  const content = record["content"].replace(/\s+/g, " ").trim();
  if (!content) return [];
  const category = memoryProposalCategory(record["category"]);
  const confidence = memoryProposalConfidence(record["confidence"]);
  const persistenceReason = memoryProposalText(
    record["persistenceReason"],
    "persistenceReason",
  );
  const differenceSummary = memoryProposalText(
    record["differenceSummary"],
    "differenceSummary",
  );
  const sourceMessageIds = memoryProposalSourceMessageIds(
    record["sourceMessageIds"],
    allowedMessages,
  );
  const { supersedesMemoryId, consolidatesMemoryIds } =
    memoryProposalReplacement(record, allowedTargets);
  const normalizedCategory = supersedesMemoryId
    ? "correction"
    : consolidatesMemoryIds && category === "correction"
      ? "context"
      : category;
  return [
    {
      content,
      category: normalizedCategory,
      confidence,
      scope: "workspace" as const,
      ...(persistenceReason ? { persistenceReason } : {}),
      ...(differenceSummary ? { differenceSummary } : {}),
      ...(sourceMessageIds.length > 0 ? { sourceMessageIds } : {}),
      ...(supersedesMemoryId ? { supersedesMemoryId } : {}),
      ...(consolidatesMemoryIds ? { consolidatesMemoryIds } : {}),
    },
  ];
}

function memoryProposalReplacement(
  record: Record<string, unknown>,
  allowedTargets: ReadonlySet<string>,
): Pick<CreateMemoryRequest, "supersedesMemoryId" | "consolidatesMemoryIds"> {
  const rawSupersedesMemoryId = record["supersedesMemoryId"];
  const rawConsolidatesMemoryIds = record["consolidatesMemoryIds"];
  if (
    rawSupersedesMemoryId !== undefined &&
    typeof rawSupersedesMemoryId !== "string"
  ) {
    throw new Error(
      "Memory extractor supersedesMemoryId must be a string when present",
    );
  }
  if (
    rawConsolidatesMemoryIds !== undefined &&
    !Array.isArray(rawConsolidatesMemoryIds)
  ) {
    throw new Error(
      "Memory extractor consolidatesMemoryIds must be an array when present",
    );
  }
  if (
    rawSupersedesMemoryId !== undefined &&
    rawConsolidatesMemoryIds !== undefined
  ) {
    throw new Error(
      "Memory extractor fact cannot correct and consolidate at the same time",
    );
  }
  const supersedesMemoryId = rawSupersedesMemoryId
    ? normalizeMemoryId(rawSupersedesMemoryId)
    : undefined;
  if (supersedesMemoryId && !allowedTargets.has(supersedesMemoryId)) {
    throw new Error(
      `Memory extractor referenced unavailable correction target: ${supersedesMemoryId}`,
    );
  }
  const consolidatesMemoryIds = rawConsolidatesMemoryIds
    ? normalizeMemoryConsolidationIds(
        rawConsolidatesMemoryIds.map((value) => {
          if (typeof value !== "string") {
            throw new Error(
              "Memory extractor consolidation target IDs must be strings",
            );
          }
          return value;
        }),
      )
    : undefined;
  for (const targetId of consolidatesMemoryIds ?? []) {
    if (!allowedTargets.has(targetId)) {
      throw new Error(
        `Memory extractor referenced unavailable consolidation target: ${targetId}`,
      );
    }
  }
  return {
    ...(supersedesMemoryId ? { supersedesMemoryId } : {}),
    ...(consolidatesMemoryIds ? { consolidatesMemoryIds } : {}),
  };
}

function assertUniqueReplacementTargets(
  proposals: readonly ParsedMemoryProposal[],
): void {
  const replacementTargets = new Set<string>();
  for (const proposal of proposals) {
    for (const targetId of memoryReplacementTargetIds(proposal)) {
      if (replacementTargets.has(targetId)) {
        throw new Error(
          `Memory extractor repeated replacement target: ${targetId}`,
        );
      }
      replacementTargets.add(targetId);
    }
  }
}

function memoryProposalText(
  value: unknown,
  field: "persistenceReason" | "differenceSummary",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Memory extractor ${field} must be a string`);
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 500) {
    throw new Error(`Memory extractor ${field} is invalid`);
  }
  return normalized;
}

function memoryProposalSourceMessageIds(
  value: unknown,
  allowed: ReadonlySet<string>,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error("Memory extractor sourceMessageIds must be an array");
  }
  const ids = value.map((candidate) => {
    if (typeof candidate !== "string" || !allowed.has(candidate)) {
      throw new Error(
        `Memory extractor referenced unavailable source message: ${String(candidate)}`,
      );
    }
    return candidate;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error("Memory extractor repeated a source message");
  }
  return ids;
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function memoryProposalCategory(value: unknown): MemoryCategory {
  return typeof value === "string" &&
    MEMORY_CATEGORIES.has(value as MemoryCategory)
    ? (value as MemoryCategory)
    : "other";
}

function memoryProposalConfidence(value: unknown): number {
  return typeof value === "number" ? clampConfidence(value) : 0.7;
}

export function memoryReplacementTargetIds(
  fact: Pick<
    CreateMemoryRequest,
    "supersedesMemoryId" | "consolidatesMemoryIds"
  >,
): string[] {
  if (fact.supersedesMemoryId && fact.consolidatesMemoryIds) {
    throw new Error(
      "Memory replacement cannot have correction and consolidation targets",
    );
  }
  return fact.supersedesMemoryId
    ? [normalizeMemoryId(fact.supersedesMemoryId)]
    : fact.consolidatesMemoryIds
      ? normalizeMemoryConsolidationIds(fact.consolidatesMemoryIds)
      : [];
}

export function normalizeMemoryId(value: string): string {
  const normalized = value.trim();
  if (!MEMORY_ID.test(normalized)) {
    throw new Error(`Invalid memory ID: ${value}`);
  }
  return normalized;
}

export function normalizeMemoryConsolidationIds(
  values: readonly string[],
): string[] {
  const normalized = [...new Set(values.map(normalizeMemoryId))].sort();
  if (
    normalized.length < MIN_MEMORY_CONSOLIDATION_TARGETS ||
    normalized.length > MAX_MEMORY_CONSOLIDATION_TARGETS ||
    normalized.length !== values.length
  ) {
    throw new Error(
      `Memory consolidation requires ${MIN_MEMORY_CONSOLIDATION_TARGETS}-${MAX_MEMORY_CONSOLIDATION_TARGETS} unique targets`,
    );
  }
  return normalized;
}

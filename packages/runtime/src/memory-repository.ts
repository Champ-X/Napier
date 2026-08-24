import type {
  CreateMemoryRequest,
  MemoryFact,
  MemorySource,
  ReviewMemoryRequest,
} from "@napier/contracts";

import { nowIso } from "./ids.js";
import {
  createMemoryFact,
  expireMemoryFact,
  memoryDedupeKey,
  memoryReplacementTargetIds,
  recordMemoryUse,
  reviewMemoryFact,
  supersedeMemoryFact,
} from "./memory.js";

export interface MemoryRepositoryState {
  memories: MemoryFact[];
}

export interface MemoryRepositoryMutation<T> {
  value: T;
  changed: boolean;
}

export interface MemoryRepositoryHost {
  assertReady(): void;
  read(): MemoryRepositoryState;
  mutate<T>(
    operation: (state: MemoryRepositoryState) => MemoryRepositoryMutation<T>,
  ): Promise<T>;
}

/** Owns the Memory aggregate while LocalStore remains a compatibility facade. */
export class MemoryRepository {
  constructor(private readonly host: MemoryRepositoryHost) {}

  list(options: { agentId?: string } = {}): MemoryFact[] {
    this.host.assertReady();
    const statusOrder: Record<MemoryFact["status"], number> = {
      proposed: 0,
      active: 1,
      stale: 2,
      rejected: 3,
      archived: 4,
    };
    return structuredClone(
      this.host
        .read()
        .memories.filter(
          (fact) =>
            !options.agentId ||
            fact.scope === "workspace" ||
            fact.agentId === options.agentId,
        )
        .sort((left, right) => {
          const statusDelta =
            statusOrder[left.status] - statusOrder[right.status];
          return statusDelta || right.updatedAt.localeCompare(left.updatedAt);
        }),
    );
  }

  propose(
    input: CreateMemoryRequest,
    source: MemorySource,
  ): Promise<MemoryFact> {
    this.host.assertReady();
    const fact = createMemoryFact(input, source);
    return this.host.mutate((state) => {
      const replacementTargetIds = memoryReplacementTargetIds(fact);
      if (replacementTargetIds.length > 0) {
        const targets = replacementTargetIds.map((targetId) => {
          const target = state.memories.find(
            (memory) => memory.id === targetId,
          );
          if (!target) {
            throw new Error(`Memory replacement target not found: ${targetId}`);
          }
          return target;
        });
        assertMemoryReplacementTargets(targets, fact);
        const pendingReplacement = state.memories.find(
          (memory) =>
            memory.status === "proposed" &&
            memoryReplacementTargetIds(memory).some((targetId) =>
              replacementTargetIds.includes(targetId),
            ),
        );
        if (pendingReplacement) {
          throw new Error(
            `Memory already has a pending replacement: ${pendingReplacement.id}`,
          );
        }
      }
      const key = memoryDedupeKey(fact);
      const replacementKey = memoryReplacementKey(fact);
      const existing = state.memories.find(
        (item) =>
          (item.status === "proposed" ||
            (!replacementKey && item.status === "active")) &&
          memoryReplacementKey(item) === replacementKey &&
          memoryDedupeKey(item) === key,
      );
      if (existing) return unchanged(existing);
      state.memories.push(fact);
      return changed(fact);
    });
  }

  review(memoryId: string, request: ReviewMemoryRequest): Promise<MemoryFact> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const index = state.memories.findIndex(
        (memory) => memory.id === memoryId,
      );
      const current = state.memories[index];
      if (!current) throw new Error(`Memory not found: ${memoryId}`);
      const updated = reviewMemoryFact(current, request);
      const replacementTargetIds = memoryReplacementTargetIds(current);
      if (request.action === "approve" && replacementTargetIds.length > 0) {
        const targets = replacementTargetIds.map((targetId) => {
          const targetIndex = state.memories.findIndex(
            (memory) => memory.id === targetId,
          );
          const target = state.memories[targetIndex];
          if (!target) {
            throw new Error(`Memory replacement target not found: ${targetId}`);
          }
          return { target, targetIndex };
        });
        assertMemoryReplacementTargets(
          targets.map(({ target }) => target),
          updated,
        );
        for (const { target, targetIndex } of targets) {
          state.memories[targetIndex] = supersedeMemoryFact(
            target,
            updated.id,
            updated.reviewedAt,
          );
        }
      }
      state.memories[index] = updated;
      return changed(updated);
    });
  }

  expireDue(
    options: { agentId?: string; now?: Date } = {},
  ): Promise<MemoryFact[]> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const expired: MemoryFact[] = [];
      for (let index = 0; index < state.memories.length; index += 1) {
        const current = state.memories[index]!;
        if (
          options.agentId &&
          current.scope === "agent" &&
          current.agentId !== options.agentId
        ) {
          continue;
        }
        const updated = expireMemoryFact(current, options.now);
        if (updated.revision === current.revision) continue;
        state.memories[index] = updated;
        expired.push(structuredClone(updated));
      }
      return { value: expired, changed: expired.length > 0 };
    });
  }

  recordUsage(
    memoryIds: string[],
    runId: string,
    usedAt = nowIso(),
  ): Promise<MemoryFact[]> {
    this.host.assertReady();
    const uniqueIds = [...new Set(memoryIds)];
    return this.host.mutate((state) => {
      const updatedFacts: MemoryFact[] = [];
      for (const memoryId of uniqueIds) {
        const index = state.memories.findIndex(
          (memory) => memory.id === memoryId,
        );
        const current = state.memories[index];
        if (!current) throw new Error(`Memory not found: ${memoryId}`);
        const updated = recordMemoryUse(current, runId, usedAt);
        if (updated.revision === current.revision) continue;
        state.memories[index] = updated;
        updatedFacts.push(structuredClone(updated));
      }
      return { value: updatedFacts, changed: updatedFacts.length > 0 };
    });
  }
}

function changed(fact: MemoryFact): MemoryRepositoryMutation<MemoryFact> {
  return { value: structuredClone(fact), changed: true };
}

function unchanged(fact: MemoryFact): MemoryRepositoryMutation<MemoryFact> {
  return { value: structuredClone(fact), changed: false };
}

function assertMemoryReplacementTargets(
  targets: MemoryFact[],
  replacement: MemoryFact,
): void {
  const consolidation = targets.length > 1;
  for (const target of targets) {
    if (target.status !== "active" && target.status !== "stale") {
      throw new Error(
        `Cannot ${consolidation ? "consolidate" : "correct"} memory in ${target.status} state`,
      );
    }
    if (
      target.scope !== replacement.scope ||
      target.agentId !== replacement.agentId
    ) {
      throw new Error(
        `Memory ${consolidation ? "consolidation" : "correction"} must preserve scope and Agent`,
      );
    }
    if (target.content === replacement.content) {
      throw new Error(
        consolidation
          ? "Memory consolidation must synthesize source content"
          : "Memory correction must change content",
      );
    }
    if (target.supersededByMemoryId) {
      throw new Error(
        `Memory is already superseded by ${target.supersededByMemoryId}`,
      );
    }
  }
}

function memoryReplacementKey(
  fact: Pick<MemoryFact, "supersedesMemoryId" | "consolidatesMemoryIds">,
): string {
  return memoryReplacementTargetIds(fact).join(",");
}

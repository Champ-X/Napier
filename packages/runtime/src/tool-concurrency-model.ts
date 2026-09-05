import type { ToolConcurrency } from "@napier/contracts/tool-protocol";

export type ToolConcurrencyResourceKey = string | readonly string[];

export interface ToolConcurrencyResourceRequirement {
  readonly key: ToolConcurrencyResourceKey;
  readonly mode: ToolConcurrency;
}

export interface ToolConcurrencyOperation {
  readonly operationId: string;
  readonly requirements: readonly ToolConcurrencyResourceRequirement[];
}

export interface NormalizedToolConcurrencyRequirement {
  readonly key: readonly string[];
  readonly displayKey: string;
  readonly mode: ToolConcurrency;
}

export function normalizeToolConcurrencyOperationId(
  operationId: string,
): string {
  const normalized = operationId.trim();
  if (normalized.length === 0) {
    throw new TypeError("Tool concurrency operationId must not be empty");
  }
  return normalized;
}

export function normalizeToolConcurrencyRequirements(
  requirements: readonly ToolConcurrencyResourceRequirement[],
): readonly NormalizedToolConcurrencyRequirement[] {
  if (requirements.length === 0) {
    throw new TypeError("A tool operation must require at least one resource");
  }
  const byKey = new Map<string, NormalizedToolConcurrencyRequirement>();
  for (const requirement of requirements) {
    const key = normalizeResourceKey(requirement.key);
    assertConcurrencyMode(requirement.mode);
    const identity = JSON.stringify(key);
    const current = byKey.get(identity);
    if (
      !current ||
      toolConcurrencyModeStrength(requirement.mode) >
        toolConcurrencyModeStrength(current.mode)
    ) {
      byKey.set(identity, {
        key,
        displayKey: key.length === 0 ? "<root>" : key.join("/"),
        mode: requirement.mode,
      });
    }
  }
  return [...byKey.values()];
}

export function conflictingToolConcurrencyRequirementPairs(
  left: readonly NormalizedToolConcurrencyRequirement[],
  right: readonly NormalizedToolConcurrencyRequirement[],
): Array<
  readonly [
    NormalizedToolConcurrencyRequirement,
    NormalizedToolConcurrencyRequirement,
  ]
> {
  const pairs: Array<
    readonly [
      NormalizedToolConcurrencyRequirement,
      NormalizedToolConcurrencyRequirement,
    ]
  > = [];
  for (const leftRequirement of left) {
    for (const rightRequirement of right) {
      if (
        toolConcurrencyResourcesOverlap(
          leftRequirement.key,
          rightRequirement.key,
        ) &&
        toolConcurrencyModesConflict(
          leftRequirement.mode,
          rightRequirement.mode,
        )
      ) {
        pairs.push([leftRequirement, rightRequirement]);
      }
    }
  }
  return pairs;
}

export function toolConcurrencyRequirementCovers(
  held: NormalizedToolConcurrencyRequirement,
  requested: NormalizedToolConcurrencyRequirement,
): boolean {
  return (
    isToolConcurrencyResourceAncestor(held.key, requested.key) &&
    toolConcurrencyModeStrength(held.mode) >=
      toolConcurrencyModeStrength(requested.mode)
  );
}

export function toolConcurrencyResourcesOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    isToolConcurrencyResourceAncestor(left, right) ||
    isToolConcurrencyResourceAncestor(right, left)
  );
}

export function isToolConcurrencyResourceAncestor(
  ancestor: readonly string[],
  descendant: readonly string[],
): boolean {
  if (ancestor.length > descendant.length) return false;
  return ancestor.every((part, index) => descendant[index] === part);
}

export function toolConcurrencyModesConflict(
  left: ToolConcurrency,
  right: ToolConcurrency,
): boolean {
  return (
    left === "exclusive" ||
    right === "exclusive" ||
    (left === "serialized" && right === "serialized")
  );
}

export function toolConcurrencyModeStrength(mode: ToolConcurrency): number {
  if (mode === "safe") return 0;
  if (mode === "serialized") return 1;
  return 2;
}

function normalizeResourceKey(
  key: ToolConcurrencyResourceKey,
): readonly string[] {
  if (Array.isArray(key) && key.length === 0) return [];
  const parts = typeof key === "string" ? key.split("/") : [...key];
  const normalized = parts.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new TypeError("Tool concurrency resource key must not be empty");
  }
  return normalized;
}

function assertConcurrencyMode(mode: ToolConcurrency): void {
  if (mode !== "safe" && mode !== "serialized" && mode !== "exclusive") {
    throw new TypeError(`Unsupported tool concurrency mode: ${String(mode)}`);
  }
}

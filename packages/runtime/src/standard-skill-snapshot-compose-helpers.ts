import type {
  StandardSkillLoadFailureV2,
  StandardSkillRootKind,
} from "@napier/contracts/skill-load-standard";
import { STANDARD_SKILL_ROOT_KINDS } from "@napier/contracts/skill-load-standard";

import type {
  StandardSkillCandidate,
  StandardSkillResolution,
} from "./standard-skill-snapshot-types.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function unavailable(
  code: StandardSkillLoadFailureV2["failureCode"],
  roots: StandardSkillRootKind[],
  diagnostic: string,
): StandardSkillResolution {
  return { state: "unavailable", code, roots, diagnostic };
}

export function rootKinds(
  candidates: readonly StandardSkillCandidate[],
): StandardSkillRootKind[] {
  return [...new Set(candidates.map((item) => item.root.kind))].sort(
    compareRootKinds,
  );
}

export function compareRootKinds(
  left: StandardSkillRootKind,
  right: StandardSkillRootKind,
): number {
  return (
    STANDARD_SKILL_ROOT_KINDS.indexOf(left) -
    STANDARD_SKILL_ROOT_KINDS.indexOf(right)
  );
}

export function countNames(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (validName(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && NAME.test(value);
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function check(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Operation aborted", "AbortError");
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

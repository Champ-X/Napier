import type {
  PromptVariableDefinition,
  SkillContentReview,
  ToolLoopGuardPolicy,
} from "@napier/contracts";

import { formatApiErrorMessage } from "./api-error";
import { contextCopy } from "./context-copy";

export const MAX_SKILL_CONTENT_FILE_BYTES = 128 * 1024;
export const MAX_PROMPT_PACKAGE_FILE_BYTES = 129 * 1024;
export const MAX_SKILL_PACKAGE_FILE_BYTES = 513 * 1024;

export function validPromptVariables(
  definitions: readonly PromptVariableDefinition[],
): boolean {
  if (definitions.length > 32) return false;
  const names = definitions.map((definition) => definition.name);
  if (new Set(names).size !== names.length) return false;
  const literalBytes = definitions.reduce(
    (total, definition) =>
      total +
      (definition.type === "literal"
        ? new TextEncoder().encode(
            definition.value.replace(/\r\n?/gu, "\n").trim(),
          ).length
        : 0),
    0,
  );
  return (
    literalBytes <= 16 * 1024 &&
    definitions.every((definition) =>
      validPromptVariableDefinition(definition, definitions),
    )
  );
}

export function validPromptVariableDefinition(
  definition: PromptVariableDefinition,
  definitions: readonly PromptVariableDefinition[],
): boolean {
  if (
    !validPromptVariableName(definition.name) ||
    definitions.filter((candidate) => candidate.name === definition.name)
      .length !== 1
  ) {
    return false;
  }
  if (definition.type === "literal") {
    return validPromptVariableLiteral(definition.value);
  }
  if (definition.type === "current_date") {
    return (
      definition.format === "readable-date" ||
      definition.format === "iso-date" ||
      definition.format === "local-date-time"
    );
  }
  return definition.type === "skill_catalog";
}

export function validPromptVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value);
}

export function validPromptVariableLiteral(value: string): boolean {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return (
    normalized.length > 0 &&
    !normalized.includes("\u0000") &&
    [...normalized].length <= 2_000 &&
    new TextEncoder().encode(normalized).length <= 4 * 1024
  );
}

export function parseToolLoopGuardExemptTools(
  value: string,
): ToolLoopGuardPolicy["exemptTools"] | undefined {
  if (!value.trim()) return [];
  const tools = value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (
    tools.length > 32 ||
    new Set(tools).size !== tools.length ||
    tools.some((tool) => !/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u.test(tool))
  ) {
    return undefined;
  }
  return tools.sort();
}

export function parseModelKey(value: string): {
  provider: string;
  id: string;
} {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) {
    return { provider: "napier", id: "demo" };
  }
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

export function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

export function skillContentAppliedReason(
  review: SkillContentReview,
  applied: boolean,
): string {
  if (!applied || review.action === "noop") {
    return contextCopy.skillContentNoop;
  }
  return review.action === "replace"
    ? contextCopy.skillContentReplaced
    : contextCopy.skillContentInstalled;
}

export function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}

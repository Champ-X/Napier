import type {
  PromptVariableDefinition,
  PromptVariableSnapshot,
  PromptVariableSnapshotEntry,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const PROMPT_VARIABLES_RESOLVED_EVENT = "context.prompt_variables";
export const MAX_PROMPT_VARIABLE_DEFINITIONS = 32;
export const MAX_LITERAL_PROMPT_VARIABLE_BYTES = 4 * 1024;
export const MAX_LITERAL_PROMPT_VARIABLE_CHARACTERS = 2_000;
export const MAX_LITERAL_PROMPT_VARIABLE_TOTAL_BYTES = 16 * 1024;

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;
const SHA256 = /^[a-f0-9]{64}$/u;
const VARIABLE_TYPES = new Set<PromptVariableDefinition["type"]>([
  "literal",
  "current_date",
  "skill_catalog",
]);
const DATE_FORMATS = new Set(["readable-date", "iso-date", "local-date-time"]);

export interface PromptVariableCatalog {
  kind: "napier.prompt-variable-catalog";
  schemaVersion: 1;
  definitions: PromptVariableDefinition[];
  contentSha256: string;
}

export interface ResolvedPromptVariables {
  renderedSystemPrompt: string;
  snapshot: PromptVariableSnapshot;
}

export function normalizePromptVariableDefinitions(
  definitions: readonly PromptVariableDefinition[] | undefined,
): PromptVariableDefinition[] {
  if (!definitions) return [];
  if (
    !Array.isArray(definitions) ||
    definitions.length > MAX_PROMPT_VARIABLE_DEFINITIONS
  ) {
    throw new Error(
      `Prompt variables must contain at most ${MAX_PROMPT_VARIABLE_DEFINITIONS} definitions`,
    );
  }
  let literalBytes = 0;
  const normalized = definitions.map((definition) => {
    if (!definition || typeof definition !== "object") {
      throw new Error("Prompt variable definition is invalid");
    }
    const name = normalizeName(definition.name);
    if (definition.type === "literal") {
      assertDefinitionFields(definition, ["name", "type", "value"], name);
      const value = normalizeLiteral(definition.value);
      literalBytes += Buffer.byteLength(value, "utf8");
      return { name, type: "literal" as const, value };
    }
    if (definition.type === "current_date") {
      assertDefinitionFields(definition, ["name", "type", "format"], name);
      if (!DATE_FORMATS.has(definition.format)) {
        throw new Error(`Prompt variable date format is invalid: ${name}`);
      }
      return {
        name,
        type: "current_date" as const,
        format: definition.format,
      };
    }
    if (definition.type === "skill_catalog") {
      assertDefinitionFields(definition, ["name", "type"], name);
      return { name, type: "skill_catalog" as const };
    }
    throw new Error(`Prompt variable type is invalid: ${name}`);
  });
  if (literalBytes > MAX_LITERAL_PROMPT_VARIABLE_TOTAL_BYTES) {
    throw new Error(
      `Prompt variable literal values exceed ${MAX_LITERAL_PROMPT_VARIABLE_TOTAL_BYTES} UTF-8 bytes`,
    );
  }
  const names = normalized.map((definition) => definition.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Prompt variable names must be distinct");
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

export function createPromptVariableCatalog(
  definitions: readonly PromptVariableDefinition[] | undefined,
): PromptVariableCatalog {
  const normalized = normalizePromptVariableDefinitions(definitions);
  const content = {
    kind: "napier.prompt-variable-catalog" as const,
    schemaVersion: 1 as const,
    definitions: normalized,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function resolvePromptVariables(input: {
  systemPrompt: string;
  definitions: readonly PromptVariableDefinition[] | undefined;
  skillCatalogText: string;
  resolvedAt?: Date;
}): ResolvedPromptVariables {
  if (
    typeof input.systemPrompt !== "string" ||
    !input.systemPrompt.trim() ||
    input.systemPrompt.includes("\u0000")
  ) {
    throw new Error("Prompt variable System Prompt is invalid");
  }
  const catalog = createPromptVariableCatalog(input.definitions);
  const resolvedAt = input.resolvedAt ?? new Date();
  if (!Number.isFinite(resolvedAt.getTime())) {
    throw new Error("Prompt variable resolution time is invalid");
  }
  const values = new Map(
    catalog.definitions.map((definition) => [
      definition.name,
      resolveDefinition(definition, input.skillCatalogText, resolvedAt),
    ]),
  );
  const referenceCounts = new Map<string, number>();
  const unresolvedNames: string[] = [];
  let skillCatalogInjected = false;
  const renderedSystemPrompt = input.systemPrompt.replace(
    PLACEHOLDER,
    (placeholder, name: string) => {
      const value = values.get(name);
      if (value === undefined) {
        unresolvedNames.push(name);
        return placeholder;
      }
      referenceCounts.set(name, (referenceCounts.get(name) ?? 0) + 1);
      if (
        catalog.definitions.find((definition) => definition.name === name)
          ?.type === "skill_catalog"
      ) {
        skillCatalogInjected = true;
      }
      return value;
    },
  );
  if (Buffer.byteLength(renderedSystemPrompt, "utf8") > 256 * 1024) {
    throw new Error("Rendered prompt variable System Prompt is too large");
  }
  const entries = catalog.definitions.map(
    (definition): PromptVariableSnapshotEntry => {
      const value = values.get(definition.name)!;
      return {
        name: definition.name,
        type: definition.type,
        valueBytes: Buffer.byteLength(value, "utf8"),
        valueSha256: sha256(value),
        referenceCount: referenceCounts.get(definition.name) ?? 0,
      };
    },
  );
  const unresolvedNameSetSha256 = sha256(
    canonicalJson([...new Set(unresolvedNames)].sort()),
  );
  const content = {
    kind: "napier.prompt-variable-snapshot" as const,
    schemaVersion: 1 as const,
    resolvedAt: resolvedAt.toISOString(),
    definitionCount: entries.length,
    referencedVariableCount: entries.filter((entry) => entry.referenceCount > 0)
      .length,
    referenceCount:
      entries.reduce((total, entry) => total + entry.referenceCount, 0) +
      unresolvedNames.length,
    unresolvedReferenceCount: unresolvedNames.length,
    unresolvedNameSetSha256,
    catalogSha256: catalog.contentSha256,
    renderedSystemPromptSha256: sha256(renderedSystemPrompt),
    skillCatalogInjected,
    entries,
  };
  return {
    renderedSystemPrompt,
    snapshot: {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  };
}

export function projectPromptVariableSnapshots(
  events: RunEvent[],
  runId?: string,
): PromptVariableSnapshot[] {
  return events
    .filter(
      (event) =>
        event.type === PROMPT_VARIABLES_RESOLVED_EVENT &&
        (!runId || event.runId === runId),
    )
    .sort((left, right) => left.seq - right.seq)
    .flatMap((event) => {
      const snapshot = parsePromptVariableSnapshot(event.payload);
      return snapshot ? [snapshot] : [];
    });
}

export function formatCurrentDateVariable(
  format: "readable-date" | "iso-date" | "local-date-time",
  date: Date,
): string {
  const dateText = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  if (format === "iso-date") return dateText;
  if (format === "readable-date") {
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
    }).format(date);
    return `${dateText}, ${weekday}`;
  }
  const timeText = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(
    2,
    "0",
  )}:${String(absolute % 60).padStart(2, "0")}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return `${dateText} ${timeText} ${offset} (${timeZone})`;
}

function resolveDefinition(
  definition: PromptVariableDefinition,
  skillCatalogText: string,
  date: Date,
): string {
  if (definition.type === "literal") return definition.value;
  if (definition.type === "current_date") {
    return formatCurrentDateVariable(definition.format, date);
  }
  return skillCatalogText;
}

function normalizeName(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Prompt variable name is invalid");
  }
  const normalized = value.trim();
  if (!VARIABLE_NAME.test(normalized)) {
    throw new Error(`Prompt variable name is invalid: ${value}`);
  }
  return normalized;
}

function normalizeLiteral(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Prompt variable literal value is invalid");
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (
    !normalized ||
    normalized.includes("\u0000") ||
    [...normalized].length > MAX_LITERAL_PROMPT_VARIABLE_CHARACTERS ||
    Buffer.byteLength(normalized, "utf8") > MAX_LITERAL_PROMPT_VARIABLE_BYTES
  ) {
    throw new Error("Prompt variable literal value is invalid");
  }
  return normalized;
}

function parsePromptVariableSnapshot(
  input: unknown,
): PromptVariableSnapshot | undefined {
  if (!record(input)) return undefined;
  const keys = [
    "kind",
    "schemaVersion",
    "resolvedAt",
    "definitionCount",
    "referencedVariableCount",
    "referenceCount",
    "unresolvedReferenceCount",
    "unresolvedNameSetSha256",
    "catalogSha256",
    "renderedSystemPromptSha256",
    "skillCatalogInjected",
    "entries",
    "contentSha256",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    input["kind"] !== "napier.prompt-variable-snapshot" ||
    input["schemaVersion"] !== 1 ||
    typeof input["resolvedAt"] !== "string" ||
    !canonicalIsoDate(input["resolvedAt"]) ||
    typeof input["skillCatalogInjected"] !== "boolean"
  ) {
    return undefined;
  }
  const definitionCount = nonNegativeInteger(input["definitionCount"]);
  const referencedVariableCount = nonNegativeInteger(
    input["referencedVariableCount"],
  );
  const referenceCount = nonNegativeInteger(input["referenceCount"]);
  const unresolvedReferenceCount = nonNegativeInteger(
    input["unresolvedReferenceCount"],
  );
  if (
    definitionCount === undefined ||
    definitionCount > MAX_PROMPT_VARIABLE_DEFINITIONS ||
    referencedVariableCount === undefined ||
    referenceCount === undefined ||
    unresolvedReferenceCount === undefined ||
    !Array.isArray(input["entries"]) ||
    input["entries"].length !== definitionCount
  ) {
    return undefined;
  }
  try {
    const entries = input["entries"].map(parseSnapshotEntry);
    const skillCatalogInjected = input["skillCatalogInjected"];
    if (
      new Set(entries.map((entry) => entry.name)).size !== entries.length ||
      entries.some(
        (entry, index) =>
          index > 0 && entries[index - 1]!.name.localeCompare(entry.name) >= 0,
      ) ||
      referencedVariableCount !==
        entries.filter((entry) => entry.referenceCount > 0).length ||
      referenceCount !==
        entries.reduce((total, entry) => total + entry.referenceCount, 0) +
          unresolvedReferenceCount ||
      skillCatalogInjected !==
        entries.some(
          (entry) => entry.type === "skill_catalog" && entry.referenceCount > 0,
        )
    ) {
      return undefined;
    }
    const unresolvedNameSetSha256 = input["unresolvedNameSetSha256"];
    const catalogSha256 = input["catalogSha256"];
    const renderedSystemPromptSha256 = input["renderedSystemPromptSha256"];
    const contentSha256 = input["contentSha256"];
    if (
      typeof unresolvedNameSetSha256 !== "string" ||
      !SHA256.test(unresolvedNameSetSha256) ||
      typeof catalogSha256 !== "string" ||
      !SHA256.test(catalogSha256) ||
      typeof renderedSystemPromptSha256 !== "string" ||
      !SHA256.test(renderedSystemPromptSha256) ||
      typeof contentSha256 !== "string" ||
      !SHA256.test(contentSha256)
    ) {
      return undefined;
    }
    const content = {
      kind: "napier.prompt-variable-snapshot" as const,
      schemaVersion: 1 as const,
      resolvedAt: input["resolvedAt"],
      definitionCount,
      referencedVariableCount,
      referenceCount,
      unresolvedReferenceCount,
      unresolvedNameSetSha256,
      catalogSha256,
      renderedSystemPromptSha256,
      skillCatalogInjected,
      entries,
    };
    return sha256(canonicalJson(content)) === contentSha256
      ? { ...content, contentSha256 }
      : undefined;
  } catch {
    return undefined;
  }
}

function parseSnapshotEntry(input: unknown): PromptVariableSnapshotEntry {
  if (!record(input)) {
    throw new Error("Prompt variable snapshot entry is invalid");
  }
  const keys = ["name", "type", "valueBytes", "valueSha256", "referenceCount"];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input))
  ) {
    throw new Error("Prompt variable snapshot entry fields are invalid");
  }
  const name = normalizeName(String(input["name"]));
  const type = input["type"];
  const valueBytes = nonNegativeInteger(input["valueBytes"]);
  const referenceCount = nonNegativeInteger(input["referenceCount"]);
  if (
    typeof type !== "string" ||
    !VARIABLE_TYPES.has(type as PromptVariableDefinition["type"]) ||
    valueBytes === undefined ||
    valueBytes > 256 * 1024 ||
    referenceCount === undefined ||
    referenceCount > 256 * 1024 ||
    typeof input["valueSha256"] !== "string" ||
    !SHA256.test(input["valueSha256"])
  ) {
    throw new Error("Prompt variable snapshot entry is invalid");
  }
  return {
    name,
    type: type as PromptVariableDefinition["type"],
    valueBytes,
    valueSha256: input["valueSha256"],
    referenceCount,
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function assertDefinitionFields(
  definition: PromptVariableDefinition,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(definition);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key))
  ) {
    throw new Error(`Prompt variable definition fields are invalid: ${name}`);
  }
}

function canonicalIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

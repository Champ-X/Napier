import type { JsonValue } from "@napier/contracts";

import {
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_REPLACEMENT_CHARS,
  parseLspWorkspaceEdit,
  type LspWorkspaceTextEditCandidate,
} from "./lsp-rename-workspace-edit.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS = 64;
export const MAX_LSP_CODE_ACTIONS = 16;
export const MAX_LSP_CODE_ACTION_TITLE_CHARS = 200;
export const MAX_LSP_CODE_ACTION_RESOLVE_INPUT_BYTES = 64 * 1024;
export const MAX_LSP_CODE_ACTION_RESOLVE_JSON_DEPTH = 16;
export const MAX_LSP_CODE_ACTION_RESOLVE_CONTAINER_ENTRIES = 256;

export interface LspCodeActionCandidate {
  title: string;
  kind: string;
  isPreferred: boolean;
  commandIgnored: boolean;
  resolved: boolean;
  edits: LspWorkspaceTextEditCandidate[];
}

export interface LspCodeActionResolveCandidate {
  action: Record<string, unknown>;
  title: string;
  kind: string;
  isPreferred: boolean;
  commandIgnored: boolean;
  dataSha256: string;
}

export type LspCodeActionResponseEntry =
  | {
      responseIndex: number;
      candidate: LspCodeActionCandidate;
    }
  | {
      responseIndex: number;
      resolve: LspCodeActionResolveCandidate;
    };

export interface ParsedLspCodeActionEntries {
  entries: LspCodeActionResponseEntry[];
  omittedActionCount: number;
}

export interface ParsedLspCodeActions {
  actions: LspCodeActionCandidate[];
  omittedActionCount: number;
  truncated: boolean;
}

export function parseLspCodeActionResponse(
  value: unknown,
): ParsedLspCodeActions {
  const parsed = parseLspCodeActionResponseEntries(value);
  const actionable = parsed.entries.flatMap((entry) =>
    "candidate" in entry ? [entry.candidate] : [],
  );
  let omittedActionCount =
    parsed.omittedActionCount +
    parsed.entries.filter((entry) => "resolve" in entry).length;
  const truncated = actionable.length > MAX_LSP_CODE_ACTIONS;
  const actions = actionable.slice(0, MAX_LSP_CODE_ACTIONS);
  omittedActionCount += actionable.length - actions.length;
  return { actions, omittedActionCount, truncated };
}

export function parseLspCodeActionResponseEntries(
  value: unknown,
): ParsedLspCodeActionEntries {
  if (value === null || value === undefined) {
    return { entries: [], omittedActionCount: 0 };
  }
  if (!Array.isArray(value)) {
    throw new Error("LSP code action response must be an array or null");
  }
  if (value.length > MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS) {
    throw new Error(
      `LSP code action returned more than ${MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS} actions`,
    );
  }
  const entries: LspCodeActionResponseEntry[] = [];
  let omittedActionCount = 0;
  for (const [index, raw] of value.entries()) {
    const entry = parseCodeAction(raw, index);
    if (entry) entries.push({ responseIndex: index, ...entry });
    else omittedActionCount += 1;
  }
  return { entries, omittedActionCount };
}

export function parseResolvedLspCodeActionResponse(
  value: unknown,
  original: LspCodeActionResolveCandidate,
  responseIndex: number,
): LspCodeActionCandidate | undefined {
  if (!record(value)) {
    throw new Error(
      `LSP code action resolved result ${responseIndex + 1} is malformed`,
    );
  }
  assertResolveInput(value, responseIndex);
  const parsed = parseCodeAction(value, responseIndex);
  if (!parsed || !("candidate" in parsed)) return undefined;
  if (
    value["title"] !== original.title ||
    (value["kind"] ?? "quickfix") !== original.kind ||
    (value["isPreferred"] === true) !== original.isPreferred ||
    value["data"] === undefined ||
    sha256(canonicalJson(value["data"] as JsonValue)) !== original.dataSha256
  ) {
    throw new Error(
      `LSP code action resolved result ${responseIndex + 1} changed its identity`,
    );
  }
  return {
    ...parsed.candidate,
    commandIgnored: original.commandIgnored || parsed.candidate.commandIgnored,
    resolved: true,
  };
}

function parseCodeAction(
  value: unknown,
  index: number,
):
  | { candidate: LspCodeActionCandidate }
  | { resolve: LspCodeActionResolveCandidate }
  | undefined {
  if (!record(value)) {
    throw new Error(`LSP code action result ${index + 1} is malformed`);
  }
  if (isCommand(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      "title",
      "kind",
      "diagnostics",
      "isPreferred",
      "disabled",
      "tags",
      "edit",
      "command",
      "data",
    ]) ||
    typeof value["title"] !== "string" ||
    !boundedText(value["title"], MAX_LSP_CODE_ACTION_TITLE_CHARS)
  ) {
    throw new Error(`LSP code action result ${index + 1} is malformed`);
  }
  const kind = value["kind"] ?? "quickfix";
  if (
    typeof kind !== "string" ||
    !boundedText(kind, 100) ||
    (kind !== "quickfix" && !kind.startsWith("quickfix."))
  ) {
    throw new Error(`LSP code action result ${index + 1} is not a quick fix`);
  }
  if (
    value["isPreferred"] !== undefined &&
    typeof value["isPreferred"] !== "boolean"
  ) {
    throw new Error(
      `LSP code action result ${index + 1} has invalid preference`,
    );
  }
  if (
    value["diagnostics"] !== undefined &&
    !Array.isArray(value["diagnostics"])
  ) {
    throw new Error(
      `LSP code action result ${index + 1} has invalid diagnostics`,
    );
  }
  if (
    value["tags"] !== undefined &&
    (!Array.isArray(value["tags"]) ||
      value["tags"].length > 8 ||
      value["tags"].some((tag) => tag !== 1))
  ) {
    throw new Error(`LSP code action result ${index + 1} has invalid tags`);
  }
  if (value["disabled"] !== undefined) {
    if (
      !record(value["disabled"]) ||
      !hasOnlyKeys(value["disabled"], ["reason"]) ||
      !boundedText(value["disabled"]["reason"], 500)
    ) {
      throw new Error(
        `LSP code action result ${index + 1} has invalid disabled state`,
      );
    }
    return undefined;
  }
  const commandIgnored = value["command"] !== undefined;
  if (commandIgnored && !isNestedCommand(value["command"])) {
    throw new Error(`LSP code action result ${index + 1} has invalid command`);
  }
  if (value["edit"] === undefined) {
    if (value["data"] === undefined) return undefined;
    assertResolveInput(value, index);
    return {
      resolve: {
        action: structuredClone(value),
        title: value["title"],
        kind,
        isPreferred: value["isPreferred"] === true,
        commandIgnored,
        dataSha256: sha256(canonicalJson(value["data"] as JsonValue)),
      },
    };
  }
  const edits = parseLspWorkspaceEdit(value["edit"], {
    label: `LSP code action result ${index + 1}`,
    maxFiles: MAX_LSP_RENAME_FILES,
    maxEdits: MAX_LSP_RENAME_EDITS,
    maxReplacementChars: MAX_LSP_RENAME_REPLACEMENT_CHARS,
    allowInsertions: true,
  });
  if (edits.length === 0) return undefined;
  return {
    candidate: {
      title: value["title"],
      kind,
      isPreferred: value["isPreferred"] === true,
      commandIgnored,
      resolved: false,
      edits,
    },
  };
}

function assertResolveInput(
  value: Record<string, unknown>,
  index: number,
): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(
      `LSP code action result ${index + 1} has invalid resolve data`,
    );
  }
  if (
    !jsonValue(value, 0) ||
    Buffer.byteLength(encoded, "utf8") > MAX_LSP_CODE_ACTION_RESOLVE_INPUT_BYTES
  ) {
    throw new Error(
      `LSP code action result ${index + 1} has invalid resolve data`,
    );
  }
}

function isCommand(value: unknown): boolean {
  if (!record(value)) return false;
  if (
    !hasOnlyKeys(value, ["title", "command", "arguments"]) ||
    !boundedText(value["title"], MAX_LSP_CODE_ACTION_TITLE_CHARS) ||
    !boundedText(value["command"], 200) ||
    (value["arguments"] !== undefined && !Array.isArray(value["arguments"]))
  ) {
    return false;
  }
  return true;
}

function isNestedCommand(value: unknown): boolean {
  if (
    !record(value) ||
    !hasOnlyKeys(value, ["title", "command", "arguments"]) ||
    !boundedText(value["command"], 200) ||
    (value["title"] !== undefined &&
      !boundedIgnoredText(value["title"], MAX_LSP_CODE_ACTION_TITLE_CHARS)) ||
    (value["arguments"] !== undefined && !Array.isArray(value["arguments"]))
  ) {
    return false;
  }
  return true;
}

function boundedIgnoredText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return (
    record(value) && Object.keys(value).every((key) => allowed.includes(key))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_LSP_CODE_ACTION_RESOLVE_JSON_DEPTH) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_LSP_CODE_ACTION_RESOLVE_CONTAINER_ENTRIES &&
      value.every((item) => jsonValue(item, depth + 1))
    );
  }
  if (
    !record(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).length > MAX_LSP_CODE_ACTION_RESOLVE_CONTAINER_ENTRIES
  ) {
    return false;
  }
  return Object.values(value).every((item) => jsonValue(item, depth + 1));
}

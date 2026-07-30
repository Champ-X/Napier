import {
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_REPLACEMENT_CHARS,
  parseLspWorkspaceEdit,
  type LspWorkspaceTextEditCandidate,
} from "./lsp-rename-workspace-edit.js";

export const MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS = 64;
export const MAX_LSP_CODE_ACTIONS = 16;
export const MAX_LSP_CODE_ACTION_TITLE_CHARS = 200;

export interface LspCodeActionCandidate {
  title: string;
  kind: string;
  isPreferred: boolean;
  commandIgnored: boolean;
  edits: LspWorkspaceTextEditCandidate[];
}

export interface ParsedLspCodeActions {
  actions: LspCodeActionCandidate[];
  omittedActionCount: number;
  truncated: boolean;
}

export function parseLspCodeActionResponse(
  value: unknown,
): ParsedLspCodeActions {
  if (value === null || value === undefined) {
    return { actions: [], omittedActionCount: 0, truncated: false };
  }
  if (!Array.isArray(value)) {
    throw new Error("LSP code action response must be an array or null");
  }
  if (value.length > MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS) {
    throw new Error(
      `LSP code action returned more than ${MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS} actions`,
    );
  }
  const actionable: LspCodeActionCandidate[] = [];
  let omittedActionCount = 0;
  for (const [index, raw] of value.entries()) {
    const action = parseCodeAction(raw, index);
    if (action) actionable.push(action);
    else omittedActionCount += 1;
  }
  const truncated = actionable.length > MAX_LSP_CODE_ACTIONS;
  const actions = actionable.slice(0, MAX_LSP_CODE_ACTIONS);
  omittedActionCount += actionable.length - actions.length;
  return { actions, omittedActionCount, truncated };
}

function parseCodeAction(
  value: unknown,
  index: number,
): LspCodeActionCandidate | undefined {
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
  if (value["edit"] === undefined) return undefined;
  const edits = parseLspWorkspaceEdit(value["edit"], {
    label: `LSP code action result ${index + 1}`,
    maxFiles: MAX_LSP_RENAME_FILES,
    maxEdits: MAX_LSP_RENAME_EDITS,
    maxReplacementChars: MAX_LSP_RENAME_REPLACEMENT_CHARS,
    allowInsertions: true,
  });
  if (edits.length === 0) return undefined;
  return {
    title: value["title"],
    kind,
    isPreferred: value["isPreferred"] === true,
    commandIgnored,
    edits,
  };
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

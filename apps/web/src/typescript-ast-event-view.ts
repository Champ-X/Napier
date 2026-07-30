type AstLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

type AstKind =
  | "class"
  | "interface"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "getter"
  | "setter"
  | "variable"
  | "type_alias"
  | "enum"
  | "namespace"
  | "import"
  | "import_specifier"
  | "call"
  | "parameter"
  | "arrow_function";

export interface TypescriptAstToolEventTraceView {
  typescriptAstAction?: "query" | "edit_preview";
  typescriptAstStatus?: "found" | "not_found";
  typescriptAstLanguage?: AstLanguage;
  typescriptAstComplete?: boolean;
  typescriptAstTruncated?: boolean;
  typescriptAstVisitedNodeCount?: number;
  typescriptAstMatchedNodeCount?: number;
  typescriptAstReturnedNodeCount?: number;
  typescriptAstOmittedNodeCount?: number;
  typescriptAstDisplayBytes?: number;
  typescriptAstOperation?:
    | "replace"
    | "remove"
    | "insert_before"
    | "insert_after";
  typescriptAstTargetKind?: AstKind;
  typescriptAstApplicationContextExpanded?: boolean;
  typescriptAstDurationMs?: number;
  typescriptAstVersion?: string;
  typescriptAstPathSha256?: string;
  typescriptAstFileSha256?: string;
  typescriptAstNodeSetSha256?: string;
  typescriptAstTargetNodeSha256?: string;
  typescriptAstAfterFileSha256?: string;
  typescriptAstResultSha256?: string;
}

const AST_KINDS = new Set<AstKind>([
  "class",
  "interface",
  "function",
  "method",
  "constructor",
  "property",
  "getter",
  "setter",
  "variable",
  "type_alias",
  "enum",
  "namespace",
  "import",
  "import_specifier",
  "call",
  "parameter",
  "arrow_function",
]);

export function typescriptAstEventEvidence(
  value: unknown,
): TypescriptAstToolEventTraceView | undefined {
  if (
    !record(value) ||
    value["kind"] !== "napier.typescript-ast" ||
    value["schemaVersion"] !== 1 ||
    !language(value["language"]) ||
    !version(value["typescriptVersion"]) ||
    integerInRange(value["durationMs"], 0, 60_000) === undefined ||
    !hash(value["pathSha256"]) ||
    !hash(value["fileSha256"]) ||
    !hash(value["resultSha256"])
  ) {
    return undefined;
  }
  return value["action"] === "query"
    ? queryEvidence(value)
    : value["action"] === "edit_preview"
      ? editEvidence(value)
      : undefined;
}

export function typescriptAstSummaryParts(
  view: TypescriptAstToolEventTraceView,
): string[] {
  return [
    ...(view.typescriptAstAction ? [`ast ${view.typescriptAstAction}`] : []),
    ...(view.typescriptAstStatus
      ? [`ast-status ${view.typescriptAstStatus}`]
      : []),
    ...(view.typescriptAstLanguage
      ? [`ast-language ${view.typescriptAstLanguage}`]
      : []),
    ...(view.typescriptAstOperation
      ? [`ast-operation ${view.typescriptAstOperation}`]
      : []),
    ...(view.typescriptAstTargetKind
      ? [`ast-target ${view.typescriptAstTargetKind}`]
      : []),
    ...(view.typescriptAstVisitedNodeCount !== undefined
      ? [`ast-visited ${view.typescriptAstVisitedNodeCount}`]
      : []),
    ...(view.typescriptAstMatchedNodeCount !== undefined
      ? [`ast-matches ${view.typescriptAstMatchedNodeCount}`]
      : []),
    ...(view.typescriptAstReturnedNodeCount !== undefined
      ? [`ast-returned ${view.typescriptAstReturnedNodeCount}`]
      : []),
    ...(view.typescriptAstOmittedNodeCount !== undefined
      ? [`ast-omitted ${view.typescriptAstOmittedNodeCount}`]
      : []),
    ...(view.typescriptAstDisplayBytes !== undefined
      ? [`ast-display ${view.typescriptAstDisplayBytes}`]
      : []),
    ...(view.typescriptAstComplete ? ["ast-complete"] : []),
    ...(view.typescriptAstTruncated ? ["ast-truncated"] : []),
    ...(view.typescriptAstApplicationContextExpanded
      ? ["ast-context-expanded"]
      : []),
    ...(view.typescriptAstDurationMs !== undefined
      ? [`ast-ms ${view.typescriptAstDurationMs}`]
      : []),
    ...(view.typescriptAstVersion
      ? [`typescript ${view.typescriptAstVersion}`]
      : []),
    ...hashSummary("ast-path", view.typescriptAstPathSha256),
    ...hashSummary("ast-file", view.typescriptAstFileSha256),
    ...hashSummary("ast-nodes", view.typescriptAstNodeSetSha256),
    ...hashSummary("ast-target-node", view.typescriptAstTargetNodeSha256),
    ...hashSummary("ast-after-file", view.typescriptAstAfterFileSha256),
    ...hashSummary("ast-result", view.typescriptAstResultSha256),
  ];
}

function queryEvidence(
  value: Record<string, unknown>,
): TypescriptAstToolEventTraceView | undefined {
  const status = value["status"];
  const visitedNodeCount = integerInRange(
    value["visitedNodeCount"],
    0,
    100_000,
  );
  const matchedNodeCount = integerInRange(
    value["matchedNodeCount"],
    0,
    100_000,
  );
  const returnedNodeCount = integerInRange(value["returnedNodeCount"], 0, 64);
  const omittedNodeCount = integerInRange(
    value["omittedNodeCount"],
    0,
    100_000,
  );
  const displayBytes = integerInRange(value["displayBytes"], 0, 48 * 1024);
  if (
    (status !== "found" && status !== "not_found") ||
    typeof value["complete"] !== "boolean" ||
    typeof value["truncated"] !== "boolean" ||
    visitedNodeCount === undefined ||
    matchedNodeCount === undefined ||
    returnedNodeCount === undefined ||
    omittedNodeCount === undefined ||
    displayBytes === undefined ||
    returnedNodeCount + omittedNodeCount !== matchedNodeCount ||
    (status === "found" ? returnedNodeCount < 1 : returnedNodeCount !== 0) ||
    !hash(value["nodeSetSha256"])
  ) {
    return undefined;
  }
  return {
    typescriptAstAction: "query",
    typescriptAstStatus: status,
    typescriptAstLanguage: value["language"] as AstLanguage,
    typescriptAstComplete: value["complete"],
    typescriptAstTruncated: value["truncated"],
    typescriptAstVisitedNodeCount: visitedNodeCount,
    typescriptAstMatchedNodeCount: matchedNodeCount,
    typescriptAstReturnedNodeCount: returnedNodeCount,
    typescriptAstOmittedNodeCount: omittedNodeCount,
    typescriptAstDisplayBytes: displayBytes,
    typescriptAstDurationMs: Number(value["durationMs"]),
    typescriptAstVersion: value["typescriptVersion"] as string,
    typescriptAstPathSha256: value["pathSha256"] as string,
    typescriptAstFileSha256: value["fileSha256"] as string,
    typescriptAstNodeSetSha256: value["nodeSetSha256"] as string,
    typescriptAstResultSha256: value["resultSha256"] as string,
  };
}

function editEvidence(
  value: Record<string, unknown>,
): TypescriptAstToolEventTraceView | undefined {
  const operation = value["operation"];
  const targetKind = value["targetKind"];
  if (
    (operation !== "replace" &&
      operation !== "remove" &&
      operation !== "insert_before" &&
      operation !== "insert_after") ||
    typeof targetKind !== "string" ||
    !AST_KINDS.has(targetKind as AstKind) ||
    typeof value["applicationContextExpanded"] !== "boolean" ||
    !hash(value["targetNodeSha256"]) ||
    !hash(value["afterFileSha256"])
  ) {
    return undefined;
  }
  return {
    typescriptAstAction: "edit_preview",
    typescriptAstLanguage: value["language"] as AstLanguage,
    typescriptAstOperation: operation,
    typescriptAstTargetKind: targetKind as AstKind,
    typescriptAstApplicationContextExpanded:
      value["applicationContextExpanded"],
    typescriptAstDurationMs: Number(value["durationMs"]),
    typescriptAstVersion: value["typescriptVersion"] as string,
    typescriptAstPathSha256: value["pathSha256"] as string,
    typescriptAstFileSha256: value["fileSha256"] as string,
    typescriptAstTargetNodeSha256: value["targetNodeSha256"] as string,
    typescriptAstAfterFileSha256: value["afterFileSha256"] as string,
    typescriptAstResultSha256: value["resultSha256"] as string,
  };
}

function language(value: unknown): value is AstLanguage {
  return (
    value === "typescript" ||
    value === "typescriptreact" ||
    value === "javascript" ||
    value === "javascriptreact"
  );
}

function version(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/u.test(value);
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

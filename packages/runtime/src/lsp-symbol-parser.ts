import { parseLspRange, type LspRange } from "./lsp-locations.js";
import {
  canonicalLspSymbols,
  createLspSymbolSource,
  lspSymbolDisplayBytes,
  materializeLspSymbol,
  MAX_LSP_SYMBOL_CONTAINER_CHARS,
  MAX_LSP_SYMBOL_DEPTH,
  MAX_LSP_SYMBOL_DETAIL_CHARS,
  MAX_LSP_SYMBOL_DISPLAY_BYTES,
  MAX_LSP_SYMBOL_NAME_CHARS,
  MAX_LSP_SYMBOL_RANGE_CHARS,
  MAX_LSP_SYMBOL_RESPONSE_NODES,
  MAX_LSP_SYMBOLS,
  type LspDocumentSymbol,
  type LspSymbolCore,
  type LspSymbolResponseShape,
  type ParsedLspSymbols,
} from "./lsp-symbol-model.js";

export * from "./lsp-symbol-model.js";

interface PendingHierarchicalSymbol {
  value: unknown;
  depth: number;
  parentName?: string;
  parentRange?: LspRange;
}

interface ParsedSymbolCandidate {
  core: LspSymbolCore;
  depth: number;
  containerName?: string;
}

export function parseLspDocumentSymbols(
  value: unknown,
  options: {
    source: string;
    targetUri: string;
    maxSymbols: number;
  },
): ParsedLspSymbols {
  validateLspMaxSymbols(options.maxSymbols);
  if (value === null || value === undefined) {
    return emptyResult();
  }
  if (!Array.isArray(value)) {
    throw new Error("LSP symbols response must be an array or null");
  }
  if (value.length === 0) return emptyResult();
  const shape = responseShape(value[0]);
  const candidates =
    shape === "hierarchical"
      ? parseHierarchicalSymbols(value)
      : parseFlatSymbols(value, options.targetUri);
  const source = createLspSymbolSource(options.source);
  let aggregateRangeChars = 0;
  for (const candidate of candidates) {
    const rangeChars = source.rangeChars(candidate.core.range);
    const selectionChars = source.rangeChars(candidate.core.selectionRange);
    if (rangeChars === undefined || selectionChars === undefined) {
      throw new Error("LSP symbol range is outside the source file");
    }
    aggregateRangeChars += rangeChars + selectionChars;
    if (aggregateRangeChars > MAX_LSP_SYMBOL_RANGE_CHARS) {
      throw new Error(
        `LSP symbols exceed ${MAX_LSP_SYMBOL_RANGE_CHARS} aggregate source-range characters`,
      );
    }
  }
  const symbols = candidates.map((candidate) =>
    materializeLspSymbol(
      source,
      candidate.core,
      candidate.depth,
      candidate.containerName,
    ),
  );
  const canonical = canonicalLspSymbols(symbols);
  const selected: LspDocumentSymbol[] = [];
  let displayBytes = 0;
  for (const symbol of canonical) {
    if (selected.length >= options.maxSymbols) break;
    const nextDisplayBytes = displayBytes + lspSymbolDisplayBytes(symbol);
    if (nextDisplayBytes > MAX_LSP_SYMBOL_DISPLAY_BYTES) break;
    selected.push(symbol);
    displayBytes = nextDisplayBytes;
  }
  const kindCountMap = new Map<string, number>();
  for (const symbol of selected) {
    kindCountMap.set(
      symbol.kindLabel,
      (kindCountMap.get(symbol.kindLabel) ?? 0) + 1,
    );
  }
  const kindCounts = Object.fromEntries(
    [...kindCountMap].sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    responseShape: shape,
    responseSymbolCount: symbols.length,
    symbols: selected,
    omittedSymbolCount: canonical.length - selected.length,
    truncated: canonical.length > selected.length,
    displayBytes,
    maxDepth: selected.reduce(
      (maximum, symbol) => Math.max(maximum, symbol.depth),
      0,
    ),
    deprecatedSymbolCount: selected.filter((symbol) => symbol.deprecated)
      .length,
    kindCounts,
  };
}

export function validateLspMaxSymbols(maxSymbols: number): void {
  if (!Number.isSafeInteger(maxSymbols) || maxSymbols < 1) {
    throw new Error("LSP symbols maxSymbols must be a positive integer");
  }
  if (maxSymbols > MAX_LSP_SYMBOLS) {
    throw new Error(`LSP symbols maxSymbols cannot exceed ${MAX_LSP_SYMBOLS}`);
  }
}

function parseHierarchicalSymbols(values: unknown[]): ParsedSymbolCandidate[] {
  const symbols: ParsedSymbolCandidate[] = [];
  const stack: PendingHierarchicalSymbol[] = values
    .map((value) => ({ value, depth: 0 }))
    .reverse();
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    visited += 1;
    if (visited > MAX_LSP_SYMBOL_RESPONSE_NODES) {
      throw new Error(
        `LSP symbols response exceeds ${MAX_LSP_SYMBOL_RESPONSE_NODES} nodes`,
      );
    }
    if (current.depth > MAX_LSP_SYMBOL_DEPTH) {
      throw new Error(
        `LSP symbols response exceeds depth ${MAX_LSP_SYMBOL_DEPTH}`,
      );
    }
    const { core, children } = parseHierarchicalNode(
      current.value,
      current.parentRange,
    );
    symbols.push({
      core,
      depth: current.depth,
      ...(current.parentName ? { containerName: current.parentName } : {}),
    });
    for (const child of children.slice().reverse()) {
      stack.push({
        value: child,
        depth: current.depth + 1,
        parentName: core.name,
        parentRange: core.range,
      });
    }
  }
  return symbols;
}

function parseHierarchicalNode(
  value: unknown,
  parentRange: LspRange | undefined,
): { core: LspSymbolCore; children: unknown[] } {
  if (
    !record(value) ||
    !hasOnlyKeys(value, [
      "name",
      "detail",
      "kind",
      "tags",
      "deprecated",
      "range",
      "selectionRange",
      "children",
    ])
  ) {
    throw new Error("LSP hierarchical symbol is malformed");
  }
  const range = parseLspRange(value["range"]);
  const selectionRange = parseLspRange(value["selectionRange"]);
  if (!range || !selectionRange || !rangeContainsRange(range, selectionRange)) {
    throw new Error("LSP hierarchical symbol ranges are malformed");
  }
  if (parentRange && !rangeContainsRange(parentRange, range)) {
    throw new Error("LSP hierarchical child escapes its parent range");
  }
  const children = value["children"] ?? [];
  if (!Array.isArray(children)) {
    throw new Error("LSP hierarchical symbol children are malformed");
  }
  return {
    core: parseCore(value, range, selectionRange),
    children,
  };
}

function parseFlatSymbols(
  values: unknown[],
  targetUri: string,
): ParsedSymbolCandidate[] {
  if (values.length > MAX_LSP_SYMBOL_RESPONSE_NODES) {
    throw new Error(
      `LSP symbols response exceeds ${MAX_LSP_SYMBOL_RESPONSE_NODES} nodes`,
    );
  }
  return values.map((value) => {
    if (
      !record(value) ||
      !hasOnlyKeys(value, [
        "name",
        "kind",
        "tags",
        "deprecated",
        "location",
        "containerName",
      ]) ||
      !record(value["location"]) ||
      !hasOnlyKeys(value["location"], ["uri", "range"]) ||
      value["location"]["uri"] !== targetUri
    ) {
      throw new Error("LSP flat symbol is malformed or targets another file");
    }
    const range = parseLspRange(value["location"]["range"]);
    if (!range) throw new Error("LSP flat symbol range is malformed");
    const containerName = optionalText(
      value["containerName"],
      MAX_LSP_SYMBOL_CONTAINER_CHARS,
      "containerName",
    );
    return {
      core: parseCore(value, range, range),
      depth: 0,
      ...(containerName ? { containerName } : {}),
    };
  });
}

function parseCore(
  value: Record<string, unknown>,
  range: LspRange,
  selectionRange: LspRange,
): LspSymbolCore {
  const name = requiredText(value["name"], MAX_LSP_SYMBOL_NAME_CHARS, "name");
  const kind = value["kind"];
  if (!Number.isSafeInteger(kind) || Number(kind) < 1 || Number(kind) > 26) {
    throw new Error("LSP symbol kind is malformed");
  }
  const tags = value["tags"];
  if (
    tags !== undefined &&
    (!Array.isArray(tags) || tags.length > 8 || tags.some((tag) => tag !== 1))
  ) {
    throw new Error("LSP symbol tags are malformed");
  }
  if (
    value["deprecated"] !== undefined &&
    typeof value["deprecated"] !== "boolean"
  ) {
    throw new Error("LSP symbol deprecated flag is malformed");
  }
  const detail = optionalText(
    value["detail"],
    MAX_LSP_SYMBOL_DETAIL_CHARS,
    "detail",
  );
  return {
    name,
    kind: Number(kind),
    ...(detail ? { detail } : {}),
    deprecated:
      value["deprecated"] === true || (Array.isArray(tags) && tags.includes(1)),
    range,
    selectionRange,
  };
}

function responseShape(
  value: unknown,
): Exclude<LspSymbolResponseShape, "empty"> {
  if (!record(value)) throw new Error("LSP symbol is malformed");
  return record(value["location"]) ? "flat" : "hierarchical";
}

function emptyResult(): ParsedLspSymbols {
  return {
    responseShape: "empty",
    responseSymbolCount: 0,
    symbols: [],
    omittedSymbolCount: 0,
    truncated: false,
    displayBytes: 0,
    maxDepth: 0,
    deprecatedSymbolCount: 0,
    kindCounts: {},
  };
}

function rangeContainsRange(outer: LspRange, inner: LspRange): boolean {
  return (
    comparePosition(outer.start, inner.start) <= 0 &&
    comparePosition(inner.end, outer.end) <= 0
  );
}

function comparePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}

function requiredText(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`LSP symbol ${label} is malformed`);
  }
  return value;
}

function optionalText(
  value: unknown,
  maximum: number,
  label: string,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  return requiredText(value, maximum, label);
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return (
    record(value) && Object.keys(value).every((key) => allowed.includes(key))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

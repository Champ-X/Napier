import { canonicalJson, sha256 } from "./ed25519.js";
import type { LspRange } from "./lsp-locations.js";

export const MAX_LSP_SYMBOL_RESPONSE_NODES = 1_024;
export const MAX_LSP_SYMBOLS = 256;
export const DEFAULT_LSP_SYMBOLS = 80;
export const MAX_LSP_SYMBOL_DEPTH = 32;
export const MAX_LSP_SYMBOL_NAME_CHARS = 200;
export const MAX_LSP_SYMBOL_DETAIL_CHARS = 300;
export const MAX_LSP_SYMBOL_CONTAINER_CHARS = 300;
export const MAX_LSP_SYMBOL_SIGNATURE_CHARS = 240;
export const MAX_LSP_SYMBOL_DISPLAY_BYTES = 48 * 1024;
export const MAX_LSP_SYMBOL_RANGE_CHARS = 16 * 1024 * 1024;

const LSP_SYMBOL_DISPLAY_OVERHEAD_BYTES = 420;

export type LspSymbolResponseShape = "empty" | "hierarchical" | "flat";

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  kindLabel: string;
  detail?: string;
  containerName?: string;
  depth: number;
  deprecated: boolean;
  range: LspRange;
  selectionRange: LspRange;
  rangeSha256: string;
  selectionRangeSha256: string;
  signaturePreview: string;
  signatureSha256: string;
  symbolSha256: string;
}

export interface ParsedLspSymbols {
  responseShape: LspSymbolResponseShape;
  responseSymbolCount: number;
  symbols: LspDocumentSymbol[];
  omittedSymbolCount: number;
  truncated: boolean;
  displayBytes: number;
  maxDepth: number;
  deprecatedSymbolCount: number;
  kindCounts: Record<string, number>;
}

export interface LspSymbolCore {
  name: string;
  kind: number;
  detail?: string;
  deprecated: boolean;
  range: LspRange;
  selectionRange: LspRange;
}

export interface LspSymbolSource {
  rangeChars(range: LspRange): number | undefined;
  rangeText(range: LspRange): string | undefined;
}

export function createLspSymbolSource(source: string): LspSymbolSource {
  const lines = source.split("\n");
  const validLines = (
    range: LspRange,
  ): { startLine: string; endLine: string } | undefined => {
    const startLine = lines[range.start.line];
    const endLine = lines[range.end.line];
    if (
      startLine === undefined ||
      endLine === undefined ||
      range.start.character > lspLineLength(startLine) ||
      range.end.character > lspLineLength(endLine)
    ) {
      return undefined;
    }
    return { startLine, endLine };
  };
  return {
    rangeChars(range) {
      const selected = validLines(range);
      if (!selected) return undefined;
      if (range.start.line === range.end.line) {
        return range.end.character - range.start.character;
      }
      let chars =
        selected.startLine.length -
        range.start.character +
        range.end.character +
        (range.end.line - range.start.line);
      for (let line = range.start.line + 1; line < range.end.line; line += 1) {
        chars += lines[line]?.length ?? 0;
      }
      return chars;
    },
    rangeText(range) {
      const selected = validLines(range);
      if (!selected) return undefined;
      return range.start.line === range.end.line
        ? selected.startLine.slice(range.start.character, range.end.character)
        : [
            selected.startLine.slice(range.start.character),
            ...lines.slice(range.start.line + 1, range.end.line),
            selected.endLine.slice(0, range.end.character),
          ].join("\n");
    },
  };
}

export function materializeLspSymbol(
  source: LspSymbolSource,
  core: LspSymbolCore,
  depth: number,
  containerName: string | undefined,
): LspDocumentSymbol {
  const rangeText = source.rangeText(core.range);
  const selectionText = source.rangeText(core.selectionRange);
  if (rangeText === undefined || selectionText === undefined) {
    throw new Error("LSP symbol range is outside the source file");
  }
  const signaturePreview = (
    rangeText.split(/\r?\n/u)[0]?.trim() ||
    selectionText.trim() ||
    core.name
  ).slice(0, MAX_LSP_SYMBOL_SIGNATURE_CHARS);
  const receipt = {
    nameSha256: sha256(core.name),
    kind: core.kind,
    detailSha256: core.detail ? sha256(core.detail) : null,
    containerNameSha256: containerName ? sha256(containerName) : null,
    depth,
    deprecated: core.deprecated,
    range: core.range,
    selectionRange: core.selectionRange,
    rangeTextSha256: sha256(rangeText),
    selectionTextSha256: sha256(selectionText),
    signatureSha256: sha256(signaturePreview),
  };
  return {
    name: core.name,
    kind: core.kind,
    kindLabel: lspSymbolKindLabel(core.kind),
    ...(core.detail ? { detail: core.detail } : {}),
    ...(containerName ? { containerName } : {}),
    depth,
    deprecated: core.deprecated,
    range: core.range,
    selectionRange: core.selectionRange,
    rangeSha256: sha256(rangeText),
    selectionRangeSha256: sha256(selectionText),
    signaturePreview,
    signatureSha256: sha256(signaturePreview),
    symbolSha256: sha256(canonicalJson(receipt)),
  };
}

export function canonicalLspSymbols(
  symbols: LspDocumentSymbol[],
): LspDocumentSymbol[] {
  const sorted = symbols.slice().sort((left, right) => {
    const start = comparePosition(left.range.start, right.range.start);
    if (start !== 0) return start;
    const end = comparePosition(right.range.end, left.range.end);
    if (end !== 0) return end;
    return left.symbolSha256.localeCompare(right.symbolSha256);
  });
  const distinct = new Map<string, LspDocumentSymbol>();
  for (const symbol of sorted) {
    if (!distinct.has(symbol.symbolSha256)) {
      distinct.set(symbol.symbolSha256, symbol);
    }
  }
  return [...distinct.values()];
}

export function lspSymbolDisplayBytes(symbol: LspDocumentSymbol): number {
  return (
    LSP_SYMBOL_DISPLAY_OVERHEAD_BYTES +
    Buffer.byteLength(JSON.stringify(symbol.name), "utf8") +
    (symbol.detail
      ? Buffer.byteLength(JSON.stringify(symbol.detail), "utf8")
      : 0) +
    (symbol.containerName
      ? Buffer.byteLength(JSON.stringify(symbol.containerName), "utf8")
      : 0) +
    Buffer.byteLength(JSON.stringify(symbol.signaturePreview), "utf8") +
    symbol.depth * 2
  );
}

export function lspDocumentSymbolReceipt(symbol: LspDocumentSymbol): unknown {
  return {
    symbolSha256: symbol.symbolSha256,
    nameSha256: sha256(symbol.name),
    kind: symbol.kind,
    detailSha256: symbol.detail ? sha256(symbol.detail) : null,
    containerNameSha256: symbol.containerName
      ? sha256(symbol.containerName)
      : null,
    depth: symbol.depth,
    deprecated: symbol.deprecated,
    rangeSha256: symbol.rangeSha256,
    selectionRangeSha256: symbol.selectionRangeSha256,
    signatureSha256: symbol.signatureSha256,
  };
}

export function lspSymbolKindLabel(kind: number): string {
  return (
    [
      "file",
      "module",
      "namespace",
      "package",
      "class",
      "method",
      "property",
      "field",
      "constructor",
      "enum",
      "interface",
      "function",
      "variable",
      "constant",
      "string",
      "number",
      "boolean",
      "array",
      "object",
      "key",
      "null",
      "enum_member",
      "struct",
      "event",
      "operator",
      "type_parameter",
    ][kind - 1] ?? "unknown"
  );
}

function comparePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}

function lspLineLength(line: string): number {
  return line.endsWith("\r") ? line.length - 1 : line.length;
}

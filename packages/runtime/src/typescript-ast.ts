import { canonicalJson, sha256 } from "./ed25519.js";
import {
  type TypescriptAstEditOperation,
  type TypescriptAstEditPreviewRequest,
  type TypescriptAstEditPreviewResult,
  type TypescriptAstQueryRequest,
  type TypescriptAstQueryResult,
} from "./typescript-ast-contracts.js";
import {
  findTypescriptAstNode,
  MAX_TYPESCRIPT_AST_SIGNATURE_CHARS,
  queryTypescriptAst,
  typescriptAstNodeReceipt,
  typescriptAstParseDiagnosticCount,
  type TypescriptAstNode,
  type TypescriptAstSelector,
} from "./typescript-ast-model.js";
import {
  assertTypescriptAstSourceCurrent,
  loadTypescriptAstSource,
  MAX_TYPESCRIPT_AST_FILE_BYTES,
} from "./typescript-ast-source.js";
export type {
  TypescriptAstEditOperation,
  TypescriptAstEditPreviewDetails,
  TypescriptAstEditPreviewRequest,
  TypescriptAstEditPreviewResult,
  TypescriptAstQueryDetails,
  TypescriptAstQueryRequest,
  TypescriptAstQueryResult,
} from "./typescript-ast-contracts.js";

export const DEFAULT_TYPESCRIPT_AST_QUERY_RESULTS = 24;
export const MAX_TYPESCRIPT_AST_QUERY_RESULTS = 64;
export const MAX_TYPESCRIPT_AST_REPLACEMENT_BYTES = 32 * 1024;
export const MAX_TYPESCRIPT_AST_APPLICATION_BYTES = 48 * 1024;
export const MAX_TYPESCRIPT_AST_QUERY_DISPLAY_BYTES = 48 * 1024;

export class TypescriptAstRunner {
  constructor(private readonly workspaceRoot: string) {}

  async query(
    request: TypescriptAstQueryRequest,
  ): Promise<TypescriptAstQueryResult> {
    const startedAt = Date.now();
    request.signal?.throwIfAborted();
    const ts = await loadTypescript();
    const maxResults =
      request.maxResults ?? DEFAULT_TYPESCRIPT_AST_QUERY_RESULTS;
    validateMaxResults(maxResults);
    validateSelector(request.selector);
    const source = await loadTypescriptAstSource(
      ts,
      this.workspaceRoot,
      request.path,
      "ast_query",
    );
    request.signal?.throwIfAborted();
    const sourceFile = createCleanSourceFile(ts, source);
    const materialized = queryTypescriptAst(
      ts,
      sourceFile,
      source.fileSha256,
      request.selector,
      maxResults,
    );
    const displayBytes = Buffer.byteLength(
      JSON.stringify(
        materialized.nodes.map((node) => ({
          kind: node.kind,
          name: node.name,
          depth: node.depth,
          startLine: node.startLine,
          startCharacter: node.startCharacter,
          endLine: node.endLine,
          endCharacter: node.endCharacter,
          nodeSha256: node.nodeSha256,
          signaturePreview: node.signaturePreview,
        })),
      ),
      "utf8",
    );
    if (displayBytes > MAX_TYPESCRIPT_AST_QUERY_DISPLAY_BYTES) {
      throw new Error("TypeScript AST query output exceeded its display limit");
    }
    request.signal?.throwIfAborted();
    await assertTypescriptAstSourceCurrent(source, "ast_query");
    const base = {
      kind: "napier.typescript-ast" as const,
      schemaVersion: 1 as const,
      action: "query" as const,
      status:
        materialized.nodes.length > 0
          ? ("found" as const)
          : ("not_found" as const),
      complete:
        materialized.traversalComplete && materialized.omittedNodeCount === 0,
      truncated:
        !materialized.traversalComplete || materialized.omittedNodeCount > 0,
      language: source.language,
      pathSha256: source.pathSha256,
      fileSha256: source.fileSha256,
      fileBytes: source.fileBytes,
      parseDiagnosticCount: 0,
      visitedNodeCount: materialized.visitedNodeCount,
      matchedNodeCount: materialized.matchedNodeCount,
      returnedNodeCount: materialized.nodes.length,
      omittedNodeCount: materialized.omittedNodeCount,
      rangeChars: materialized.rangeChars,
      displayBytes,
      nodeSetSha256: materialized.nodeSetSha256,
      kindCountsSha256: materialized.kindCountsSha256,
      typescriptVersion: ts.version,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
    return {
      details: {
        ...base,
        resultSha256: sha256(canonicalJson(base)),
      },
      path: source.path,
      nodes: materialized.nodes,
    };
  }

  async previewEdit(
    request: TypescriptAstEditPreviewRequest,
  ): Promise<TypescriptAstEditPreviewResult> {
    const startedAt = Date.now();
    request.signal?.throwIfAborted();
    validateSelector(request.selector);
    validateEditRequest(request);
    const ts = await loadTypescript();
    const source = await loadTypescriptAstSource(
      ts,
      this.workspaceRoot,
      request.path,
      "ast_edit_preview",
      request.expectedSha256,
    );
    request.signal?.throwIfAborted();
    const sourceFile = createCleanSourceFile(ts, source);
    const selected = findTypescriptAstNode(
      ts,
      sourceFile,
      source.fileSha256,
      request.selector,
      request.nodeSha256,
    );
    const targetStart = selected.node.getStart(sourceFile, false);
    const targetEnd = selected.node.getEnd();
    assertSafeTypescriptAstEditTrivia(
      ts,
      source.source,
      selected.node,
      request.operation,
    );
    const targetText = source.source.slice(targetStart, targetEnd);
    const replacement = request.replacement ?? "";
    const targetReplacement = editTargetReplacement(
      source.source,
      targetStart,
      targetText,
      request.operation,
      replacement,
    );
    const updatedSource =
      source.source.slice(0, targetStart) +
      targetReplacement +
      source.source.slice(targetEnd);
    const afterFileBytes = Buffer.byteLength(updatedSource, "utf8");
    if (afterFileBytes > MAX_TYPESCRIPT_AST_FILE_BYTES) {
      throw new Error("TypeScript AST edit output exceeds the file limit");
    }
    createCleanSourceFile(ts, {
      path: source.path,
      source: updatedSource,
      scriptKind: source.scriptKind,
    });
    const application = uniquePatchApplication(
      source.source,
      targetStart,
      targetEnd,
      targetReplacement,
    );
    const applicationOldBytes = Buffer.byteLength(application.oldText, "utf8");
    const applicationNewBytes = Buffer.byteLength(application.newText, "utf8");
    if (
      applicationOldBytes + applicationNewBytes >
      MAX_TYPESCRIPT_AST_APPLICATION_BYTES
    ) {
      throw new Error(
        "TypeScript AST edit application exceeds its output limit",
      );
    }
    request.signal?.throwIfAborted();
    await assertTypescriptAstSourceCurrent(source, "ast_edit_preview");
    const replacementBytes = Buffer.byteLength(replacement, "utf8");
    const base = {
      kind: "napier.typescript-ast" as const,
      schemaVersion: 1 as const,
      action: "edit_preview" as const,
      operation: request.operation,
      language: source.language,
      targetKind: selected.materialized.kind,
      pathSha256: source.pathSha256,
      fileSha256: source.fileSha256,
      fileBytes: source.fileBytes,
      parseDiagnosticCount: 0,
      targetNodeSha256: selected.materialized.nodeSha256,
      targetTextSha256: selected.materialized.textSha256,
      replacementBytes,
      replacementSha256: sha256(replacement),
      applicationOldBytes,
      applicationNewBytes,
      applicationOldSha256: sha256(application.oldText),
      applicationNewSha256: sha256(application.newText),
      applicationContextExpanded: application.contextExpanded,
      afterFileSha256: sha256(updatedSource),
      afterFileBytes,
      visitedNodeCount: selected.visitedNodeCount,
      typescriptVersion: ts.version,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
    return {
      details: {
        ...base,
        resultSha256: sha256(canonicalJson(base)),
      },
      path: source.path,
      target: selected.materialized,
      applicationOldText: application.oldText,
      applicationNewText: application.newText,
    };
  }
}

function createCleanSourceFile(
  ts: typeof import("typescript"),
  source: {
    path: string;
    source: string;
    scriptKind: import("typescript").ScriptKind;
  },
): import("typescript").SourceFile {
  const sourceFile = ts.createSourceFile(
    source.path,
    source.source,
    ts.ScriptTarget.Latest,
    true,
    source.scriptKind,
  );
  const diagnosticCount = typescriptAstParseDiagnosticCount(sourceFile);
  if (diagnosticCount > 0) {
    throw new Error(
      `TypeScript AST source has ${diagnosticCount} syntax diagnostics`,
    );
  }
  return sourceFile;
}

function validateMaxResults(maxResults: number): void {
  if (
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_TYPESCRIPT_AST_QUERY_RESULTS
  ) {
    throw new Error(
      `ast_query maxResults must be 1-${MAX_TYPESCRIPT_AST_QUERY_RESULTS}`,
    );
  }
}

function validateSelector(selector: TypescriptAstSelector): void {
  if (
    selector.name !== undefined &&
    (selector.name.length < 1 || selector.name.length > 200)
  ) {
    throw new Error("TypeScript AST selector name is invalid");
  }
  if (
    selector.ancestorName !== undefined &&
    (selector.ancestorKind === undefined ||
      selector.ancestorName.length < 1 ||
      selector.ancestorName.length > 200)
  ) {
    throw new Error("TypeScript AST ancestor selector is invalid");
  }
}

function validateEditRequest(request: TypescriptAstEditPreviewRequest): void {
  if (!/^[a-f0-9]{64}$/u.test(request.expectedSha256)) {
    throw new Error("ast_edit_preview expectedSha256 is invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(request.nodeSha256)) {
    throw new Error("ast_edit_preview nodeSha256 is invalid");
  }
  if (
    request.operation === "remove"
      ? request.replacement !== undefined
      : request.replacement === undefined
  ) {
    throw new Error("ast_edit_preview replacement does not match operation");
  }
  if (
    request.replacement !== undefined &&
    (request.replacement.length === 0 ||
      Buffer.byteLength(request.replacement, "utf8") >
        MAX_TYPESCRIPT_AST_REPLACEMENT_BYTES)
  ) {
    throw new Error(
      `ast_edit_preview replacement must be 1-${MAX_TYPESCRIPT_AST_REPLACEMENT_BYTES} UTF-8 bytes`,
    );
  }
}

function editTargetReplacement(
  source: string,
  targetStart: number,
  targetText: string,
  operation: TypescriptAstEditOperation,
  replacement: string,
): string {
  if (operation === "replace") return replacement;
  if (operation === "remove") return "";
  const lineBreak = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = source.lastIndexOf("\n", Math.max(0, targetStart - 1)) + 1;
  const indentation =
    source.slice(lineStart, targetStart).match(/^[\t ]*/u)?.[0] ?? "";
  return operation === "insert_before"
    ? `${replacement}${lineBreak}${indentation}${targetText}`
    : `${targetText}${lineBreak}${indentation}${replacement}`;
}

function assertSafeTypescriptAstEditTrivia(
  ts: typeof import("typescript"),
  source: string,
  node: import("typescript").Node,
  operation: TypescriptAstEditOperation,
): void {
  if (operation === "replace") return;
  const hasLeadingComments =
    (ts.getLeadingCommentRanges(source, node.getFullStart())?.length ?? 0) > 0;
  const hasTrailingComments =
    (ts.getTrailingCommentRanges(source, node.getEnd())?.length ?? 0) > 0;
  if (
    (operation === "insert_before" && hasLeadingComments) ||
    (operation === "insert_after" && hasTrailingComments) ||
    (operation === "remove" && (hasLeadingComments || hasTrailingComments))
  ) {
    throw new Error(
      `TypeScript AST ${operation} refuses attached comments; use a reviewed replace preview`,
    );
  }
}

function uniquePatchApplication(
  source: string,
  targetStart: number,
  targetEnd: number,
  targetReplacement: string,
): { oldText: string; newText: string; contextExpanded: boolean } {
  let start = targetStart;
  let end = targetEnd;
  while (true) {
    const oldText = source.slice(start, end);
    if (occurrenceCount(source, oldText) === 1) {
      return {
        oldText,
        newText:
          source.slice(start, targetStart) +
          targetReplacement +
          source.slice(targetEnd, end),
        contextExpanded: start !== targetStart || end !== targetEnd,
      };
    }
    const nextStart = previousLineStart(source, start);
    const nextEnd = nextLineEnd(source, end);
    if (nextStart === start && nextEnd === end) {
      throw new Error(
        "TypeScript AST edit could not build a unique exact patch",
      );
    }
    start = nextStart;
    end = nextEnd;
    if (
      Buffer.byteLength(source.slice(start, end), "utf8") >
      MAX_TYPESCRIPT_AST_APPLICATION_BYTES
    ) {
      throw new Error(
        "TypeScript AST edit context exceeded its uniqueness limit",
      );
    }
  }
}

function occurrenceCount(source: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (count < 2) {
    const found = source.indexOf(value, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(1, value.length);
  }
  return count;
}

function previousLineStart(source: string, offset: number): number {
  if (offset <= 0) return 0;
  const previousNewline = source.lastIndexOf("\n", Math.max(0, offset - 2));
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function nextLineEnd(source: string, offset: number): number {
  if (offset >= source.length) return source.length;
  const newline = source.indexOf("\n", offset);
  return newline < 0 ? source.length : newline + 1;
}

async function loadTypescript(): Promise<typeof import("typescript")> {
  return import("typescript");
}

export function typescriptAstQueryNodeReceipt(
  node: TypescriptAstNode,
): Record<string, unknown> {
  return typescriptAstNodeReceipt(node);
}

export const TYPESCRIPT_AST_SIGNATURE_PREVIEW_LIMIT =
  MAX_TYPESCRIPT_AST_SIGNATURE_CHARS;

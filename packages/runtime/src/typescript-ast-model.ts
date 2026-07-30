import { canonicalJson, sha256 } from "./ed25519.js";

export const TYPESCRIPT_AST_KINDS = [
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
] as const;

export type TypescriptAstKind = (typeof TYPESCRIPT_AST_KINDS)[number];

export interface TypescriptAstSelector {
  kind: TypescriptAstKind;
  name?: string;
  ancestorKind?: TypescriptAstKind;
  ancestorName?: string;
}

export interface TypescriptAstNode {
  kind: TypescriptAstKind;
  name?: string;
  depth: number;
  start: number;
  end: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  textBytes: number;
  textSha256: string;
  nodeSha256: string;
  signaturePreview: string;
  signatureSha256: string;
  parentKind?: TypescriptAstKind;
  parentName?: string;
}

export interface TypescriptAstQueryMaterialization {
  nodes: TypescriptAstNode[];
  matchedNodeCount: number;
  omittedNodeCount: number;
  visitedNodeCount: number;
  traversalComplete: boolean;
  rangeChars: number;
  kindCounts: Record<string, number>;
  nodeSetSha256: string;
  kindCountsSha256: string;
}

export const MAX_TYPESCRIPT_AST_TRAVERSAL_NODES = 100_000;
export const MAX_TYPESCRIPT_AST_MATCH_CANDIDATES = 256;
export const MAX_TYPESCRIPT_AST_RANGE_CHARS = 16 * 1024 * 1024;
export const MAX_TYPESCRIPT_AST_NAME_CHARS = 200;
export const MAX_TYPESCRIPT_AST_SIGNATURE_CHARS = 240;

export function queryTypescriptAst(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  fileSha256: string,
  selector: TypescriptAstSelector,
  maxResults: number,
): TypescriptAstQueryMaterialization {
  const nodes: TypescriptAstNode[] = [];
  const kindCounts = new Map<TypescriptAstKind, number>();
  let matchedNodeCount = 0;
  let visitedNodeCount = 0;
  let traversalComplete = true;
  let rangeChars = 0;
  visitTypescriptAst(ts, sourceFile, (node, depth) => {
    visitedNodeCount += 1;
    if (visitedNodeCount > MAX_TYPESCRIPT_AST_TRAVERSAL_NODES) {
      traversalComplete = false;
      return false;
    }
    if (!matchesSelector(ts, sourceFile, node, selector)) return true;
    matchedNodeCount += 1;
    kindCounts.set(selector.kind, (kindCounts.get(selector.kind) ?? 0) + 1);
    if (nodes.length >= maxResults) return true;
    const start = node.getStart(sourceFile, false);
    const end = node.getEnd();
    rangeChars += end - start;
    if (rangeChars > MAX_TYPESCRIPT_AST_RANGE_CHARS) {
      throw new Error("TypeScript AST query ranges exceeded their limit");
    }
    nodes.push(
      materializeTypescriptAstNode(ts, sourceFile, node, depth, fileSha256),
    );
    return true;
  });
  const kindCountsRecord = Object.fromEntries(
    [...kindCounts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return {
    nodes,
    matchedNodeCount,
    omittedNodeCount: Math.max(0, matchedNodeCount - nodes.length),
    visitedNodeCount: Math.min(
      visitedNodeCount,
      MAX_TYPESCRIPT_AST_TRAVERSAL_NODES,
    ),
    traversalComplete,
    rangeChars,
    kindCounts: kindCountsRecord,
    nodeSetSha256: sha256(canonicalJson(nodes.map(typescriptAstNodeReceipt))),
    kindCountsSha256: sha256(canonicalJson(kindCountsRecord)),
  };
}

export function findTypescriptAstNode(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  fileSha256: string,
  selector: TypescriptAstSelector,
  nodeSha256: string,
): {
  node: import("typescript").Node;
  materialized: TypescriptAstNode;
  visitedNodeCount: number;
} {
  let found:
    | {
        node: import("typescript").Node;
        materialized: TypescriptAstNode;
      }
    | undefined;
  let candidateCount = 0;
  let visitedNodeCount = 0;
  let rangeChars = 0;
  visitTypescriptAst(ts, sourceFile, (node, depth) => {
    visitedNodeCount += 1;
    if (visitedNodeCount > MAX_TYPESCRIPT_AST_TRAVERSAL_NODES) {
      throw new Error("TypeScript AST traversal exceeded its node limit");
    }
    if (!matchesSelector(ts, sourceFile, node, selector)) return true;
    candidateCount += 1;
    if (candidateCount > MAX_TYPESCRIPT_AST_MATCH_CANDIDATES) {
      throw new Error("TypeScript AST selector matched too many candidates");
    }
    const start = node.getStart(sourceFile, false);
    const end = node.getEnd();
    rangeChars += end - start;
    if (rangeChars > MAX_TYPESCRIPT_AST_RANGE_CHARS) {
      throw new Error("TypeScript AST candidate ranges exceeded their limit");
    }
    const materialized = materializeTypescriptAstNode(
      ts,
      sourceFile,
      node,
      depth,
      fileSha256,
    );
    if (materialized.nodeSha256 !== nodeSha256) return true;
    if (found) {
      throw new Error("TypeScript AST node hash is not unique");
    }
    found = { node, materialized };
    return true;
  });
  if (!found) {
    throw new Error("TypeScript AST node does not match the current source");
  }
  return { ...found, visitedNodeCount };
}

export function typescriptAstParseDiagnosticCount(
  sourceFile: import("typescript").SourceFile,
): number {
  return (
    (
      sourceFile as import("typescript").SourceFile & {
        parseDiagnostics?: readonly import("typescript").Diagnostic[];
      }
    ).parseDiagnostics?.length ?? 0
  );
}

export function typescriptAstNodeReceipt(
  node: TypescriptAstNode,
): Record<string, unknown> {
  return {
    kind: node.kind,
    nameSha256: sha256(node.name ?? ""),
    depth: node.depth,
    start: node.start,
    end: node.end,
    startLine: node.startLine,
    startCharacter: node.startCharacter,
    endLine: node.endLine,
    endCharacter: node.endCharacter,
    textBytes: node.textBytes,
    textSha256: node.textSha256,
    nodeSha256: node.nodeSha256,
    signatureSha256: node.signatureSha256,
    parentKind: node.parentKind ?? null,
    parentNameSha256: sha256(node.parentName ?? ""),
  };
}

function visitTypescriptAst(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  visitor: (node: import("typescript").Node, depth: number) => boolean,
): void {
  const pending: Array<{ node: import("typescript").Node; depth: number }> = [
    { node: sourceFile, depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!visitor(current.node, current.depth)) return;
    const children: import("typescript").Node[] = [];
    ts.forEachChild(current.node, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index]!, depth: current.depth + 1 });
    }
  }
}

function matchesSelector(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  node: import("typescript").Node,
  selector: TypescriptAstSelector,
): boolean {
  const kind = typescriptAstKind(ts, node);
  if (kind !== selector.kind) return false;
  const name = typescriptAstName(ts, sourceFile, node);
  if (selector.name !== undefined && name !== selector.name) return false;
  if (selector.ancestorKind === undefined) return true;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (typescriptAstKind(ts, ancestor) !== selector.ancestorKind) continue;
    if (
      selector.ancestorName === undefined ||
      typescriptAstName(ts, sourceFile, ancestor) === selector.ancestorName
    ) {
      return true;
    }
  }
  return false;
}

function materializeTypescriptAstNode(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  node: import("typescript").Node,
  depth: number,
  fileSha256: string,
): TypescriptAstNode {
  const kind = typescriptAstKind(ts, node);
  if (!kind) throw new Error("TypeScript AST node kind is unsupported");
  const start = node.getStart(sourceFile, false);
  const end = node.getEnd();
  const text = sourceFile.text.slice(start, end);
  const textSha256 = sha256(text);
  const name = typescriptAstName(ts, sourceFile, node);
  const signaturePreview = sourceFile.text
    .slice(start, Math.min(end, start + 1_000))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TYPESCRIPT_AST_SIGNATURE_CHARS);
  const signatureSha256 = sha256(signaturePreview);
  const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
  const endPosition = sourceFile.getLineAndCharacterOfPosition(end);
  const parent = nearestCategorizedParent(ts, sourceFile, node.parent);
  const receipt = {
    fileSha256,
    kind,
    name: name ?? null,
    depth,
    start,
    end,
    textSha256,
    parentKind: parent?.kind ?? null,
    parentName: parent?.name ?? null,
  };
  return {
    kind,
    ...(name ? { name } : {}),
    depth,
    start,
    end,
    startLine: startPosition.line + 1,
    startCharacter: startPosition.character + 1,
    endLine: endPosition.line + 1,
    endCharacter: endPosition.character + 1,
    textBytes: Buffer.byteLength(text, "utf8"),
    textSha256,
    nodeSha256: sha256(canonicalJson(receipt)),
    signaturePreview,
    signatureSha256,
    ...(parent?.kind ? { parentKind: parent.kind } : {}),
    ...(parent?.name ? { parentName: parent.name } : {}),
  };
}

function nearestCategorizedParent(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  node: import("typescript").Node | undefined,
): { kind: TypescriptAstKind; name?: string } | undefined {
  for (let current = node; current; current = current.parent) {
    const kind = typescriptAstKind(ts, current);
    if (!kind) continue;
    const name = typescriptAstName(ts, sourceFile, current);
    return { kind, ...(name ? { name } : {}) };
  }
  return undefined;
}

function typescriptAstKind(
  ts: typeof import("typescript"),
  node: import("typescript").Node,
): TypescriptAstKind | undefined {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node))
    return "method";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node))
    return "property";
  if (ts.isGetAccessorDeclaration(node)) return "getter";
  if (ts.isSetAccessorDeclaration(node)) return "setter";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isTypeAliasDeclaration(node)) return "type_alias";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isModuleDeclaration(node)) return "namespace";
  if (ts.isImportDeclaration(node)) return "import";
  if (ts.isImportSpecifier(node)) return "import_specifier";
  if (ts.isCallExpression(node)) return "call";
  if (ts.isParameter(node)) return "parameter";
  if (ts.isArrowFunction(node)) return "arrow_function";
  return undefined;
}

function typescriptAstName(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  node: import("typescript").Node,
): string | undefined {
  let value: string | undefined;
  if (ts.isConstructorDeclaration(node)) {
    value = "constructor";
  } else if (ts.isImportDeclaration(node)) {
    value = ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : node.moduleSpecifier.getText(sourceFile);
  } else if (ts.isCallExpression(node)) {
    value = node.expression.getText(sourceFile);
  } else if (ts.isArrowFunction(node)) {
    value =
      node.parent && ts.isVariableDeclaration(node.parent)
        ? node.parent.name.getText(sourceFile)
        : undefined;
  } else if (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isParameter(node)
  ) {
    const named = node as import("typescript").NamedDeclaration;
    value = named.name?.getText(sourceFile);
  }
  if (!value || value.length > MAX_TYPESCRIPT_AST_NAME_CHARS) return undefined;
  return value;
}

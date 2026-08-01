import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_WRITE_LINKED_SCAN_FILES = 1_000;
export const MAX_WRITE_LINKED_SCAN_BYTES = 32 * 1024 * 1024;
export const MAX_WRITE_LINKED_IMPORT_EDGES = 5_000;
export const MAX_WRITE_LINKED_TESTS = 8;
export const MAX_WRITE_LINKED_FILE_BYTES = 1024 * 1024;
export const MAX_WRITE_LINKED_SYMBOLS_PER_FILE = 512;

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const SOURCE_EXTENSION_SET = new Set<string>(SOURCE_EXTENSIONS);
const GENERATED_DIRECTORIES = new Set([
  ".vite",
  "benchmark-results",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);
const TEST_FILE_PATTERN = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;

export interface WriteLinkedTestSymbolSnapshot {
  identity: string;
  contentSha256: string;
}

export interface WriteLinkedScannedSource {
  path: string;
  source: string;
  fileSha256: string;
  scriptKind: import("typescript").ScriptKind;
  symbols: WriteLinkedTestSymbolSnapshot[];
  symbolsTruncated: boolean;
}

export interface WriteLinkedTestGraphScan {
  sources: WriteLinkedScannedSource[];
  truncated: boolean;
}

export function supportsWriteLinkedTests(candidate: string): boolean {
  return SOURCE_EXTENSION_SET.has(path.extname(candidate).toLowerCase());
}

export async function scanWriteLinkedSources(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  scanRoots: string[] = [workspaceRoot],
): Promise<WriteLinkedTestGraphScan> {
  const relativePaths: string[] = [];
  let truncated = false;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        isProtectedWorkspacePathSegment(entry.name) ||
        (entry.isDirectory() &&
          GENERATED_DIRECTORIES.has(entry.name.toLowerCase()))
      ) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (
        entry.isFile() &&
        supportsWriteLinkedTests(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        relativePaths.push(
          path.relative(workspaceRoot, absolute).split(path.sep).join("/"),
        );
        if (relativePaths.length >= MAX_WRITE_LINKED_SCAN_FILES) {
          truncated = true;
          return;
        }
      }
      if (truncated) return;
    }
  };
  for (const scanRoot of [...new Set(scanRoots)].sort()) {
    const absoluteRoot = path.resolve(scanRoot);
    if (
      absoluteRoot !== workspaceRoot &&
      !absoluteRoot.startsWith(`${workspaceRoot}${path.sep}`)
    ) {
      throw new Error("Write-linked test scan root escapes the workspace");
    }
    await visit(absoluteRoot);
    if (truncated) break;
  }

  const sources: WriteLinkedScannedSource[] = [];
  let totalBytes = 0;
  for (const relativePath of [...new Set(relativePaths)].sort()) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const canonical = await realpath(absolutePath);
    if (canonical !== absolutePath) {
      truncated = true;
      continue;
    }
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > MAX_WRITE_LINKED_FILE_BYTES) {
      truncated = true;
      continue;
    }
    totalBytes += info.size;
    if (totalBytes > MAX_WRITE_LINKED_SCAN_BYTES) {
      truncated = true;
      break;
    }
    const buffer = await readFile(absolutePath);
    const sourceText = decodeUtf8(buffer);
    const scriptKind = scriptKindForPath(ts, relativePath);
    const sourceFile = ts.createSourceFile(
      relativePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const symbolSnapshot = symbolSnapshots(ts, sourceFile, sourceText);
    sources.push({
      path: relativePath,
      source: sourceText,
      fileSha256: sha256(buffer),
      scriptKind,
      symbols: symbolSnapshot.symbols,
      symbolsTruncated: symbolSnapshot.truncated,
    });
  }
  return { sources, truncated };
}

export async function readWriteLinkedSource(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  relativePathInput: string,
  expectedSha256: string,
): Promise<WriteLinkedScannedSource> {
  const relativePath = normalizeWriteLinkedPath(relativePathInput);
  if (
    !relativePath ||
    path.isAbsolute(relativePathInput) ||
    relativePath.split("/").some(isProtectedWorkspacePathSegment) ||
    !supportsWriteLinkedTests(relativePath)
  ) {
    throw new Error("Write-linked test source path is invalid");
  }
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  if (!absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error("Write-linked test source escapes the workspace");
  }
  const canonical = await realpath(absolutePath);
  if (canonical !== absolutePath) {
    throw new Error("Write-linked test source is not canonical");
  }
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size > MAX_WRITE_LINKED_FILE_BYTES) {
    throw new Error("Write-linked test source is unavailable");
  }
  const buffer = await readFile(absolutePath);
  const fileSha256 = sha256(buffer);
  if (fileSha256 !== expectedSha256) {
    throw new WriteLinkedTestSourceDriftError(relativePath, fileSha256);
  }
  const source = decodeUtf8(buffer);
  const scriptKind = scriptKindForPath(ts, relativePath);
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const symbolSnapshot = symbolSnapshots(ts, sourceFile, source);
  return {
    path: relativePath,
    source,
    fileSha256,
    scriptKind,
    symbols: symbolSnapshot.symbols,
    symbolsTruncated: symbolSnapshot.truncated,
  };
}

export function writeLinkedModuleSpecifiers(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
): string[] {
  const specifiers: string[] = [];
  const visit = (node: import("typescript").Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(specifiers)].sort();
}

export function resolveWriteLinkedWorkspaceModule(
  importer: string,
  specifier: string,
  byPath: ReadonlyMap<string, WriteLinkedScannedSource>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  if (base === ".." || base.startsWith("../")) return undefined;
  return writeLinkedModuleCandidates(base).find((candidate) =>
    byPath.has(candidate),
  );
}

export function unresolvedWriteLinkedCodeImport(
  importer: string,
  specifier: string,
): boolean {
  if (!specifier.startsWith(".")) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  if (
    resolved
      .split("/")
      .some((segment) => GENERATED_DIRECTORIES.has(segment.toLowerCase()))
  ) {
    return false;
  }
  const extension = path.posix.extname(specifier).toLowerCase();
  return !extension || SOURCE_EXTENSION_SET.has(extension);
}

export function writeLinkedChangedSymbolRecords(
  before:
    | Array<{
        path: string;
        symbols: WriteLinkedTestSymbolSnapshot[];
      }>
    | undefined,
  after: WriteLinkedScannedSource[],
): Array<{
  identity: string;
  beforeSha256?: string;
  afterSha256?: string;
}> {
  const beforeByPath = new Map(
    (before ?? []).map((file) => [normalizeWriteLinkedPath(file.path), file]),
  );
  const changed = [];
  for (const source of after) {
    const beforeSymbols = new Map(
      (beforeByPath.get(source.path)?.symbols ?? []).map((symbol) => [
        symbol.identity,
        symbol.contentSha256,
      ]),
    );
    const afterSymbols = new Map(
      source.symbols.map((symbol) => [symbol.identity, symbol.contentSha256]),
    );
    for (const identity of [
      ...new Set([...beforeSymbols.keys(), ...afterSymbols.keys()]),
    ].sort()) {
      const beforeSha256 = beforeSymbols.get(identity);
      const afterSha256 = afterSymbols.get(identity);
      if (beforeSha256 === afterSha256) continue;
      changed.push({
        identity: `${source.path}#${identity}`,
        ...(beforeSha256 ? { beforeSha256 } : {}),
        ...(afterSha256 ? { afterSha256 } : {}),
      });
    }
  }
  return changed;
}

export function isWriteLinkedTestFile(relativePath: string): boolean {
  return TEST_FILE_PATTERN.test(relativePath);
}

export function writeLinkedParseDiagnosticCount(
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

export function normalizeWriteLinkedPath(candidate: string): string {
  return path.normalize(candidate).split(path.sep).join("/");
}

export class WriteLinkedTestSourceDriftError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly observedFileSha256?: string,
  ) {
    super("Write-linked test selection observed changed source bytes");
    this.name = "WriteLinkedTestSourceDriftError";
  }
}

export function writeLinkedModuleCandidates(base: string): string[] {
  const extension = path.posix.extname(base).toLowerCase();
  const candidates = new Set<string>();
  if (SOURCE_EXTENSION_SET.has(extension)) {
    candidates.add(base);
    const stem = base.slice(0, -extension.length);
    if (extension === ".js" || extension === ".jsx") {
      for (const replacement of [".ts", ".tsx", ".js", ".jsx"]) {
        candidates.add(`${stem}${replacement}`);
      }
    } else if (extension === ".mjs") {
      candidates.add(`${stem}.mts`);
    } else if (extension === ".cjs") {
      candidates.add(`${stem}.cts`);
    }
  } else if (!extension) {
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      candidates.add(`${base}${candidateExtension}`);
      candidates.add(`${base}/index${candidateExtension}`);
    }
  }
  return [...candidates];
}

function symbolSnapshots(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  source: string,
): {
  symbols: WriteLinkedTestSymbolSnapshot[];
  truncated: boolean;
} {
  const symbols: WriteLinkedTestSymbolSnapshot[] = [];
  const visit = (
    node: import("typescript").Node,
    parentNames: string[],
  ): void => {
    const name = declarationName(ts, node);
    const nextParents = name ? [...parentNames, name] : parentNames;
    if (name && isTrackedDeclaration(ts, node)) {
      symbols.push({
        identity: nextParents.join("."),
        contentSha256: sha256(
          source.slice(node.getStart(sourceFile), node.getEnd()),
        ),
      });
    }
    ts.forEachChild(node, (child) => visit(child, nextParents));
  };
  visit(sourceFile, []);
  symbols.sort((left, right) => left.identity.localeCompare(right.identity));
  return {
    symbols: symbols.slice(0, MAX_WRITE_LINKED_SYMBOLS_PER_FILE),
    truncated: symbols.length > MAX_WRITE_LINKED_SYMBOLS_PER_FILE,
  };
}

function declarationName(
  ts: typeof import("typescript"),
  node: import("typescript").Node,
): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (
    (ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  return undefined;
}

function isTrackedDeclaration(
  ts: typeof import("typescript"),
  node: import("typescript").Node,
): boolean {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function scriptKindForPath(
  ts: typeof import("typescript"),
  relativePath: string,
): import("typescript").ScriptKind {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Write-linked test source is not valid UTF-8");
  }
}

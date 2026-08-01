import { realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  createWriteLinkedModuleResolution,
  observeWriteLinkedResolutionConfigurations,
} from "./write-linked-module-resolution.js";
import {
  isWriteLinkedTestFile,
  MAX_WRITE_LINKED_IMPORT_EDGES,
  MAX_WRITE_LINKED_TESTS,
  normalizeWriteLinkedPath,
  readWriteLinkedSource,
  scanWriteLinkedSources,
  supportsWriteLinkedTests,
  unresolvedWriteLinkedCodeImport,
  writeLinkedChangedSymbolRecords,
  writeLinkedModuleSpecifiers,
  writeLinkedParseDiagnosticCount,
  WriteLinkedTestSourceDriftError,
  type WriteLinkedScannedSource,
  type WriteLinkedTestSymbolSnapshot,
} from "./write-linked-test-graph.js";

export {
  MAX_WRITE_LINKED_FILE_BYTES,
  MAX_WRITE_LINKED_IMPORT_EDGES,
  MAX_WRITE_LINKED_SCAN_BYTES,
  MAX_WRITE_LINKED_SCAN_FILES,
  MAX_WRITE_LINKED_SYMBOLS_PER_FILE,
  MAX_WRITE_LINKED_TESTS,
  supportsWriteLinkedTests,
} from "./write-linked-test-graph.js";

export interface WriteLinkedChangedFile {
  path: string;
  expectedSha256: string;
}

export interface WriteLinkedTestBeforeState {
  files: Array<{
    path: string;
    fileSha256: string;
    symbols: WriteLinkedTestSymbolSnapshot[];
    symbolsTruncated: boolean;
  }>;
}

export interface WriteLinkedTestSelection {
  complete: boolean;
  changedFiles: WriteLinkedChangedFile[];
  changedSymbols: string[];
  changedSymbolsTruncated: boolean;
  selectedTests: string[];
  scanRootPaths: string[];
  configurationPaths: string[];
  configurationFileCount: number;
  workspacePackageCount: number;
  pathAliasCount: number;
  workspacePackageEdgeCount: number;
  pathAliasEdgeCount: number;
  scannedFileCount: number;
  candidateTestCount: number;
  omittedTestCount: number;
  unresolvedImportCount: number;
  graphTruncated: boolean;
  changedFileSetSha256: string;
  changedSymbolSetSha256: string;
  dependencyGraphSha256: string;
  selectedTestSetSha256: string;
  selectionSnapshotSha256: string;
}

export async function captureWriteLinkedTestBeforeState(
  workspaceRootInput: string,
  changedFiles: WriteLinkedChangedFile[],
): Promise<WriteLinkedTestBeforeState> {
  validateChangedFiles(changedFiles);
  const ts = await import("typescript");
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const files = [];
  for (const changed of changedFiles) {
    const source = await readCurrentSource(
      ts,
      workspaceRoot,
      changed.path,
      changed.expectedSha256,
    );
    files.push({
      path: source.path,
      fileSha256: source.fileSha256,
      symbols: source.symbols,
      symbolsTruncated: source.symbolsTruncated,
    });
  }
  return { files };
}

export async function selectWriteLinkedTests(input: {
  workspaceRoot: string;
  changedFiles: WriteLinkedChangedFile[];
  before?: WriteLinkedTestBeforeState;
}): Promise<WriteLinkedTestSelection> {
  validateChangedFiles(input.changedFiles);
  const ts = await import("typescript");
  const workspaceRoot = await realpath(path.resolve(input.workspaceRoot));
  const resolution = await createWriteLinkedModuleResolution(
    ts,
    workspaceRoot,
    input.changedFiles.map((file) => normalizeWriteLinkedPath(file.path)),
  );
  const scanRoots = resolution.scanRoots;
  const scan = await scanWriteLinkedSources(ts, workspaceRoot, scanRoots);
  const byPath = new Map(scan.sources.map((source) => [source.path, source]));
  const changedSources: WriteLinkedScannedSource[] = [];
  let graphTruncated = scan.truncated || resolution.truncated;
  for (const changed of input.changedFiles) {
    let source = byPath.get(normalizeWriteLinkedPath(changed.path));
    if (!source) {
      source = await readCurrentSource(
        ts,
        workspaceRoot,
        changed.path,
        changed.expectedSha256,
      );
      graphTruncated = true;
    }
    if (source.fileSha256 !== changed.expectedSha256) {
      throw new WriteLinkedTestSelectionDriftError(
        changed.path,
        source.fileSha256,
      );
    }
    changedSources.push(source);
  }

  const edges: Array<{
    importer: string;
    imported: string;
    kind: "relative" | "workspace_package" | "path_alias";
  }> = [];
  const reverseDependencies = new Map<string, Set<string>>();
  const unresolvedByImporter = new Map<string, number>();
  const parseInvalidPaths = new Set<string>();
  edgeLoop: for (const source of scan.sources) {
    const sourceFile = ts.createSourceFile(
      source.path,
      source.source,
      ts.ScriptTarget.Latest,
      true,
      source.scriptKind,
    );
    if (writeLinkedParseDiagnosticCount(sourceFile) > 0) {
      parseInvalidPaths.add(source.path);
    }
    for (const specifier of writeLinkedModuleSpecifiers(ts, sourceFile)) {
      const imported = resolution.resolve(source.path, specifier, byPath);
      if (!imported) {
        if (
          unresolvedWriteLinkedCodeImport(source.path, specifier) ||
          resolution.recognizesWorkspaceSpecifier(source.path, specifier)
        ) {
          unresolvedByImporter.set(
            source.path,
            (unresolvedByImporter.get(source.path) ?? 0) + 1,
          );
        }
        continue;
      }
      edges.push({
        importer: source.path,
        imported: imported.path,
        kind: imported.kind,
      });
      const importers =
        reverseDependencies.get(imported.path) ?? new Set<string>();
      importers.add(source.path);
      reverseDependencies.set(imported.path, importers);
      if (edges.length >= MAX_WRITE_LINKED_IMPORT_EDGES) {
        graphTruncated = true;
        break edgeLoop;
      }
    }
  }
  const reachable = reverseReachable(
    changedSources.map((source) => source.path),
    reverseDependencies,
  );
  const unresolvedImportCount = [...reachable].reduce(
    (count, candidate) => count + (unresolvedByImporter.get(candidate) ?? 0),
    0,
  );
  if (
    unresolvedImportCount > 0 ||
    [...reachable].some((candidate) => parseInvalidPaths.has(candidate))
  ) {
    graphTruncated = true;
  }
  const relevantTests = [...reachable]
    .filter(isWriteLinkedTestFile)
    .sort((left, right) => left.localeCompare(right));
  const selectedTests = relevantTests.slice(0, MAX_WRITE_LINKED_TESTS);
  const omittedTestCount = relevantTests.length - selectedTests.length;
  if (omittedTestCount > 0) graphTruncated = true;

  const changedSymbols = writeLinkedChangedSymbolRecords(
    input.before?.files,
    changedSources,
  );
  const changedSymbolsTruncated =
    changedSources.some((source) => source.symbolsTruncated) ||
    input.before?.files.some((source) => source.symbolsTruncated) === true;
  const changedFiles = changedSources.map((source) => ({
    path: source.path,
    expectedSha256: source.fileSha256,
  }));
  const fileReceipts = scan.sources.map((source) => ({
    pathSha256: sha256(source.path),
    fileSha256: source.fileSha256,
  }));
  const edgeReceipts = edges
    .map((edge) => ({
      importerPathSha256: sha256(edge.importer),
      importedPathSha256: sha256(edge.imported),
      resolutionKind: edge.kind,
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const selectedReceipts = selectedTests.map((testPath) => ({
    pathSha256: sha256(testPath),
    fileSha256: byPath.get(testPath)!.fileSha256,
  }));
  const configurationByPath = new Map(
    resolution.configurationFiles.map((configuration) => [
      configuration.path,
      configuration,
    ]),
  );
  const configurationReceipts = resolution.configurationPaths.map(
    (configurationPath) => ({
      pathSha256: sha256(configurationPath),
      fileSha256:
        configurationByPath.get(configurationPath)?.fileSha256 ??
        sha256("missing"),
    }),
  );
  return {
    complete: !graphTruncated,
    changedFiles,
    changedSymbols: changedSymbols.map((symbol) => symbol.identity),
    changedSymbolsTruncated,
    selectedTests,
    scanRootPaths: scanRoots.map((root) =>
      normalizeWriteLinkedPath(path.relative(workspaceRoot, root) || "."),
    ),
    configurationPaths: resolution.configurationPaths,
    configurationFileCount: resolution.configurationFiles.length,
    workspacePackageCount: resolution.workspacePackageCount,
    pathAliasCount: resolution.pathAliasCount,
    workspacePackageEdgeCount: edges.filter(
      (edge) => edge.kind === "workspace_package",
    ).length,
    pathAliasEdgeCount: edges.filter((edge) => edge.kind === "path_alias")
      .length,
    scannedFileCount: scan.sources.length,
    candidateTestCount: scan.sources.filter((source) =>
      isWriteLinkedTestFile(source.path),
    ).length,
    omittedTestCount,
    unresolvedImportCount,
    graphTruncated,
    changedFileSetSha256: sha256(
      canonicalJson(
        changedFiles.map((file) => ({
          pathSha256: sha256(file.path),
          fileSha256: file.expectedSha256,
        })),
      ),
    ),
    changedSymbolSetSha256: sha256(
      canonicalJson(
        changedSymbols.map((symbol) => ({
          identitySha256: sha256(symbol.identity),
          beforeSha256: symbol.beforeSha256 ?? null,
          afterSha256: symbol.afterSha256 ?? null,
        })),
      ),
    ),
    dependencyGraphSha256: sha256(canonicalJson(edgeReceipts)),
    selectedTestSetSha256: sha256(canonicalJson(selectedReceipts)),
    selectionSnapshotSha256: sha256(
      canonicalJson({
        truncated: scan.truncated,
        files: fileReceipts,
        configurations: configurationReceipts,
      }),
    ),
  };
}

export async function observeWriteLinkedSelectionSnapshot(
  workspaceRootInput: string,
  scanRootPaths: string[],
  configurationPaths: string[],
): Promise<string> {
  const ts = await import("typescript");
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const scan = await scanWriteLinkedSources(
    ts,
    workspaceRoot,
    scanRootPaths.map((root) => path.resolve(workspaceRoot, root)),
  );
  const configurations = await observeWriteLinkedResolutionConfigurations(
    workspaceRoot,
    configurationPaths,
  );
  return sha256(
    canonicalJson({
      truncated: scan.truncated,
      files: scan.sources.map((source) => ({
        pathSha256: sha256(source.path),
        fileSha256: source.fileSha256,
      })),
      configurations: configurations.map((configuration) => ({
        pathSha256: sha256(configuration.path),
        fileSha256: configuration.fileSha256,
      })),
    }),
  );
}

export class WriteLinkedTestSelectionDriftError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly observedFileSha256?: string,
  ) {
    super("Write-linked test selection observed changed source bytes");
    this.name = "WriteLinkedTestSelectionDriftError";
  }
}

function reverseReachable(
  roots: string[],
  reverseDependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const reachable = new Set(roots);
  const pending = [...reachable].sort();
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const importer of [
      ...(reverseDependencies.get(current) ?? []),
    ].sort()) {
      if (reachable.has(importer)) continue;
      reachable.add(importer);
      pending.push(importer);
    }
  }
  return reachable;
}

function validateChangedFiles(changedFiles: WriteLinkedChangedFile[]): void {
  if (changedFiles.length < 1 || changedFiles.length > 32) {
    throw new Error("Write-linked test changed file count is invalid");
  }
  const paths = new Set<string>();
  for (const file of changedFiles) {
    if (
      !file.path ||
      file.path.length > 500 ||
      path.isAbsolute(file.path) ||
      !supportsWriteLinkedTests(file.path) ||
      !/^[a-f0-9]{64}$/u.test(file.expectedSha256)
    ) {
      throw new Error("Write-linked test changed file is invalid");
    }
    const normalized = normalizeWriteLinkedPath(file.path);
    if (paths.has(normalized)) {
      throw new Error("Write-linked test changed file is duplicated");
    }
    paths.add(normalized);
  }
}

async function readCurrentSource(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  relativePath: string,
  expectedSha256: string,
): Promise<WriteLinkedScannedSource> {
  try {
    return await readWriteLinkedSource(
      ts,
      workspaceRoot,
      relativePath,
      expectedSha256,
    );
  } catch (error) {
    if (error instanceof WriteLinkedTestSourceDriftError) {
      throw new WriteLinkedTestSelectionDriftError(
        error.sourcePath,
        error.observedFileSha256,
      );
    }
    throw error;
  }
}

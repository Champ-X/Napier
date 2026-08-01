import type { WriteLinkedTestVerificationDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  captureWriteLinkedTestBeforeState,
  observeWriteLinkedSelectionSnapshot,
  selectWriteLinkedTests,
  supportsWriteLinkedTests,
  type WriteLinkedChangedFile,
  type WriteLinkedTestBeforeState,
  type WriteLinkedTestSelection,
} from "./write-linked-test-selection.js";

const EMPTY_SET_SHA256 = sha256(canonicalJson([]));
const MAX_LIFECYCLE_FILES = 32;
const MAX_SELECTED_TESTS = 8;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface WriteLinkedLifecycleFile {
  path: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface WriteLinkedLifecycleBeforeState {
  bindingSha256: string;
  symbols: WriteLinkedTestBeforeState;
  selection?: WriteLinkedTestSelection;
}

export interface WriteLinkedLifecycleSelection {
  details: Omit<
    WriteLinkedTestVerificationDetails,
    | "kind"
    | "schemaVersion"
    | "status"
    | "observedSnapshotSha256"
    | "verifierSha256"
    | "durationMs"
    | "exitCode"
    | "stdoutSha256"
    | "stderrSha256"
    | "stdoutTruncated"
    | "stderrTruncated"
    | "errorSha256"
    | "resultSha256"
  >;
  selectedTests: string[];
  scanRootPaths: string[];
  configurationPaths: string[];
}

export async function captureWriteLinkedLifecycleBeforeState(input: {
  workspaceRoot: string;
  files: WriteLinkedLifecycleFile[];
}): Promise<WriteLinkedLifecycleBeforeState> {
  validateWriteLinkedLifecycleFiles(input.files);
  const present = beforePresent(input.files);
  const symbols =
    present.length > 0
      ? await captureWriteLinkedTestBeforeState(input.workspaceRoot, present)
      : { files: [] };
  const selection =
    present.length > 0
      ? await selectWriteLinkedTests({
          workspaceRoot: input.workspaceRoot,
          changedFiles: present,
        })
      : undefined;
  return {
    bindingSha256: writeLinkedLifecycleBindingSha256(input.files),
    symbols,
    ...(selection ? { selection } : {}),
  };
}

export async function createWriteLinkedLifecycleSelection(input: {
  workspaceRoot: string;
  files: WriteLinkedLifecycleFile[];
  before: WriteLinkedLifecycleBeforeState;
  after?: WriteLinkedTestSelection;
}): Promise<WriteLinkedLifecycleSelection> {
  const selections = [input.before.selection, input.after].filter(
    (selection): selection is WriteLinkedTestSelection =>
      selection !== undefined,
  );
  const removedPaths = new Set(
    input.files
      .filter((file) => file.afterSha256 === null)
      .map((file) => file.path),
  );
  const allSelectedTests = [
    ...new Set(selections.flatMap((selection) => selection.selectedTests)),
  ]
    .filter((test) => !removedPaths.has(test))
    .sort();
  const selectedTests = allSelectedTests.slice(0, MAX_SELECTED_TESTS);
  const scanRootPaths = [
    ...new Set(selections.flatMap((selection) => selection.scanRootPaths)),
  ].sort();
  const configurationPaths = [
    ...new Set(selections.flatMap((selection) => selection.configurationPaths)),
  ].sort();
  const graphTruncated =
    selections.some((selection) => !selection.complete) ||
    allSelectedTests.length > MAX_SELECTED_TESTS;
  const deletedSymbols = input.before.symbols.files
    .filter(
      (file) =>
        input.files.find((candidate) => candidate.path === file.path)
          ?.afterSha256 === null,
    )
    .flatMap((file) =>
      file.symbols.map((symbol) => ({
        identity: `${file.path}#${symbol.identity}`,
        beforeSha256: symbol.contentSha256,
        afterSha256: null,
      })),
    );
  const afterSymbols = (input.after?.changedSymbols ?? []).map((identity) => ({
    identity,
    beforeSha256: null,
    afterSha256: null,
  }));
  const changedSymbolIdentities = [
    ...new Set([
      ...deletedSymbols.map((symbol) => symbol.identity),
      ...afterSymbols.map((symbol) => symbol.identity),
    ]),
  ].sort();
  const selectionSnapshotSha256 =
    scanRootPaths.length > 0
      ? await observeWriteLinkedSelectionSnapshot(
          input.workspaceRoot,
          scanRootPaths,
          configurationPaths,
        )
      : EMPTY_SET_SHA256;
  const candidateTestCount = Math.max(
    selectedTests.length,
    ...selections.map((selection) => selection.candidateTestCount),
  );
  const scannedFileCount = Math.max(
    candidateTestCount,
    ...selections.map((selection) => selection.scannedFileCount),
  );
  const edgeCounts = maximumEdgeCounts(selections);
  return {
    selectedTests,
    scanRootPaths,
    configurationPaths,
    details: {
      changedFileCount: input.files.length,
      changedSymbolCount: changedSymbolIdentities.length,
      changedSymbolsTruncated:
        input.before.symbols.files.some((file) => file.symbolsTruncated) ||
        input.after?.changedSymbolsTruncated === true,
      scannedFileCount,
      configurationFileCount: maximum(
        selections.map((selection) => selection.configurationFileCount),
      ),
      workspacePackageCount: maximum(
        selections.map((selection) => selection.workspacePackageCount),
      ),
      pathAliasCount: maximum(
        selections.map((selection) => selection.pathAliasCount),
      ),
      workspacePackageEdgeCount: edgeCounts.workspacePackage,
      pathAliasEdgeCount: edgeCounts.pathAlias,
      candidateTestCount,
      selectedTestCount: selectedTests.length,
      omittedTestCount: Math.max(
        allSelectedTests.length - selectedTests.length,
        ...selections.map((selection) => selection.omittedTestCount),
      ),
      unresolvedImportCount: maximum(
        selections.map((selection) => selection.unresolvedImportCount),
      ),
      graphTruncated,
      changedFileSetSha256: sha256(
        canonicalJson(
          input.files.map((file) => ({
            pathSha256: file.pathSha256,
            beforeSha256: file.beforeSha256,
            afterSha256: file.afterSha256,
          })),
        ),
      ),
      changedSymbolSetSha256: sha256(
        canonicalJson({
          identities: changedSymbolIdentities.map((identity) =>
            sha256(identity),
          ),
          deleted: deletedSymbols,
          afterSetSha256:
            input.after?.changedSymbolSetSha256 ?? EMPTY_SET_SHA256,
        }),
      ),
      dependencyGraphSha256: sha256(
        canonicalJson({
          before:
            input.before.selection?.dependencyGraphSha256 ?? EMPTY_SET_SHA256,
          after: input.after?.dependencyGraphSha256 ?? EMPTY_SET_SHA256,
        }),
      ),
      selectedTestSetSha256: sha256(
        canonicalJson({
          paths: allSelectedTests.map((test) => sha256(test)),
          before:
            input.before.selection?.selectedTestSetSha256 ?? EMPTY_SET_SHA256,
          after: input.after?.selectedTestSetSha256 ?? EMPTY_SET_SHA256,
        }),
      ),
      selectionSnapshotSha256,
    },
  };
}

export function writeLinkedLifecycleAfterFiles(
  files: WriteLinkedLifecycleFile[],
): WriteLinkedChangedFile[] {
  return files
    .filter(
      (
        file,
      ): file is WriteLinkedLifecycleFile & {
        afterSha256: string;
      } => file.afterSha256 !== null,
    )
    .map((file) => ({ path: file.path, expectedSha256: file.afterSha256 }));
}

export function validateWriteLinkedLifecycleFiles(
  files: WriteLinkedLifecycleFile[],
): void {
  if (files.length < 1 || files.length > MAX_LIFECYCLE_FILES) {
    throw new Error("Write-linked lifecycle file count is invalid");
  }
  let previousPath: string | undefined;
  for (const file of files) {
    if (
      !file.path ||
      file.path.length > 500 ||
      sha256(file.path) !== file.pathSha256 ||
      !supportsWriteLinkedTests(file.path) ||
      (file.beforeSha256 !== null && !SHA256.test(file.beforeSha256)) ||
      (file.afterSha256 !== null && !SHA256.test(file.afterSha256)) ||
      (file.beforeSha256 === null && file.afterSha256 === null) ||
      file.beforeSha256 === file.afterSha256 ||
      (previousPath !== undefined && previousPath.localeCompare(file.path) >= 0)
    ) {
      throw new Error("Write-linked lifecycle file binding is invalid");
    }
    previousPath = file.path;
  }
}

export function writeLinkedLifecycleBindingSha256(
  files: WriteLinkedLifecycleFile[],
): string {
  return sha256(
    canonicalJson(
      files.map((file) => ({
        pathSha256: file.pathSha256,
        beforeSha256: file.beforeSha256,
        afterSha256: file.afterSha256,
      })),
    ),
  );
}

export function emptyWriteLinkedLifecycleDetails(
  files: WriteLinkedLifecycleFile[],
): WriteLinkedLifecycleSelection["details"] {
  return {
    changedFileCount: files.length,
    changedSymbolCount: 0,
    changedSymbolsTruncated: true,
    scannedFileCount: 0,
    configurationFileCount: 0,
    workspacePackageCount: 0,
    pathAliasCount: 0,
    workspacePackageEdgeCount: 0,
    pathAliasEdgeCount: 0,
    candidateTestCount: 0,
    selectedTestCount: 0,
    omittedTestCount: 0,
    unresolvedImportCount: 0,
    graphTruncated: true,
    changedFileSetSha256: writeLinkedLifecycleBindingSha256(files),
    changedSymbolSetSha256: EMPTY_SET_SHA256,
    dependencyGraphSha256: EMPTY_SET_SHA256,
    selectedTestSetSha256: EMPTY_SET_SHA256,
    selectionSnapshotSha256: EMPTY_SET_SHA256,
  };
}

function beforePresent(
  files: WriteLinkedLifecycleFile[],
): WriteLinkedChangedFile[] {
  return files
    .filter(
      (
        file,
      ): file is WriteLinkedLifecycleFile & {
        beforeSha256: string;
      } => file.beforeSha256 !== null,
    )
    .map((file) => ({ path: file.path, expectedSha256: file.beforeSha256 }));
}

function maximum(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function maximumEdgeCounts(selections: WriteLinkedTestSelection[]): {
  workspacePackage: number;
  pathAlias: number;
} {
  return selections.reduce(
    (selected, selection) => {
      const candidate = {
        workspacePackage: selection.workspacePackageEdgeCount,
        pathAlias: selection.pathAliasEdgeCount,
      };
      return candidate.workspacePackage + candidate.pathAlias >
        selected.workspacePackage + selected.pathAlias
        ? candidate
        : selected;
    },
    { workspacePackage: 0, pathAlias: 0 },
  );
}

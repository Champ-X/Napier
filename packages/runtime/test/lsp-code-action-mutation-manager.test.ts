import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  LspCodeActionApplyDetails,
  LspCodeActionsDetails,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { LspCodeActionMutationManager } from "../src/lsp-code-action-mutation-manager.js";
import type { LspCodeActionsResult } from "../src/lsp-code-actions.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { LspRenameCommitOutcome } from "../src/lsp-rename-commit.js";
import type { LspWorkspaceTextEditFile } from "../src/lsp-rename-workspace-edit.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP Code Action mutation manager", () => {
  it("applies one selected action and consumes every sibling preview", async () => {
    const fixture = await createFixture();
    const calls: string[] = [];
    let committedPreview = "";
    const manager = new LspCodeActionMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      tests: {
        async captureBefore() {
          calls.push("test-before");
          return { files: [] };
        },
        async run() {
          calls.push("test-run");
          return {
            details: linkedTestDetails(),
            summary: "Write-linked tests: no_match",
          };
        },
      },
      diagnostics: {
        async observeBefore() {
          calls.push("before");
          return { entries: [], omittedFileCount: 0 };
        },
        async observeAfter() {
          calls.push("after");
          return {
            details: diagnosticsDetails(),
            summary: "Code Action diagnostics: clean",
          };
        },
        unavailable() {
          throw new Error("must not execute");
        },
      },
      async commit(options) {
        calls.push("commit");
        committedPreview = options.sourcePreviewResultSha256;
        return commitOutcome(
          fixture.result,
          options.files[0]!.edits[0]!.newText,
        );
      },
    });
    const previews = manager.storePreviews(fixture.result);

    const applied = await manager.apply(previews[0]!.id);

    expect(previews).toHaveLength(2);
    expect(previews[0]!.actionSha256).toBe(
      fixture.result.actions[0]!.actionSha256,
    );
    expect(calls).toEqual([
      "test-before",
      "before",
      "commit",
      "after",
      "test-run",
    ]);
    expect(committedPreview).toBe(fixture.result.details.resultSha256);
    expect(applied.details).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-code-action-apply",
        status: "applied",
        postcondition: "verified",
        sourcePreviewResultSha256: fixture.result.details.resultSha256,
        sourceActionSha256: fixture.result.actions[0]!.actionSha256,
        sourceResolved: true,
        sourceCommandIgnored: true,
        commandPolicy: "deny_all",
        diagnostics: expect.objectContaining({
          kind: "napier.lsp-code-action-apply-diagnostics",
          status: "clean",
        }),
        tests: expect.objectContaining({ status: "no_match" }),
      }),
    );
    expect(applied.summary).toContain("LSP Code Action apply: applied");
    expect(applied.summary).toContain("command remained denied");
    await expect(manager.apply(previews[1]!.id)).rejects.toThrow(
      "preview not found",
    );
    expect(JSON.stringify(applied)).not.toContain("PRIVATE_ACTION");
  });

  it("consumes the selected preview before preflight cancellation", async () => {
    const fixture = await createFixture();
    let calls = 0;
    const manager = new LspCodeActionMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      diagnostics: {
        async observeBefore() {
          calls += 1;
          throw new Error("must not execute");
        },
        async observeAfter() {
          calls += 1;
          throw new Error("must not execute");
        },
        unavailable() {
          throw new Error("must not execute");
        },
      },
      async commit() {
        calls += 1;
        throw new Error("must not execute");
      },
    });
    const previews = manager.storePreviews(fixture.result);
    const controller = new AbortController();
    controller.abort();

    await expect(
      manager.apply(previews[0]!.id, controller.signal),
    ).rejects.toThrow("aborted before commit");
    await expect(manager.apply(previews[0]!.id)).rejects.toThrow(
      "preview not found",
    );
    await expect(manager.apply(previews[1]!.id)).rejects.toThrow(
      "preview not found",
    );
    expect(calls).toBe(0);
  });

  it("does not overwrite workspace drift and consumes the alternative group", async () => {
    const fixture = await createFixture();
    const drifted = "export const externalDrift = 2;\n";
    const manager = new LspCodeActionMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      diagnostics: {
        async observeBefore() {
          return { entries: [], omittedFileCount: 0 };
        },
        async observeAfter() {
          throw new Error("must not execute");
        },
        unavailable() {
          throw new Error("must not execute");
        },
      },
    });
    const previews = manager.storePreviews(fixture.result);
    await writeFile(path.join(fixture.workspaceRoot, "source.ts"), drifted);

    await expect(manager.apply(previews[0]!.id)).rejects.toThrow(
      "preview is stale",
    );
    await expect(manager.apply(previews[1]!.id)).rejects.toThrow(
      "preview not found",
    );
    expect(
      await readFile(path.join(fixture.workspaceRoot, "source.ts"), "utf8"),
    ).toBe(drifted);
  });

  it("mints apply capabilities only for authorized alternatives", async () => {
    const fixture = await createFixture();
    const unsafe = fixture.result.actions[1]!.files[0]!;
    unsafe.path = "outside.ts";
    unsafe.pathSha256 = sha256(unsafe.path);
    for (const edit of unsafe.edits) {
      edit.path = unsafe.path;
      edit.pathSha256 = unsafe.pathSha256;
    }
    const manager = new LspCodeActionMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      authorizeFiles: (files) =>
        files.every((file) => file.path === "source.ts"),
      diagnostics: {
        async observeBefore() {
          throw new Error("must not execute");
        },
        async observeAfter() {
          throw new Error("must not execute");
        },
        unavailable() {
          throw new Error("must not execute");
        },
      },
    });

    const previews = manager.storePreviews(fixture.result);

    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual(
      expect.objectContaining({
        actionIndex: 0,
        actionSha256: fixture.result.actions[0]!.actionSha256,
      }),
    );
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
  result: LspCodeActionsResult;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-action-manager-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const source = "export const currentName = 1;\n";
  await writeFile(path.join(workspaceRoot, "source.ts"), source);
  const first = actionFile(source, "canonicalName");
  const second = actionFile(source, "alternateName");
  return {
    workspaceRoot,
    dataRoot,
    result: {
      relativePath: "source.ts",
      actions: [
        {
          actionSha256: "1".repeat(64),
          title: "PRIVATE_ACTION_ONE",
          kind: "quickfix",
          isPreferred: true,
          commandIgnored: true,
          resolved: true,
          files: [first],
        },
        {
          actionSha256: "2".repeat(64),
          title: "PRIVATE_ACTION_TWO",
          kind: "quickfix",
          isPreferred: false,
          commandIgnored: false,
          resolved: false,
          files: [second],
        },
      ],
      details: codeActionDetails(workspaceRoot, source),
    },
  };
}

function actionFile(source: string, newText: string): LspWorkspaceTextEditFile {
  return {
    path: "source.ts",
    pathSha256: sha256("source.ts"),
    fileSha256: sha256(source),
    edits: [
      {
        path: "source.ts",
        pathSha256: sha256("source.ts"),
        fileSha256: sha256(source),
        startLine: 1,
        startCharacter: 14,
        endLine: 1,
        endCharacter: 25,
        rangeSha256: sha256(
          canonicalJson({
            startLine: 1,
            startCharacter: 14,
            endLine: 1,
            endCharacter: 25,
          }),
        ),
        oldText: "currentName",
        oldTextSha256: sha256("currentName"),
        newText,
        newTextSha256: sha256(newText),
      },
    ],
  };
}

function codeActionDetails(
  workspaceRoot: string,
  source: string,
): LspCodeActionsDetails {
  return {
    kind: "napier.lsp-code-actions",
    schemaVersion: 2,
    status: "found",
    complete: true,
    truncated: false,
    language: "typescript",
    sandbox: "test",
    workspaceAccess: "read_only",
    networkAccess: "denied",
    workspaceRootSha256: sha256(workspaceRoot),
    sourcePathSha256: sha256("source.ts"),
    sourceFileSha256: sha256(source),
    sourceFileBytes: Buffer.byteLength(source),
    positionSha256: "4".repeat(64),
    diagnosticCount: 1,
    actionCount: 2,
    omittedActionCount: 0,
    preferredActionCount: 1,
    commandIgnoredCount: 1,
    resolveSupported: true,
    resolveRequestCount: 1,
    resolvedActionCount: 1,
    resolveOmittedCount: 0,
    commandPolicy: "deny_all",
    fileCount: 1,
    editCount: 2,
    previewBytes: 44,
    diagnosticSetSha256: "5".repeat(64),
    actionSetSha256: "6".repeat(64),
    targetFileSetSha256: "7".repeat(64),
    nodeExecutableSha256: "8".repeat(64),
    languageServerVersion: "5.3.0",
    languageServerSha256: "9".repeat(64),
    typescriptVersion: "5.9.3",
    typescriptServerSha256: "a".repeat(64),
    environmentSha256: "b".repeat(64),
    resourceLimitsSha256: "c".repeat(64),
    timeoutMs: 10_000,
    durationMs: 10,
    protocolBytes: 100,
    stderrChars: 0,
    stderrSha256: sha256(""),
    stderrTruncated: false,
    resultSha256: "d".repeat(64),
  };
}

function commitOutcome(
  result: LspCodeActionsResult,
  newText: string,
): LspRenameCommitOutcome {
  return {
    status: "applied",
    postcondition: "verified",
    sourcePreviewResultSha256: result.details.resultSha256,
    planSha256: "e".repeat(64),
    fileCount: 1,
    editCount: 1,
    committedFileCount: 1,
    restoredFileCount: 0,
    recoveryArtifactCount: 0,
    rollbackAttempted: false,
    rollbackVerified: false,
    durable: true,
    cancellationObserved: false,
    beforeFileSetSha256: "f".repeat(64),
    expectedFileSetSha256: "0".repeat(64),
    observedFileSetSha256: "0".repeat(64),
    resourceLimitsSha256: "1".repeat(64),
    expectedFiles: [
      {
        path: "source.ts",
        pathSha256: sha256("source.ts"),
        beforeSha256: result.details.sourceFileSha256,
        expectedSha256: sha256(`export const ${newText} = 1;\n`),
      },
    ],
  };
}

function diagnosticsDetails(): NonNullable<
  LspCodeActionApplyDetails["diagnostics"]
> {
  return {
    kind: "napier.lsp-code-action-apply-diagnostics",
    schemaVersion: 1,
    status: "clean",
    fileCount: 1,
    omittedFileCount: 0,
    beforeDiagnosticCount: 1,
    afterDiagnosticCount: 0,
    beforeErrorCount: 1,
    afterErrorCount: 0,
    beforeWarningCount: 0,
    afterWarningCount: 0,
    introducedCount: 0,
    resolvedCount: 1,
    unchangedCount: 0,
    truncated: false,
    beforeResultSetSha256: "2".repeat(64),
    afterResultSetSha256: "3".repeat(64),
    deltaSetSha256: "4".repeat(64),
    durationMs: 20,
    resultSha256: "5".repeat(64),
  };
}

function linkedTestDetails(): NonNullable<LspCodeActionApplyDetails["tests"]> {
  return {
    kind: "napier.write-linked-test-verification",
    schemaVersion: 1,
    status: "no_match",
    changedFileCount: 1,
    changedSymbolCount: 1,
    changedSymbolsTruncated: false,
    scannedFileCount: 2,
    candidateTestCount: 0,
    selectedTestCount: 0,
    omittedTestCount: 0,
    unresolvedImportCount: 0,
    graphTruncated: false,
    changedFileSetSha256: "6".repeat(64),
    changedSymbolSetSha256: "7".repeat(64),
    dependencyGraphSha256: "8".repeat(64),
    selectedTestSetSha256: "9".repeat(64),
    selectionSnapshotSha256: "a".repeat(64),
    durationMs: 5,
    resultSha256: "b".repeat(64),
  };
}

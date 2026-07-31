import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LspRenameApplyDetails } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import type { LspRenameCommitOutcome } from "../src/lsp-rename-commit.js";
import {
  LSP_RENAME_APPLY_PREVIEW_TTL_MS,
  LspRenameMutationManager,
} from "../src/lsp-rename-mutation-manager.js";
import type { LspRenameResult } from "../src/lsp-rename.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP rename mutation manager", () => {
  it("consumes a preview once and binds diagnostics to the committed output", async () => {
    const fixture = await createFixture();
    const calls: string[] = [];
    const manager = new LspRenameMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      diagnostics: {
        async observeBefore() {
          calls.push("before");
          return { entries: [], omittedFileCount: 0 };
        },
        async observeAfter() {
          calls.push("after");
          return {
            details: diagnosticsDetails(),
            summary: "Rename diagnostics: clean",
          };
        },
      },
      async commit() {
        calls.push("commit");
        return commitOutcome(fixture.result);
      },
    });
    const preview = manager.storePreview(fixture.result)!;

    const applied = await manager.apply(preview.id);

    expect(calls).toEqual(["before", "commit", "after"]);
    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        diagnostics: expect.objectContaining({ status: "clean" }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "preview not found",
    );
  });

  it("reports expiration distinctly and does not invoke diagnostics or commit", async () => {
    const fixture = await createFixture();
    let now = new Date("2026-07-31T00:00:00.000Z");
    let calls = 0;
    const manager = new LspRenameMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      now: () => now,
      diagnostics: {
        async observeBefore() {
          calls += 1;
          throw new Error("must not execute");
        },
        async observeAfter() {
          calls += 1;
          throw new Error("must not execute");
        },
      },
      async commit() {
        calls += 1;
        throw new Error("must not execute");
      },
    });
    const preview = manager.storePreview(fixture.result)!;
    now = new Date(now.getTime() + LSP_RENAME_APPLY_PREVIEW_TTL_MS + 1);

    await expect(manager.apply(preview.id)).rejects.toThrow("preview expired");
    expect(calls).toBe(0);
  });

  it("keeps a committed result visible when post-write diagnostics fail", async () => {
    const fixture = await createFixture();
    const manager = new LspRenameMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      diagnostics: {
        async observeBefore() {
          return {
            entries: [
              {
                path: "source.ts",
                pathSha256: sha256("source.ts"),
                result: {
                  details: {
                    diagnosticCount: 0,
                    errorCount: 0,
                    warningCount: 0,
                    durationMs: 10,
                    resultSha256: "1".repeat(64),
                  },
                },
              },
            ],
            omittedFileCount: 0,
          } as never;
        },
        async observeAfter() {
          throw new Error("PRIVATE_POSTFLIGHT_FAILURE");
        },
      },
      async commit() {
        return commitOutcome(fixture.result);
      },
    });
    const preview = manager.storePreview(fixture.result)!;

    const applied = await manager.apply(preview.id);

    expect(applied.details).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        diagnostics: expect.objectContaining({
          status: "unavailable",
          errorSha256: sha256("PRIVATE_POSTFLIGHT_FAILURE"),
        }),
      }),
    );
    expect(JSON.stringify(applied.details)).not.toContain("PRIVATE");
  });

  it("fails a timed-out diagnostics preflight before invoking commit", async () => {
    const fixture = await createFixture();
    let commits = 0;
    const manager = new LspRenameMutationManager({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
      diagnostics: {
        async observeBefore() {
          throw new Error("LSP rename diagnostics timed out");
        },
        async observeAfter() {
          throw new Error("must not execute");
        },
      },
      async commit() {
        commits += 1;
        return commitOutcome(fixture.result);
      },
    });
    const preview = manager.storePreview(fixture.result)!;

    await expect(manager.apply(preview.id)).rejects.toThrow("timed out");
    expect(commits).toBe(0);
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "preview not found",
    );
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
  result: LspRenameResult;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rename-manager-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const source = "export const currentName = 1;\n";
  await writeFile(path.join(workspaceRoot, "source.ts"), source);
  return {
    workspaceRoot,
    dataRoot,
    result: {
      relativePath: "source.ts",
      files: [
        {
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
              rangeSha256: "1".repeat(64),
              oldText: "currentName",
              oldTextSha256: sha256("currentName"),
              newText: "canonicalName",
              newTextSha256: sha256("canonicalName"),
            },
          ],
        },
      ],
      details: {
        kind: "napier.lsp-rename",
        schemaVersion: 1,
        status: "found",
        complete: true,
        language: "typescript",
        sandbox: "test",
        workspaceAccess: "read_only",
        networkAccess: "denied",
        workspaceRootSha256: sha256(workspaceRoot),
        sourcePathSha256: sha256("source.ts"),
        sourceFileSha256: sha256(source),
        sourceFileBytes: Buffer.byteLength(source),
        positionSha256: "2".repeat(64),
        newNameSha256: sha256("canonicalName"),
        prepareResultSha256: "3".repeat(64),
        fileCount: 1,
        editCount: 1,
        previewBytes: 24,
        editSetSha256: "4".repeat(64),
        targetFileSetSha256: "5".repeat(64),
        nodeExecutableSha256: "6".repeat(64),
        languageServerVersion: "5.3.0",
        languageServerSha256: "7".repeat(64),
        typescriptVersion: "5.9.3",
        typescriptServerSha256: "8".repeat(64),
        environmentSha256: "9".repeat(64),
        resourceLimitsSha256: "a".repeat(64),
        timeoutMs: 10_000,
        durationMs: 10,
        protocolBytes: 100,
        stderrChars: 0,
        stderrSha256: sha256(""),
        stderrTruncated: false,
        resultSha256: "b".repeat(64),
      },
    },
  };
}

function commitOutcome(result: LspRenameResult): LspRenameCommitOutcome {
  const expected = sha256("export const canonicalName = 1;\n");
  return {
    status: "applied",
    postcondition: "verified",
    sourcePreviewResultSha256: result.details.resultSha256,
    planSha256: "c".repeat(64),
    fileCount: 1,
    editCount: 1,
    committedFileCount: 1,
    restoredFileCount: 0,
    recoveryArtifactCount: 0,
    rollbackAttempted: false,
    rollbackVerified: false,
    durable: true,
    cancellationObserved: false,
    beforeFileSetSha256: "d".repeat(64),
    expectedFileSetSha256: "e".repeat(64),
    observedFileSetSha256: "e".repeat(64),
    resourceLimitsSha256: "f".repeat(64),
    expectedFiles: [
      {
        path: "source.ts",
        pathSha256: sha256("source.ts"),
        beforeSha256: result.details.sourceFileSha256,
        expectedSha256: expected,
      },
    ],
  };
}

function diagnosticsDetails(): NonNullable<
  LspRenameApplyDetails["diagnostics"]
> {
  return {
    kind: "napier.lsp-rename-apply-diagnostics",
    schemaVersion: 1,
    status: "clean",
    fileCount: 1,
    omittedFileCount: 0,
    beforeDiagnosticCount: 0,
    afterDiagnosticCount: 0,
    beforeErrorCount: 0,
    afterErrorCount: 0,
    beforeWarningCount: 0,
    afterWarningCount: 0,
    introducedCount: 0,
    resolvedCount: 0,
    unchangedCount: 0,
    truncated: false,
    beforeResultSetSha256: "1".repeat(64),
    afterResultSetSha256: "2".repeat(64),
    deltaSetSha256: "3".repeat(64),
    durationMs: 20,
    resultSha256: "4".repeat(64),
  };
}

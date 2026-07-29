import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Tool event trace view", () => {
  it("projects bounded tool metadata without raw input or output", () => {
    const event = toolEvent("tool.completed", {
      callId: "call_secret",
      toolName: "read_file",
      status: "completed",
      effect: "read",
      input: { path: "TOP_SECRET_PATH" },
      output: "TOP_SECRET_OUTPUT",
      details: { content: "TOP_SECRET_DETAILS" },
      summary: "TOP_SECRET_SUMMARY",
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_file",
      status: "completed",
      effect: "read",
    });
    expect(toolEventTraceSummary(event)).toBe(
      "tool / read_file / completed / effect read",
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("defaults status from the event type and includes hash-only receipts", () => {
    const event = toolEvent("tool.blocked", {
      toolName: "read_file",
      inputSha256: "a".repeat(64),
      loopGuardTriggerSha256: "b".repeat(64),
      policyReason: "TOP_SECRET_POLICY_REASON",
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_file",
      status: "blocked",
      inputSha256: "a".repeat(64),
      loopGuardTriggerSha256: "b".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / read_file / blocked / input ${"a".repeat(12)} / loop ${"b".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes list_files entry evidence without listed paths", () => {
    const event = toolEvent("tool.completed", {
      toolName: "list_files",
      status: "completed",
      output: "TOP_SECRET_FILE\nTOP_SECRET_DIR",
      details: {
        count: 2,
        truncated: true,
        pathSha256: "c".repeat(64),
        entrySetSha256: "d".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "list_files",
      status: "completed",
      listCount: 2,
      listTruncated: true,
      listPathSha256: "c".repeat(64),
      listEntrySetSha256: "d".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / list_files / completed / entries 2 / entries-truncated / list-path ${"c".repeat(12)} / entry-set ${"d".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes read_file hash evidence without path or content", () => {
    const event = toolEvent("tool.completed", {
      toolName: "read_file",
      status: "completed",
      output: "TOP_SECRET_FILE_CONTENT",
      details: {
        path: "TOP_SECRET_PATH",
        pathSha256: "c".repeat(64),
        sha256: "d".repeat(64),
        startLine: 2,
        endLine: 4,
        totalLines: 20,
        sizeBytes: 120,
        truncated: true,
        lineAnchorsTruncated: true,
        lineAnchorSetSha256: "e".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_file",
      status: "completed",
      readStartLine: 2,
      readEndLine: 4,
      readTotalLines: 20,
      readPathSha256: "c".repeat(64),
      readFileSha256: "d".repeat(64),
      readSizeBytes: 120,
      readTruncated: true,
      readLineAnchorsTruncated: true,
      readLineAnchorSetSha256: "e".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / read_file / completed / range 2-4 / lines 20 / size 120 / read-truncated / anchors-truncated / read-path ${"c".repeat(12)} / file ${"d".repeat(12)} / anchor-set ${"e".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes search_files hash evidence without match text", () => {
    const event = toolEvent("tool.completed", {
      toolName: "search_files",
      status: "completed",
      output: "TOP_SECRET_MATCH_LINE",
      details: {
        count: 2,
        truncated: true,
        matchSetSha256: "c".repeat(64),
        matches: [
          {
            path: "TOP_SECRET_PATH",
            line: 7,
            lineSha256: "d".repeat(64),
            fileSha256: "e".repeat(64),
          },
        ],
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "search_files",
      status: "completed",
      searchMatchCount: 2,
      searchTruncated: true,
      searchMatchSetSha256: "c".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / search_files / completed / matches 2 / truncated / match-set ${"c".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes list_symbols receipts without paths or symbol names", () => {
    const event = toolEvent("tool.completed", {
      toolName: "list_symbols",
      status: "completed",
      output: "TOP_SECRET_SYMBOL_NAME TOP_SECRET_SIGNATURE",
      details: {
        path: "TOP_SECRET_ROOT",
        pathSha256: "a".repeat(64),
        fileCount: 3,
        skippedFileCount: 1,
        symbolCount: 9,
        totalLines: 128,
        sizeBytes: 4096,
        truncated: true,
        languageCounts: { typescript: 2, python: 1 },
        languageCountsSha256: "b".repeat(64),
        fileSetSha256: "c".repeat(64),
        symbolSetSha256: "d".repeat(64),
        symbols: [
          {
            path: "TOP_SECRET_PATH",
            name: "TOP_SECRET_SYMBOL",
            signaturePreview: "TOP_SECRET_SIGNATURE",
          },
        ],
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "list_symbols",
      status: "completed",
      symbolIndexFileCount: 3,
      symbolIndexSkippedFileCount: 1,
      symbolIndexSymbolCount: 9,
      symbolIndexTotalLines: 128,
      symbolIndexSizeBytes: 4096,
      symbolIndexTruncated: true,
      symbolIndexPathSha256: "a".repeat(64),
      symbolIndexLanguageCountsSha256: "b".repeat(64),
      symbolIndexFileSetSha256: "c".repeat(64),
      symbolIndexSymbolSetSha256: "d".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / list_symbols / completed / indexed-files 3 / skipped-files 1 / indexed-symbols 9 / indexed-lines 128 / indexed-size 4096 / symbol-index-truncated / symbol-root ${"a".repeat(12)} / language-counts ${"b".repeat(12)} / symbol-files ${"c".repeat(12)} / symbol-set ${"d".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes inspect_data receipts without columns or sample rows", () => {
    const event = toolEvent("tool.completed", {
      toolName: "inspect_data",
      status: "completed",
      output: "TOP_SECRET_SAMPLE_VALUE",
      details: {
        path: "TOP_SECRET_DATA_PATH",
        format: "markdown_table",
        sha256: "a".repeat(64),
        pathSha256: "b".repeat(64),
        sizeBytes: 256,
        rowCount: 42,
        columnCount: 3,
        truncated: true,
        columns: ["TOP_SECRET_COLUMN"],
        columnSetSha256: "c".repeat(64),
        sampleSha256: "d".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "inspect_data",
      status: "completed",
      dataFormat: "markdown_table",
      dataRowCount: 42,
      dataColumnCount: 3,
      dataSizeBytes: 256,
      dataTruncated: true,
      dataPathSha256: "b".repeat(64),
      dataFileSha256: "a".repeat(64),
      dataColumnSetSha256: "c".repeat(64),
      dataSampleSha256: "d".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / inspect_data / completed / data Markdown table / rows 42 / columns 3 / size 256 / data-truncated / data-path ${"b".repeat(12)} / data-file ${"a".repeat(12)} / column-set ${"c".repeat(12)} / sample ${"d".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes inspect_code receipts without symbol names or signatures", () => {
    const event = toolEvent("tool.completed", {
      toolName: "inspect_code",
      status: "completed",
      output: "TOP_SECRET_SYMBOL_SIGNATURE",
      details: {
        path: "TOP_SECRET_SOURCE_PATH",
        language: "typescript",
        sha256: "a".repeat(64),
        pathSha256: "b".repeat(64),
        sizeBytes: 512,
        totalLines: 88,
        symbolCount: 7,
        truncated: true,
        symbols: [
          {
            name: "TOP_SECRET_SYMBOL",
            signaturePreview: "TOP_SECRET_SIGNATURE",
          },
        ],
        symbolSetSha256: "c".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "inspect_code",
      status: "completed",
      codeLanguage: "typescript",
      codeSymbolCount: 7,
      codeTotalLines: 88,
      codeSizeBytes: 512,
      codeTruncated: true,
      codePathSha256: "b".repeat(64),
      codeFileSha256: "a".repeat(64),
      codeSymbolSetSha256: "c".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / inspect_code / completed / code typescript / symbols 7 / lines 88 / size 512 / code-truncated / code-path ${"b".repeat(12)} / code-file ${"a".repeat(12)} / symbol-set ${"c".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes read_symbol receipts without source or symbol names", () => {
    const event = toolEvent("tool.completed", {
      toolName: "read_symbol",
      status: "completed",
      output: "TOP_SECRET_SOURCE\nTOP_SECRET_SYMBOL",
      details: {
        path: "TOP_SECRET_PATH",
        pathSha256: "a".repeat(64),
        language: "typescript",
        sha256: "b".repeat(64),
        sizeBytes: 512,
        totalLines: 88,
        startLine: 10,
        endLine: 22,
        symbolLine: 10,
        symbolKind: "class",
        symbolName: "TOP_SECRET_SYMBOL",
        symbolNameSha256: "c".repeat(64),
        lineSha256: "d".repeat(64),
        signaturePreview: "TOP_SECRET_SIGNATURE",
        signatureSha256: "e".repeat(64),
        rangeSha256: "f".repeat(64),
        observedLineCount: 13,
        truncated: true,
        lineAnchorSetSha256: "1".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_symbol",
      status: "completed",
      symbolSourceKind: "class",
      symbolSourceStartLine: 10,
      symbolSourceEndLine: 22,
      symbolSourceLine: 10,
      symbolSourceObservedLineCount: 13,
      symbolSourceSizeBytes: 512,
      symbolSourceTruncated: true,
      symbolSourcePathSha256: "a".repeat(64),
      symbolSourceFileSha256: "b".repeat(64),
      symbolSourceNameSha256: "c".repeat(64),
      symbolSourceLineSha256: "d".repeat(64),
      symbolSourceSignatureSha256: "e".repeat(64),
      symbolSourceRangeSha256: "f".repeat(64),
      symbolSourceLineAnchorSetSha256: "1".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / read_symbol / completed / symbol class / symbol-range 10-22 / symbol-line 10 / symbol-lines 13 / symbol-size 512 / symbol-truncated / symbol-path ${"a".repeat(12)} / symbol-file ${"b".repeat(12)} / symbol-name ${"c".repeat(12)} / symbol-line-hash ${"d".repeat(12)} / signature ${"e".repeat(12)} / symbol-source ${"f".repeat(12)} / symbol-anchors ${"1".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes verify_workspace status and output hashes only", () => {
    const event = toolEvent("tool.completed", {
      toolName: "verify_workspace",
      status: "completed",
      output: "TOP_SECRET_STDOUT\nTOP_SECRET_STDERR",
      details: {
        kind: "typecheck",
        status: "failed",
        sandbox: "TOP_SECRET_SANDBOX",
        cwd: "TOP_SECRET_CWD",
        target: "TOP_SECRET_TARGET",
        exitCode: 2,
        scopeSha256: "a".repeat(64),
        cwdPathSha256: "b".repeat(64),
        targetPathSha256: "c".repeat(64),
        targetSnapshotSha256: "f".repeat(64),
        targetSnapshotTruncated: true,
        verifierSha256: "1".repeat(64),
        workspaceSnapshotSha256: "2".repeat(64),
        workspaceSnapshotFileCount: 7,
        workspaceSnapshotBytes: 4096,
        workspaceSnapshotTruncated: true,
        stdoutSha256: "d".repeat(64),
        stderrSha256: "e".repeat(64),
        stdoutTruncated: true,
        stderrTruncated: false,
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "verify_workspace",
      status: "completed",
      verificationKind: "typecheck",
      verificationStatus: "failed",
      verificationExitCode: 2,
      verificationScopeSha256: "a".repeat(64),
      verificationCwdPathSha256: "b".repeat(64),
      verificationTargetPathSha256: "c".repeat(64),
      verificationTargetSnapshotSha256: "f".repeat(64),
      verificationTargetSnapshotTruncated: true,
      verificationVerifierSha256: "1".repeat(64),
      verificationWorkspaceSnapshotSha256: "2".repeat(64),
      verificationWorkspaceSnapshotFileCount: 7,
      verificationWorkspaceSnapshotBytes: 4096,
      verificationWorkspaceSnapshotTruncated: true,
      verificationStdoutSha256: "d".repeat(64),
      verificationStderrSha256: "e".repeat(64),
      verificationStdoutTruncated: true,
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / verify_workspace / completed / verification typecheck failed / exit 2 / scope ${"a".repeat(12)} / cwd ${"b".repeat(12)} / target ${"c".repeat(12)} / target-snapshot ${"f".repeat(12)} / target-snapshot-truncated / verifier ${"1".repeat(12)} / snapshot-files 7 / snapshot-bytes 4096 / snapshot-truncated / workspace-snapshot ${"2".repeat(12)} / stdout ${"d".repeat(12)} / stderr ${"e".repeat(12)} / stdout-truncated`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes apply_patch write evidence without path or patch text", () => {
    const event = toolEvent("tool.completed", {
      toolName: "apply_patch",
      status: "completed",
      output: "Updated TOP_SECRET_PATH with TOP_SECRET_PATCH",
      details: {
        path: "TOP_SECRET_PATH",
        pathSha256: "1".repeat(64),
        operation: "hashrange_replace",
        beforeSha256: "2".repeat(64),
        afterSha256: "3".repeat(64),
        beforeBytes: 42,
        afterBytes: 45,
        editCount: 1,
        createdParentDirectoryCount: 2,
        createdParentDirectorySetSha256: "4".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "apply_patch",
      status: "completed",
      patchOperation: "hashrange_replace",
      patchPathSha256: "1".repeat(64),
      patchBeforeSha256: "2".repeat(64),
      patchAfterSha256: "3".repeat(64),
      patchBeforeBytes: 42,
      patchAfterBytes: 45,
      patchEditCount: 1,
      patchCreatedParentDirectoryCount: 2,
      patchCreatedParentDirectorySetSha256: "4".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / apply_patch / completed / patch hashrange_replace / edits 1 / bytes 42->45 / path ${"1".repeat(12)} / before ${"2".repeat(12)} / after ${"3".repeat(12)} / created-dirs 2 / created-dir-set ${"4".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed to a fixed summary for malformed tool receipts", () => {
    const event = toolEvent("tool.failed", {
      toolName: "bad tool name",
      status: "failed",
      error: "TOP_SECRET_ERROR",
      result: "TOP_SECRET_RESULT",
    });

    expect(toolEventTraceView(event)).toBeUndefined();
    expect(toolEventTraceSummary(event)).toBe("tool receipt");
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });
});

function toolEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_tool",
    threadId: "thread_tool",
    runId: "runctl_tool",
    seq: 9,
    type,
    category: "tool",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}

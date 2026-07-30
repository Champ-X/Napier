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

  it("summarizes sandbox command evidence without argv or output", () => {
    const event = toolEvent("tool.completed", {
      toolName: "run_command",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_COMMAND_OUTPUT",
      details: {
        runtime: "node",
        status: "succeeded",
        workspaceAccess: "read_only",
        networkAccess: "denied",
        argumentCount: 2,
        exitCode: 0,
        timeoutMs: 30_000,
        outputLimitChars: 32_000,
        commandSha256: "a".repeat(64),
        resultSha256: "0".repeat(64),
        executableSha256: "b".repeat(64),
        argumentSetSha256: "c".repeat(64),
        environmentSha256: "d".repeat(64),
        resourceLimitsSha256: "e".repeat(64),
        cwdPathSha256: "f".repeat(64),
        stdoutSha256: "1".repeat(64),
        stderrSha256: "2".repeat(64),
        stdoutTruncated: true,
        rawArgs: ["TOP_SECRET_COMMAND_ARGUMENT"],
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "run_command",
      status: "completed",
      effect: "read",
      commandRuntime: "node",
      commandStatus: "succeeded",
      commandArgumentCount: 2,
      commandExitCode: 0,
      commandTimeoutMs: 30_000,
      commandOutputLimitChars: 32_000,
      commandWorkspaceAccess: "read_only",
      commandNetworkAccess: "denied",
      commandSha256: "a".repeat(64),
      commandResultSha256: "0".repeat(64),
      commandExecutableSha256: "b".repeat(64),
      commandArgumentSetSha256: "c".repeat(64),
      commandEnvironmentSha256: "d".repeat(64),
      commandResourceLimitsSha256: "e".repeat(64),
      commandCwdPathSha256: "f".repeat(64),
      commandStdoutSha256: "1".repeat(64),
      commandStderrSha256: "2".repeat(64),
      commandStdoutTruncated: true,
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / run_command / completed / effect read / command node succeeded / args 2 / exit 0 / timeout 30000ms / output-limit 32000 / workspace read_only / network denied / command ${"a".repeat(12)} / result ${"0".repeat(12)} / executable ${"b".repeat(12)} / argv ${"c".repeat(12)} / environment ${"d".repeat(12)} / limits ${"e".repeat(12)} / cwd ${"f".repeat(12)} / stdout ${"1".repeat(12)} / stderr ${"2".repeat(12)} / stdout-truncated`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes JavaScript kernel evidence without code or values", () => {
    const event = toolEvent("tool.completed", {
      toolName: "javascript_kernel",
      status: "completed",
      effect: "write",
      output: "PRIVATE_KERNEL_VALUE",
      details: {
        kind: "napier.javascript-kernel",
        schemaVersion: 1,
        action: "evaluate",
        processId: "process_12345678901234567890",
        processStatus: "running",
        evaluationStatus: "ok",
        terminal: false,
        valueType: "number",
        preview: "PRIVATE_KERNEL_VALUE",
        previewTruncated: false,
        console: ["PRIVATE_KERNEL_CONSOLE"],
        consoleCount: 1,
        consoleTruncated: false,
        durationMs: 12,
        requestSha256: "1".repeat(64),
        workerSha256: "2".repeat(64),
        resultSha256: "3".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "javascript_kernel",
      status: "completed",
      effect: "write",
      javascriptKernelAction: "evaluate",
      javascriptKernelProcessId: "process_12345678901234567890",
      javascriptKernelProcessStatus: "running",
      javascriptKernelEvaluationStatus: "ok",
      javascriptKernelTerminal: false,
      javascriptKernelValueType: "number",
      javascriptKernelConsoleCount: 1,
      javascriptKernelDurationMs: 12,
      javascriptKernelRequestSha256: "1".repeat(64),
      javascriptKernelWorkerSha256: "2".repeat(64),
      javascriptKernelResultSha256: "3".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / javascript_kernel / completed / effect write / javascript-kernel evaluate / kernel-process running / kernel-result ok / kernel-type number / kernel-console 1 / kernel-ms 12 / kernel-request ${"1".repeat(12)} / kernel-worker ${"2".repeat(12)} / kernel-result ${"3".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("PRIVATE_KERNEL");
  });

  it("summarizes Python kernel evidence without code or values", () => {
    const event = toolEvent("tool.completed", {
      toolName: "python_kernel",
      status: "completed",
      effect: "write",
      output: "PRIVATE_PYTHON_OUTPUT",
      details: {
        kind: "napier.python-kernel",
        schemaVersion: 1,
        action: "evaluate",
        processId: "process_12345678901234567890",
        processStatus: "running",
        evaluationStatus: "ok",
        terminal: false,
        valueType: "integer",
        previewTruncated: false,
        consoleCount: 1,
        consoleTruncated: false,
        durationMs: 9,
        pythonVersion: "3.9.6",
        memoryPeakBytes: 12_345,
        memoryLimitBytes: 33_554_432,
        requestSha256: "1".repeat(64),
        workerSha256: "2".repeat(64),
        runtimeExecutableSha256: "3".repeat(64),
        runtimeCommandSha256: "4".repeat(64),
        resultSha256: "5".repeat(64),
        code: "PRIVATE_PYTHON_CODE",
        preview: "PRIVATE_PYTHON_VALUE",
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "python_kernel",
      status: "completed",
      effect: "write",
      pythonKernelAction: "evaluate",
      pythonKernelProcessId: "process_12345678901234567890",
      pythonKernelProcessStatus: "running",
      pythonKernelEvaluationStatus: "ok",
      pythonKernelTerminal: false,
      pythonKernelValueType: "integer",
      pythonKernelConsoleCount: 1,
      pythonKernelDurationMs: 9,
      pythonKernelVersion: "3.9.6",
      pythonKernelMemoryPeakBytes: 12_345,
      pythonKernelMemoryLimitBytes: 33_554_432,
      pythonKernelRequestSha256: "1".repeat(64),
      pythonKernelWorkerSha256: "2".repeat(64),
      pythonKernelRuntimeExecutableSha256: "3".repeat(64),
      pythonKernelRuntimeCommandSha256: "4".repeat(64),
      pythonKernelResultSha256: "5".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / python_kernel / completed / effect write / python-kernel evaluate / py-process running / py-result ok / py-type integer / py-console 1 / py-ms 9 / python 3.9.6 / py-memory 12345/33554432 / py-request ${"1".repeat(12)} / py-worker ${"2".repeat(12)} / py-runtime ${"3".repeat(12)} / py-command ${"4".repeat(12)} / py-result-hash ${"5".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("PRIVATE_PYTHON");
  });

  it("summarizes TypeScript AST evidence without paths, names, or source", () => {
    const query = toolEvent("tool.completed", {
      toolName: "ast_query",
      status: "completed",
      effect: "read",
      output: "PRIVATE_AST_SOURCE",
      details: {
        kind: "napier.typescript-ast",
        schemaVersion: 1,
        action: "query",
        status: "found",
        complete: true,
        truncated: false,
        language: "typescript",
        pathSha256: "1".repeat(64),
        fileSha256: "2".repeat(64),
        fileBytes: 500,
        parseDiagnosticCount: 0,
        visitedNodeCount: 40,
        matchedNodeCount: 2,
        returnedNodeCount: 2,
        omittedNodeCount: 0,
        rangeChars: 120,
        displayBytes: 600,
        nodeSetSha256: "3".repeat(64),
        kindCountsSha256: "4".repeat(64),
        typescriptVersion: "5.9.3",
        durationMs: 7,
        resultSha256: "5".repeat(64),
        nodes: [{ name: "PRIVATE_AST_NAME" }],
      },
    });
    const edit = toolEvent("tool.completed", {
      toolName: "ast_edit_preview",
      status: "completed",
      effect: "read",
      output: "PRIVATE_AST_REPLACEMENT",
      details: {
        kind: "napier.typescript-ast",
        schemaVersion: 1,
        action: "edit_preview",
        operation: "replace",
        language: "typescript",
        targetKind: "method",
        pathSha256: "1".repeat(64),
        fileSha256: "2".repeat(64),
        fileBytes: 500,
        parseDiagnosticCount: 0,
        targetNodeSha256: "6".repeat(64),
        targetTextSha256: "7".repeat(64),
        replacementBytes: 50,
        replacementSha256: "8".repeat(64),
        applicationOldBytes: 40,
        applicationNewBytes: 50,
        applicationOldSha256: "9".repeat(64),
        applicationNewSha256: "a".repeat(64),
        applicationContextExpanded: true,
        afterFileSha256: "b".repeat(64),
        afterFileBytes: 510,
        visitedNodeCount: 40,
        typescriptVersion: "5.9.3",
        durationMs: 8,
        resultSha256: "c".repeat(64),
        replacement: "PRIVATE_AST_REPLACEMENT",
      },
    });

    expect(toolEventTraceView(query)).toEqual({
      toolName: "ast_query",
      status: "completed",
      effect: "read",
      typescriptAstAction: "query",
      typescriptAstStatus: "found",
      typescriptAstLanguage: "typescript",
      typescriptAstComplete: true,
      typescriptAstTruncated: false,
      typescriptAstVisitedNodeCount: 40,
      typescriptAstMatchedNodeCount: 2,
      typescriptAstReturnedNodeCount: 2,
      typescriptAstOmittedNodeCount: 0,
      typescriptAstDisplayBytes: 600,
      typescriptAstDurationMs: 7,
      typescriptAstVersion: "5.9.3",
      typescriptAstPathSha256: "1".repeat(64),
      typescriptAstFileSha256: "2".repeat(64),
      typescriptAstNodeSetSha256: "3".repeat(64),
      typescriptAstResultSha256: "5".repeat(64),
    });
    expect(toolEventTraceSummary(query)).toContain(
      "ast query / ast-status found / ast-language typescript / ast-visited 40 / ast-matches 2 / ast-returned 2 / ast-omitted 0 / ast-display 600 / ast-complete",
    );
    expect(toolEventTraceView(edit)).toEqual({
      toolName: "ast_edit_preview",
      status: "completed",
      effect: "read",
      typescriptAstAction: "edit_preview",
      typescriptAstLanguage: "typescript",
      typescriptAstOperation: "replace",
      typescriptAstTargetKind: "method",
      typescriptAstApplicationContextExpanded: true,
      typescriptAstDurationMs: 8,
      typescriptAstVersion: "5.9.3",
      typescriptAstPathSha256: "1".repeat(64),
      typescriptAstFileSha256: "2".repeat(64),
      typescriptAstTargetNodeSha256: "6".repeat(64),
      typescriptAstAfterFileSha256: "b".repeat(64),
      typescriptAstResultSha256: "c".repeat(64),
    });
    expect(toolEventTraceSummary(edit)).toContain(
      "ast edit_preview / ast-language typescript / ast-operation replace / ast-target method / ast-context-expanded",
    );
    expect(toolEventTraceSummary(query)).not.toContain("PRIVATE_AST");
    expect(toolEventTraceSummary(edit)).not.toContain("PRIVATE_AST");
  });

  it("summarizes LSP diagnostic evidence without paths or messages", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_diagnostics",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_DIAGNOSTIC_MESSAGE",
      details: {
        kind: "napier.lsp-diagnostics",
        schemaVersion: 1,
        status: "diagnostics",
        language: "typescript",
        diagnosticCount: 2,
        errorCount: 1,
        warningCount: 1,
        informationCount: 0,
        hintCount: 0,
        truncated: true,
        durationMs: 612,
        protocolBytes: 2400,
        path: "TOP_SECRET_PATH",
        pathSha256: "a".repeat(64),
        fileSha256: "b".repeat(64),
        diagnosticSetSha256: "c".repeat(64),
        codeSetSha256: "d".repeat(64),
        resultSha256: "e".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_diagnostics",
      status: "completed",
      effect: "read",
      lspStatus: "diagnostics",
      lspLanguage: "typescript",
      lspDiagnosticCount: 2,
      lspErrorCount: 1,
      lspWarningCount: 1,
      lspTruncated: true,
      lspDurationMs: 612,
      lspProtocolBytes: 2400,
      lspPathSha256: "a".repeat(64),
      lspFileSha256: "b".repeat(64),
      lspDiagnosticSetSha256: "c".repeat(64),
      lspCodeSetSha256: "d".repeat(64),
      lspResultSha256: "e".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_diagnostics / completed / effect read / lsp diagnostics / language typescript / diagnostics 2 / errors 1 / warnings 1 / duration-ms 612 / protocol-bytes 2400 / lsp-truncated / lsp-path ${"a".repeat(12)} / lsp-file ${"b".repeat(12)} / diagnostic-set ${"c".repeat(12)} / code-set ${"d".repeat(12)} / lsp-result ${"e".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes LSP definition evidence without paths or source previews", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_definition",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_DEFINITION_SOURCE",
      details: {
        kind: "napier.lsp-definition",
        schemaVersion: 1,
        status: "found",
        language: "typescript",
        definitionCount: 2,
        omittedDefinitionCount: 1,
        truncated: true,
        durationMs: 720,
        protocolBytes: 2600,
        sourcePath: "TOP_SECRET_PATH",
        sourcePathSha256: "1".repeat(64),
        sourceFileSha256: "2".repeat(64),
        definitionSetSha256: "3".repeat(64),
        targetFileSetSha256: "4".repeat(64),
        resultSha256: "5".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_definition",
      status: "completed",
      effect: "read",
      lspDefinitionStatus: "found",
      lspDefinitionLanguage: "typescript",
      lspDefinitionCount: 2,
      lspDefinitionOmittedCount: 1,
      lspDefinitionTruncated: true,
      lspDefinitionDurationMs: 720,
      lspDefinitionProtocolBytes: 2600,
      lspDefinitionSourcePathSha256: "1".repeat(64),
      lspDefinitionSourceFileSha256: "2".repeat(64),
      lspDefinitionSetSha256: "3".repeat(64),
      lspDefinitionTargetFileSetSha256: "4".repeat(64),
      lspDefinitionResultSha256: "5".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_definition / completed / effect read / definition found / definition-language typescript / definitions 2 / definition-omitted 1 / definition-ms 720 / definition-protocol 2600 / definition-truncated / definition-source-path ${"1".repeat(12)} / definition-source-file ${"2".repeat(12)} / definition-set ${"3".repeat(12)} / definition-files ${"4".repeat(12)} / definition-result ${"5".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes semantic LSP symbols without names or signatures", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_symbols",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_SYMBOL_OUTPUT",
      details: {
        kind: "napier.lsp-symbols",
        schemaVersion: 1,
        status: "found",
        complete: false,
        truncated: true,
        responseShape: "hierarchical",
        language: "typescript",
        responseSymbolCount: 12,
        symbolCount: 10,
        omittedSymbolCount: 2,
        maxDepth: 2,
        deprecatedSymbolCount: 1,
        displayBytes: 4096,
        durationMs: 750,
        protocolBytes: 3000,
        sourcePath: "TOP_SECRET_PATH",
        sourcePathSha256: "1".repeat(64),
        sourceFileSha256: "2".repeat(64),
        symbolName: "TOP_SECRET_SYMBOL",
        signaturePreview: "TOP_SECRET_SIGNATURE",
        symbolSetSha256: "3".repeat(64),
        kindCountsSha256: "4".repeat(64),
        resultSha256: "5".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_symbols",
      status: "completed",
      effect: "read",
      lspSymbolsStatus: "found",
      lspSymbolsLanguage: "typescript",
      lspSymbolsComplete: false,
      lspSymbolsTruncated: true,
      lspSymbolsResponseShape: "hierarchical",
      lspSymbolsResponseCount: 12,
      lspSymbolsCount: 10,
      lspSymbolsOmittedCount: 2,
      lspSymbolsMaxDepth: 2,
      lspSymbolsDeprecatedCount: 1,
      lspSymbolsDisplayBytes: 4096,
      lspSymbolsDurationMs: 750,
      lspSymbolsProtocolBytes: 3000,
      lspSymbolsSourcePathSha256: "1".repeat(64),
      lspSymbolsSourceFileSha256: "2".repeat(64),
      lspSymbolsSetSha256: "3".repeat(64),
      lspSymbolsKindCountsSha256: "4".repeat(64),
      lspSymbolsResultSha256: "5".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_symbols / completed / effect read / semantic-symbols found / symbol-language typescript / symbol-shape hierarchical / symbols-truncated / symbol-response 12 / symbols 10 / symbol-omitted 2 / symbol-depth 2 / symbol-deprecated 1 / symbol-display-bytes 4096 / symbol-ms 750 / symbol-protocol 3000 / symbol-source-path ${"1".repeat(12)} / symbol-source-file ${"2".repeat(12)} / symbol-set ${"3".repeat(12)} / symbol-kinds ${"4".repeat(12)} / symbol-result ${"5".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes LSP reference evidence without paths or source previews", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_references",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_REFERENCE_SOURCE",
      details: {
        kind: "napier.lsp-references",
        schemaVersion: 1,
        status: "found",
        language: "typescript",
        includeDeclaration: false,
        referenceCount: 6,
        omittedReferenceCount: 2,
        truncated: true,
        durationMs: 840,
        protocolBytes: 3200,
        sourcePath: "TOP_SECRET_PATH",
        sourcePathSha256: "1".repeat(64),
        sourceFileSha256: "2".repeat(64),
        referenceSetSha256: "3".repeat(64),
        targetFileSetSha256: "4".repeat(64),
        resultSha256: "5".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_references",
      status: "completed",
      effect: "read",
      lspReferencesStatus: "found",
      lspReferencesLanguage: "typescript",
      lspReferencesIncludeDeclaration: false,
      lspReferencesCount: 6,
      lspReferencesOmittedCount: 2,
      lspReferencesTruncated: true,
      lspReferencesDurationMs: 840,
      lspReferencesProtocolBytes: 3200,
      lspReferencesSourcePathSha256: "1".repeat(64),
      lspReferencesSourceFileSha256: "2".repeat(64),
      lspReferencesSetSha256: "3".repeat(64),
      lspReferencesTargetFileSetSha256: "4".repeat(64),
      lspReferencesResultSha256: "5".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_references / completed / effect read / references found / reference-language typescript / reference-declarations excluded / reference-count 6 / reference-omitted 2 / reference-ms 840 / reference-protocol 3200 / reference-truncated / reference-source-path ${"1".repeat(12)} / reference-source-file ${"2".repeat(12)} / reference-set ${"3".repeat(12)} / reference-files ${"4".repeat(12)} / reference-result ${"5".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes complete LSP rename evidence without edit previews", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_rename",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_RENAME_EDIT",
      details: {
        kind: "napier.lsp-rename",
        schemaVersion: 1,
        status: "found",
        complete: true,
        language: "typescript",
        fileCount: 3,
        editCount: 6,
        previewBytes: 128,
        durationMs: 910,
        protocolBytes: 3600,
        sourcePath: "TOP_SECRET_PATH",
        sourcePathSha256: "1".repeat(64),
        sourceFileSha256: "2".repeat(64),
        newName: "TOP_SECRET_NEW_NAME",
        newNameSha256: "3".repeat(64),
        prepareResultSha256: "4".repeat(64),
        editSetSha256: "5".repeat(64),
        targetFileSetSha256: "6".repeat(64),
        resultSha256: "7".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_rename",
      status: "completed",
      effect: "read",
      lspRenameStatus: "found",
      lspRenameLanguage: "typescript",
      lspRenameComplete: true,
      lspRenameFileCount: 3,
      lspRenameEditCount: 6,
      lspRenamePreviewBytes: 128,
      lspRenameDurationMs: 910,
      lspRenameProtocolBytes: 3600,
      lspRenameSourcePathSha256: "1".repeat(64),
      lspRenameSourceFileSha256: "2".repeat(64),
      lspRenameNewNameSha256: "3".repeat(64),
      lspRenamePrepareResultSha256: "4".repeat(64),
      lspRenameEditSetSha256: "5".repeat(64),
      lspRenameTargetFileSetSha256: "6".repeat(64),
      lspRenameResultSha256: "7".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_rename / completed / effect read / rename found / rename-language typescript / rename-complete / rename-files 3 / rename-edits 6 / rename-preview-bytes 128 / rename-ms 910 / rename-protocol 3600 / rename-source-path ${"1".repeat(12)} / rename-source-file ${"2".repeat(12)} / rename-name ${"3".repeat(12)} / rename-prepare ${"4".repeat(12)} / rename-edit-set ${"5".repeat(12)} / rename-target-files ${"6".repeat(12)} / rename-result ${"7".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes bounded LSP quick-fix evidence without action content", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_code_actions",
      status: "completed",
      effect: "read",
      output: "TOP_SECRET_QUICK_FIX_EDIT",
      details: {
        kind: "napier.lsp-code-actions",
        schemaVersion: 1,
        status: "found",
        complete: false,
        truncated: true,
        language: "typescript",
        diagnosticCount: 2,
        actionCount: 16,
        omittedActionCount: 2,
        preferredActionCount: 1,
        commandIgnoredCount: 3,
        fileCount: 3,
        editCount: 6,
        previewBytes: 256,
        durationMs: 940,
        protocolBytes: 3800,
        sourcePath: "TOP_SECRET_PATH",
        sourcePathSha256: "1".repeat(64),
        sourceFileSha256: "2".repeat(64),
        diagnosticMessage: "TOP_SECRET_DIAGNOSTIC",
        diagnosticSetSha256: "3".repeat(64),
        actionTitle: "TOP_SECRET_ACTION",
        actionSetSha256: "4".repeat(64),
        targetFileSetSha256: "5".repeat(64),
        resultSha256: "6".repeat(64),
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_code_actions",
      status: "completed",
      effect: "read",
      lspCodeActionsStatus: "found",
      lspCodeActionsLanguage: "typescript",
      lspCodeActionsComplete: false,
      lspCodeActionsTruncated: true,
      lspCodeActionsDiagnosticCount: 2,
      lspCodeActionsActionCount: 16,
      lspCodeActionsOmittedActionCount: 2,
      lspCodeActionsPreferredActionCount: 1,
      lspCodeActionsCommandIgnoredCount: 3,
      lspCodeActionsFileCount: 3,
      lspCodeActionsEditCount: 6,
      lspCodeActionsPreviewBytes: 256,
      lspCodeActionsDurationMs: 940,
      lspCodeActionsProtocolBytes: 3800,
      lspCodeActionsSourcePathSha256: "1".repeat(64),
      lspCodeActionsSourceFileSha256: "2".repeat(64),
      lspCodeActionsDiagnosticSetSha256: "3".repeat(64),
      lspCodeActionsActionSetSha256: "4".repeat(64),
      lspCodeActionsTargetFileSetSha256: "5".repeat(64),
      lspCodeActionsResultSha256: "6".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / lsp_code_actions / completed / effect read / quick-fixes found / quick-fix-language typescript / quick-fixes-truncated / quick-fix-diagnostics 2 / quick-fix-actions 16 / quick-fix-omitted 2 / quick-fix-preferred 1 / quick-fix-commands-ignored 3 / quick-fix-files 3 / quick-fix-edits 6 / quick-fix-preview-bytes 256 / quick-fix-ms 940 / quick-fix-protocol 3800 / quick-fix-source-path ${"1".repeat(12)} / quick-fix-source-file ${"2".repeat(12)} / quick-fix-diagnostic-set ${"3".repeat(12)} / quick-fix-action-set ${"4".repeat(12)} / quick-fix-target-files ${"5".repeat(12)} / quick-fix-result ${"6".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("rejects impossible truncated LSP quick-fix receipts", () => {
    const event = toolEvent("tool.completed", {
      toolName: "lsp_code_actions",
      status: "completed",
      effect: "read",
      details: {
        kind: "napier.lsp-code-actions",
        schemaVersion: 1,
        status: "found",
        complete: false,
        truncated: true,
        language: "typescript",
        diagnosticCount: 1,
        actionCount: 1,
        omittedActionCount: 1,
        preferredActionCount: 1,
        commandIgnoredCount: 0,
        fileCount: 1,
        editCount: 1,
        previewBytes: 1,
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "lsp_code_actions",
      status: "completed",
      effect: "read",
    });
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
        diagnostics: {
          kind: "napier.workspace-patch-diagnostics",
          schemaVersion: 1,
          status: "improved",
          beforeDiagnosticCount: 2,
          afterDiagnosticCount: 1,
          introducedCount: 0,
          resolvedCount: 1,
          durationMs: 850,
          deltaSetSha256: "5".repeat(64),
          resultSha256: "6".repeat(64),
          message: "TOP_SECRET_DIAGNOSTIC",
        },
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
      patchDiagnosticsStatus: "improved",
      patchBeforeDiagnosticCount: 2,
      patchAfterDiagnosticCount: 1,
      patchIntroducedDiagnosticCount: 0,
      patchResolvedDiagnosticCount: 1,
      patchDiagnosticsDurationMs: 850,
      patchDiagnosticsDeltaSetSha256: "5".repeat(64),
      patchDiagnosticsResultSha256: "6".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / apply_patch / completed / patch hashrange_replace / edits 1 / bytes 42->45 / path ${"1".repeat(12)} / before ${"2".repeat(12)} / after ${"3".repeat(12)} / created-dirs 2 / created-dir-set ${"4".repeat(12)} / diagnostics improved / diagnostic-count 2->1 / introduced 0 / resolved 1 / diagnostic-ms 850 / diagnostic-delta ${"5".repeat(12)} / diagnostic-result ${"6".repeat(12)}`,
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

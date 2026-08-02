import type { JsonValue } from "@napier/contracts";

import {
  agentDataToolCallProjection,
  agentDataToolInputProjection,
  agentDataToolOutputProjection,
} from "./agent-data-tool-ledger.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  browserToolCallArgumentsLedgerProjection,
  browserToolInputLedgerProjection,
  browserToolOutputLedgerProjection,
} from "./browser-tool.js";
import {
  javascriptKernelToolCallArgumentsLedgerProjection,
  javascriptKernelToolInputLedgerProjection,
  javascriptKernelToolOutputLedgerProjection,
} from "./javascript-kernel-tool.js";
import {
  pythonKernelToolCallArgumentsLedgerProjection,
  pythonKernelToolInputLedgerProjection,
  pythonKernelToolOutputLedgerProjection,
} from "./python-kernel-tool.js";
import {
  researchSourceToolCallArgumentsLedgerProjection,
  researchSourceToolInputLedgerProjection,
  researchSourceToolOutputLedgerProjection,
} from "./research-source-tool.js";
import {
  nodeDebuggerToolCallArgumentsLedgerProjection,
  nodeDebuggerToolInputLedgerProjection,
  nodeDebuggerToolOutputLedgerProjection,
} from "./node-debugger-tool.js";
import {
  lspCodeActionApplyToolCallArgumentsLedgerProjection,
  lspCodeActionApplyToolInputLedgerProjection,
  lspCodeActionApplyToolOutputLedgerProjection,
} from "./lsp-code-action-apply-tool.js";
import {
  lspCodeActionsToolCallArgumentsLedgerProjection,
  lspCodeActionsToolInputLedgerProjection,
  lspCodeActionsToolOutputLedgerProjection,
} from "./lsp-code-actions-tool.js";
import {
  lspDiagnosticsToolCallArgumentsLedgerProjection,
  lspDiagnosticsToolInputLedgerProjection,
  lspDiagnosticsToolOutputLedgerProjection,
} from "./lsp-diagnostics-tool.js";
import {
  lspDefinitionToolCallArgumentsLedgerProjection,
  lspDefinitionToolInputLedgerProjection,
  lspDefinitionToolOutputLedgerProjection,
} from "./lsp-definition-tool.js";
import {
  lspReferencesToolCallArgumentsLedgerProjection,
  lspReferencesToolInputLedgerProjection,
  lspReferencesToolOutputLedgerProjection,
} from "./lsp-references-tool.js";
import {
  lspRenameToolCallArgumentsLedgerProjection,
  lspRenameToolInputLedgerProjection,
  lspRenameToolOutputLedgerProjection,
} from "./lsp-rename-tool.js";
import {
  lspRenameApplyToolCallArgumentsLedgerProjection,
  lspRenameApplyToolInputLedgerProjection,
  lspRenameApplyToolOutputLedgerProjection,
} from "./lsp-rename-apply-tool.js";
import {
  lspSymbolsToolCallArgumentsLedgerProjection,
  lspSymbolsToolInputLedgerProjection,
  lspSymbolsToolOutputLedgerProjection,
} from "./lsp-symbols-tool.js";
import {
  agentProcessToolCallProjection,
  agentProcessToolInputProjection,
  agentProcessToolOutputProjection,
} from "./agent-process-tool-ledger.js";
import {
  typescriptAstToolCallArgumentsLedgerProjection,
  typescriptAstToolInputLedgerProjection,
  typescriptAstToolOutputLedgerProjection,
} from "./typescript-ast-tool.js";
import {
  workspaceFileToolCallArgumentsLedgerProjection,
  workspaceFileToolInputLedgerProjection,
  workspaceFileToolOutputLedgerProjection,
} from "./workspace-file-tools.js";
import {
  workspaceProcessToolCallArgumentsLedgerProjection,
  workspaceProcessToolInputLedgerProjection,
  workspaceProcessToolOutputLedgerProjection,
} from "./workspace-process-tool.js";
import {
  workspacePatchToolCallArgumentsLedgerProjection,
  workspacePatchToolInputLedgerProjection,
  workspacePatchToolOutputLedgerProjection,
} from "./workspace-patch-tool.js";
import {
  delegateTaskCallArgumentsLedgerProjection,
  delegateTaskInputLedgerProjection,
  delegateTaskOutputLedgerProjection,
} from "./subagents.js";
import {
  subagentWorktreeToolCallArgumentsLedgerProjection,
  subagentWorktreeToolInputLedgerProjection,
  subagentWorktreeToolOutputLedgerProjection,
} from "./subagent-worktree-tool.js";
import {
  verificationToolCallArgumentsLedgerProjection,
  verificationToolInputLedgerProjection,
  verificationToolOutputLedgerProjection,
} from "./verification-ledger.js";

const PRIVATE_WORKSPACE_READ_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "inspect_code",
  "read_symbol",
]);

export function agentToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  const dataProjection = agentDataToolCallProjection(toolName, args);
  if (dataProjection !== undefined) return dataProjection;
  const processProjection = agentProcessToolCallProjection(toolName, args);
  if (processProjection !== undefined) return processProjection;
  if (toolName === "research_source") {
    return researchSourceToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "browser") {
    return browserToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "javascript_kernel") {
    return javascriptKernelToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "python_kernel") {
    return pythonKernelToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "node_debugger") {
    return nodeDebuggerToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "verify_workspace") {
    return verificationToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "ast_query" || toolName === "ast_edit_preview") {
    return typescriptAstToolCallArgumentsLedgerProjection(toolName, args);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_symbols") {
    return lspSymbolsToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_definition") {
    return lspDefinitionToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_references") {
    return lspReferencesToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_rename") {
    return lspRenameToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_rename_apply") {
    return lspRenameApplyToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_code_actions") {
    return lspCodeActionsToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_code_action_apply") {
    return lspCodeActionApplyToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "apply_patch") {
    return workspacePatchToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "delegate_task") {
    return delegateTaskCallArgumentsLedgerProjection(args);
  }
  if (toolName === "subagent_worktree_apply") {
    return subagentWorktreeToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "workspace_process") {
    return workspaceProcessToolCallArgumentsLedgerProjection(args);
  }
  if (
    toolName === "workspace_file_preview" ||
    toolName === "workspace_file_apply"
  ) {
    return workspaceFileToolCallArgumentsLedgerProjection(toolName, args);
  }
  if (PRIVATE_WORKSPACE_READ_TOOLS.has(toolName)) {
    return privateWorkspaceReadArguments(toolName, args);
  }
  return toJsonValue(args);
}

export function agentToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  const dataProjection = agentDataToolInputProjection(toolName, args);
  if (dataProjection !== undefined) return dataProjection;
  const processProjection = agentProcessToolInputProjection(toolName, args);
  if (processProjection !== undefined) return processProjection;
  if (toolName === "research_source") {
    return researchSourceToolInputLedgerProjection(args);
  }
  if (toolName === "browser") {
    return browserToolInputLedgerProjection(args);
  }
  if (toolName === "javascript_kernel") {
    return javascriptKernelToolInputLedgerProjection(args);
  }
  if (toolName === "python_kernel") {
    return pythonKernelToolInputLedgerProjection(args);
  }
  if (toolName === "node_debugger") {
    return nodeDebuggerToolInputLedgerProjection(args);
  }
  if (toolName === "verify_workspace") {
    return verificationToolInputLedgerProjection(args);
  }
  if (toolName === "ast_query" || toolName === "ast_edit_preview") {
    return typescriptAstToolInputLedgerProjection(toolName, args);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_symbols") {
    return lspSymbolsToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_definition") {
    return lspDefinitionToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_references") {
    return lspReferencesToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_rename") {
    return lspRenameToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_rename_apply") {
    return lspRenameApplyToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_code_actions") {
    return lspCodeActionsToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_code_action_apply") {
    return lspCodeActionApplyToolInputLedgerProjection(args);
  }
  if (toolName === "apply_patch") {
    return workspacePatchToolInputLedgerProjection(args);
  }
  if (toolName === "delegate_task") {
    return delegateTaskInputLedgerProjection(args);
  }
  if (toolName === "subagent_worktree_apply") {
    return subagentWorktreeToolInputLedgerProjection(args);
  }
  if (toolName === "workspace_process") {
    return workspaceProcessToolInputLedgerProjection(args);
  }
  if (
    toolName === "workspace_file_preview" ||
    toolName === "workspace_file_apply"
  ) {
    return workspaceFileToolInputLedgerProjection(toolName, args);
  }
  if (PRIVATE_WORKSPACE_READ_TOOLS.has(toolName)) {
    return {
      inputSha256: sha256(canonicalJson(toJsonValue(args))),
      inputBytes: Buffer.byteLength(canonicalJson(toJsonValue(args)), "utf8"),
      inputRedacted: true,
    };
  }
  return { input: toJsonValue(args) };
}

export function agentToolOutputLedgerProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const dataProjection = agentDataToolOutputProjection(
    toolName,
    output,
    result,
  );
  if (dataProjection !== undefined) return dataProjection;
  const processProjection = agentProcessToolOutputProjection(
    toolName,
    output,
    result,
  );
  if (processProjection !== undefined) return processProjection;
  if (toolName === "research_source") {
    return researchSourceToolOutputLedgerProjection(output, result);
  }
  if (toolName === "browser") {
    return browserToolOutputLedgerProjection(output, result);
  }
  if (toolName === "javascript_kernel") {
    return javascriptKernelToolOutputLedgerProjection(output, result);
  }
  if (toolName === "python_kernel") {
    return pythonKernelToolOutputLedgerProjection(output, result);
  }
  if (toolName === "node_debugger") {
    return nodeDebuggerToolOutputLedgerProjection(output, result);
  }
  if (toolName === "verify_workspace") {
    return verificationToolOutputLedgerProjection(output, result);
  }
  if (toolName === "ast_query" || toolName === "ast_edit_preview") {
    return typescriptAstToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_symbols") {
    return lspSymbolsToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_definition") {
    return lspDefinitionToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_references") {
    return lspReferencesToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_rename") {
    return lspRenameToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_rename_apply") {
    return lspRenameApplyToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_code_actions") {
    return lspCodeActionsToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_code_action_apply") {
    return lspCodeActionApplyToolOutputLedgerProjection(output, result);
  }
  if (toolName === "apply_patch") {
    return workspacePatchToolOutputLedgerProjection(output, result);
  }
  if (toolName === "delegate_task") {
    return delegateTaskOutputLedgerProjection(output, result);
  }
  if (toolName === "subagent_worktree_apply") {
    return subagentWorktreeToolOutputLedgerProjection(output, result);
  }
  if (toolName === "workspace_process") {
    return workspaceProcessToolOutputLedgerProjection(output, result);
  }
  if (
    toolName === "workspace_file_preview" ||
    toolName === "workspace_file_apply"
  ) {
    return workspaceFileToolOutputLedgerProjection(output, result);
  }
  if (PRIVATE_WORKSPACE_READ_TOOLS.has(toolName)) {
    return {
      outputSha256: sha256(output),
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputRedacted: true,
      ...privateWorkspaceReadDetails(toolName, result),
    };
  }
  return { output };
}

function privateWorkspaceReadArguments(
  toolName: string,
  args: unknown,
): JsonValue {
  const value = toJsonValue(args);
  const serialized = canonicalJson(value);
  return {
    kind: "napier.private-workspace-read-arguments",
    schemaVersion: 1,
    redacted: true,
    inputSha256: sha256(canonicalJson({ toolName, args: value })),
    argumentsSha256: sha256(serialized),
    argumentsBytes: Buffer.byteLength(serialized, "utf8"),
  };
}

function privateWorkspaceReadDetails(
  toolName: string,
  result: unknown,
): Record<string, JsonValue> {
  const details = record(result)?.["details"];
  const value = record(details);
  if (!value) return {};
  const keys =
    toolName === "list_files"
      ? ["count", "truncated", "pathSha256", "entrySetSha256"]
      : toolName === "read_file"
        ? [
            "startLine",
            "endLine",
            "totalLines",
            "pathSha256",
            "sha256",
            "sizeBytes",
            "truncated",
            "lineAnchorsTruncated",
            "lineAnchorSetSha256",
          ]
        : toolName === "search_files"
          ? ["count", "truncated", "matchSetSha256"]
          : toolName === "list_symbols"
            ? [
                "pathSha256",
                "fileCount",
                "skippedFileCount",
                "symbolCount",
                "totalLines",
                "sizeBytes",
                "truncated",
                "languageCountsSha256",
                "fileSetSha256",
                "symbolSetSha256",
              ]
            : toolName === "inspect_data"
              ? [
                  "pathSha256",
                  "format",
                  "sha256",
                  "sizeBytes",
                  "rowCount",
                  "columnCount",
                  "truncated",
                  "columnSetSha256",
                  "sampleSha256",
                ]
              : toolName === "inspect_code"
                ? [
                    "pathSha256",
                    "language",
                    "sha256",
                    "sizeBytes",
                    "totalLines",
                    "symbolCount",
                    "truncated",
                    "symbolSetSha256",
                  ]
                : [
                    "pathSha256",
                    "language",
                    "sha256",
                    "sizeBytes",
                    "totalLines",
                    "startLine",
                    "endLine",
                    "symbolLine",
                    "symbolKind",
                    "symbolNameSha256",
                    "lineSha256",
                    "signatureSha256",
                    "rangeSha256",
                    "observedLineCount",
                    "truncated",
                    "lineAnchorsTruncated",
                    "lineAnchorSetSha256",
                  ];
  const projected = Object.fromEntries(
    keys.flatMap((key) => {
      const candidate = value[key];
      return typeof candidate === "string" ||
        typeof candidate === "number" ||
        typeof candidate === "boolean"
        ? [[key, candidate]]
        : [];
    }),
  ) as Record<string, JsonValue>;
  return Object.keys(projected).length > 0 ? { details: projected } : {};
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

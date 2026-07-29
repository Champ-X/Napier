import type { JsonValue } from "@napier/contracts";

import {
  lspDiagnosticsToolCallArgumentsLedgerProjection,
  lspDiagnosticsToolInputLedgerProjection,
  lspDiagnosticsToolOutputLedgerProjection,
} from "./lsp-diagnostics-tool.js";
import {
  commandToolCallArgumentsLedgerProjection,
  commandToolInputLedgerProjection,
  commandToolOutputLedgerProjection,
} from "./command-execution.js";
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

export function agentToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  if (toolName === "run_command") {
    return commandToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolCallArgumentsLedgerProjection(args);
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
  return toJsonValue(args);
}

export function agentToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  if (toolName === "run_command") {
    return commandToolInputLedgerProjection(args);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolInputLedgerProjection(args);
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
  return { input: toJsonValue(args) };
}

export function agentToolOutputLedgerProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  if (toolName === "run_command") {
    return commandToolOutputLedgerProjection(output, result);
  }
  if (toolName === "lsp_diagnostics") {
    return lspDiagnosticsToolOutputLedgerProjection(output, result);
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
  return { output };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

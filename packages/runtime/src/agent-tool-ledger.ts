import type { JsonValue } from "@napier/contracts";

import {
  commandToolCallArgumentsLedgerProjection,
  commandToolInputLedgerProjection,
  commandToolOutputLedgerProjection,
} from "./command-execution.js";
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
  if (toolName === "workspace_process") {
    return workspaceProcessToolCallArgumentsLedgerProjection(args);
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
  if (toolName === "workspace_process") {
    return workspaceProcessToolInputLedgerProjection(args);
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
  if (toolName === "workspace_process") {
    return workspaceProcessToolOutputLedgerProjection(output, result);
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

import type { JsonValue } from "@napier/contracts";

import {
  commandToolCallArgumentsLedgerProjection,
  commandToolInputLedgerProjection,
  commandToolOutputLedgerProjection,
} from "./command-tool.js";
import {
  gitInspectToolCallArgumentsLedgerProjection,
  gitInspectToolInputLedgerProjection,
  gitInspectToolOutputLedgerProjection,
} from "./git-inspect-tool.js";

export function agentProcessToolCallProjection(
  toolName: string,
  args: unknown,
): JsonValue | undefined {
  if (toolName === "run_command") {
    return commandToolCallArgumentsLedgerProjection(args);
  }
  return toolName === "git_inspect"
    ? gitInspectToolCallArgumentsLedgerProjection(args)
    : undefined;
}

export function agentProcessToolInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "run_command") {
    return commandToolInputLedgerProjection(args);
  }
  return toolName === "git_inspect"
    ? gitInspectToolInputLedgerProjection(args)
    : undefined;
}

export function agentProcessToolOutputProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "run_command") {
    return commandToolOutputLedgerProjection(output, result);
  }
  return toolName === "git_inspect"
    ? gitInspectToolOutputLedgerProjection(output, result)
    : undefined;
}

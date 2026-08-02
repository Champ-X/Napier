import type { JsonValue } from "@napier/contracts";

import {
  dataFrameToolCallArgumentsLedgerProjection,
  dataFrameToolInputLedgerProjection,
  dataFrameToolOutputLedgerProjection,
} from "./data-frame-tool.js";
import {
  sqliteQueryToolCallArgumentsLedgerProjection,
  sqliteQueryToolInputLedgerProjection,
  sqliteQueryToolOutputLedgerProjection,
} from "./sqlite-query-tool.js";

export function agentDataToolCallProjection(
  toolName: string,
  args: unknown,
): JsonValue | undefined {
  if (toolName === "sqlite_query") {
    return sqliteQueryToolCallArgumentsLedgerProjection(args);
  }
  return toolName === "data_frame"
    ? dataFrameToolCallArgumentsLedgerProjection(args)
    : undefined;
}

export function agentDataToolInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "sqlite_query") {
    return sqliteQueryToolInputLedgerProjection(args);
  }
  return toolName === "data_frame"
    ? dataFrameToolInputLedgerProjection(args)
    : undefined;
}

export function agentDataToolOutputProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "sqlite_query") {
    return sqliteQueryToolOutputLedgerProjection(output, result);
  }
  return toolName === "data_frame"
    ? dataFrameToolOutputLedgerProjection(output, result)
    : undefined;
}

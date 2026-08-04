import type { JsonValue } from "@napier/contracts";

import {
  browserToolCallArgumentsLedgerProjection,
  browserToolInputLedgerProjection,
  browserToolOutputLedgerProjection,
} from "./browser-tool.js";
import {
  researchSourceToolCallArgumentsLedgerProjection,
  researchSourceToolInputLedgerProjection,
  researchSourceToolOutputLedgerProjection,
} from "./research-source-tool.js";
import {
  webFetchToolCallArgumentsLedgerProjection,
  webFetchToolInputLedgerProjection,
  webFetchToolOutputLedgerProjection,
} from "./web-fetch-tool.js";
import {
  webSearchToolCallArgumentsLedgerProjection,
  webSearchToolInputLedgerProjection,
  webSearchToolOutputLedgerProjection,
} from "./web-search-tool.js";

export function agentNetworkToolCallProjection(
  toolName: string,
  args: unknown,
): JsonValue | undefined {
  if (toolName === "web_search") {
    return webSearchToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "web_fetch") {
    return webFetchToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "research_source") {
    return researchSourceToolCallArgumentsLedgerProjection(args);
  }
  if (toolName === "browser") {
    return browserToolCallArgumentsLedgerProjection(args);
  }
  return undefined;
}

export function agentNetworkToolInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "web_search") {
    return webSearchToolInputLedgerProjection(args);
  }
  if (toolName === "web_fetch") {
    return webFetchToolInputLedgerProjection(args);
  }
  if (toolName === "research_source") {
    return researchSourceToolInputLedgerProjection(args);
  }
  if (toolName === "browser") {
    return browserToolInputLedgerProjection(args);
  }
  return undefined;
}

export function agentNetworkToolOutputProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "web_search") {
    return webSearchToolOutputLedgerProjection(output, result);
  }
  if (toolName === "web_fetch") {
    return webFetchToolOutputLedgerProjection(output, result);
  }
  if (toolName === "research_source") {
    return researchSourceToolOutputLedgerProjection(output, result);
  }
  if (toolName === "browser") {
    return browserToolOutputLedgerProjection(output, result);
  }
  return undefined;
}

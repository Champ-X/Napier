import type { JsonValue } from "@napier/contracts";

import {
  agentDataToolCallProjection,
  agentDataToolInputProjection,
  agentDataToolOutputProjection,
} from "./agent-data-tool-ledger.js";
import {
  agentNetworkToolCallProjection,
  agentNetworkToolInputProjection,
  agentNetworkToolOutputProjection,
} from "./agent-network-tool-ledger.js";
import {
  agentProcessToolCallProjection,
  agentProcessToolInputProjection,
  agentProcessToolOutputProjection,
} from "./agent-process-tool-ledger.js";
import {
  skillLoadArgumentsLedgerProjection,
  skillLoadInputLedgerProjection,
  skillLoadOutputLedgerProjection,
} from "./skill-load-tool.js";

export function specializedToolCallProjection(
  toolName: string,
  args: unknown,
): JsonValue | undefined {
  if (toolName === "skill_load") return skillLoadArgumentsLedgerProjection(args);
  return (
    agentDataToolCallProjection(toolName, args) ??
    agentProcessToolCallProjection(toolName, args) ??
    agentNetworkToolCallProjection(toolName, args)
  );
}

export function specializedToolInputProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "skill_load") return skillLoadInputLedgerProjection(args);
  return (
    agentDataToolInputProjection(toolName, args) ??
    agentProcessToolInputProjection(toolName, args) ??
    agentNetworkToolInputProjection(toolName, args)
  );
}

export function specializedToolOutputProjection(
  toolName: string,
  output: string,
  result: unknown,
): Record<string, JsonValue> | undefined {
  if (toolName === "skill_load") {
    return skillLoadOutputLedgerProjection(output, result) as Record<
      string,
      JsonValue
    >;
  }
  return (
    agentDataToolOutputProjection(toolName, output, result) ??
    agentProcessToolOutputProjection(toolName, output, result) ??
    agentNetworkToolOutputProjection(toolName, output, result)
  );
}

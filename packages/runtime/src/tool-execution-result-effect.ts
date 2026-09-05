import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";

import { agentToolResultText } from "./agent-tool-result-text.js";
import { canonicalJson, sha256 } from "./ed25519.js";

/** Exact terminal-effect receipt shared by settlement and lineage replay. */
export function toolExecutionResultEffect(
  callId: string,
  result: AgentToolResult<unknown>,
  isError: boolean,
  output = agentToolResultText(result),
): Record<string, JsonValue> {
  return {
    kind: "napier.tool-execution-effect",
    schemaVersion: 2,
    callId,
    outcome: isError ? "failed" : "succeeded",
    outputTextSha256: sha256(output),
    // Terminal effect identity covers the complete Agent result, including
    // image blocks. Exact-result replay remains intentionally stricter and
    // may decline to capture non-text results; settlement itself must not
    // turn a valid multimodal result into a tool failure.
    resultSha256: sha256(canonicalJson(result)),
  };
}

export function toolExecutionResultEffectSha256(
  callId: string,
  result: AgentToolResult<unknown>,
  isError: boolean,
): string {
  return sha256(
    canonicalJson(toolExecutionResultEffect(callId, result, isError)),
  );
}

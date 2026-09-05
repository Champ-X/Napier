import type { JsonValue, RunEvent } from "@napier/contracts";
import type { ToolFailureReceiptV1 } from "@napier/contracts/tool-protocol";

import { isToolFailureReceiptV1 } from "./tool-failure-semantics.js";

/** Restores only a receipt bound to the exact declaration recorded at failure. */
export function replayedToolFailureReceipt(
  events: readonly RunEvent[],
  callId: string,
): ToolFailureReceiptV1 | undefined {
  const event = events.find((candidate) => {
    const payload = record(candidate.payload);
    return candidate.type === "tool.failed" && payload?.["callId"] === callId;
  });
  const payload = event ? record(event.payload) : undefined;
  const failure = payload?.["toolFailure"];
  const protocol = record(payload?.["toolProtocol"]);
  return isToolFailureReceiptV1(failure) &&
    protocol?.["failureDefinitionSha256"] === failure.failureDefinitionSha256
    ? failure
    : undefined;
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

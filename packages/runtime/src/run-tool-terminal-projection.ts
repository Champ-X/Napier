import type { JsonValue, RunEvent } from "@napier/contracts";

/**
 * A Run ledger can contain duplicated or contradictory terminal events after a
 * crash/retry boundary. Every progress consumer uses this projection so event
 * order has one deterministic meaning: the first terminal event wins.
 */
export function acceptFirstToolTerminal(
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  acceptedCallIds: Set<string>,
): boolean {
  if (
    event.type !== "tool.completed" &&
    event.type !== "tool.failed" &&
    event.type !== "tool.blocked"
  ) {
    return false;
  }
  const callId =
    typeof payload?.["callId"] === "string" && payload["callId"].length > 0
      ? payload["callId"]
      : undefined;
  if (!callId) return true;
  if (acceptedCallIds.has(callId)) return false;
  acceptedCallIds.add(callId);
  return true;
}

import type { RunEvent, Usage } from "@napier/contracts";

export function ledgerEventUsage(event: RunEvent): Usage {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    throw new Error(`Missing usage payload on ${event.type}`);
  }
  const usage = event.payload["usage"];
  if (!usage || Array.isArray(usage) || typeof usage !== "object") {
    throw new Error(`Missing usage payload on ${event.type}`);
  }
  return {
    inputTokens: Number(usage["inputTokens"]),
    outputTokens: Number(usage["outputTokens"]),
    cacheReadTokens: Number(usage["cacheReadTokens"]),
    cacheWriteTokens: Number(usage["cacheWriteTokens"]),
    costUsd: Number(usage["costUsd"]),
  };
}

export function hasLedgerEventUsage(event: RunEvent): boolean {
  return Boolean(
    event.payload &&
    !Array.isArray(event.payload) &&
    typeof event.payload === "object" &&
    event.payload["usage"] &&
    !Array.isArray(event.payload["usage"]) &&
    typeof event.payload["usage"] === "object",
  );
}

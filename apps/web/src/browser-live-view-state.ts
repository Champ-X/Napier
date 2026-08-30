import type { RunEvent } from "@napier/contracts";

export function browserLiveViewExpected(
  events: readonly RunEvent[],
  runId: string,
): boolean {
  for (const event of events.slice().reverse()) {
    if (
      event.runId !== runId ||
      (event.type !== "tool.completed" && event.type !== "tool.failed") ||
      !record(event.payload) ||
      event.payload["toolName"] !== "browser"
    ) {
      continue;
    }
    if (event.type === "tool.failed") {
      const error = event.payload["displayError"];
      if (
        error === "Cross-origin navigation requires allowCrossOrigin" ||
        error === "Browser Session is already active for this Run"
      ) {
        continue;
      }
      return false;
    }
    if (!record(event.payload["details"])) continue;
    const action = event.payload["details"]["action"];
    return typeof action === "string" && action !== "close";
  }
  return false;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

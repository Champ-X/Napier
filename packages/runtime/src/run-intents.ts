import type { RunEvent } from "@napier/contracts";

import { sha256 } from "./ed25519.js";

const INTENT_ID = /^intent_[a-z0-9]{8,80}$/u;

export function createRunIntentId(runId: string): string {
  return `intent_${sha256(runId).slice(0, 20)}`;
}

export function assertRunIntent(value: unknown, label = "Run intent"): void {
  if (typeof value !== "string" || !INTENT_ID.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

export function projectRunIntents(
  events: readonly RunEvent[],
): Map<string, string> {
  return new Map(
    events.flatMap((event): Array<[string, string]> => {
      if (
        event.type !== "run.started" ||
        !event.payload ||
        typeof event.payload !== "object" ||
        Array.isArray(event.payload)
      ) {
        return [];
      }
      const intentId = event.payload["intentId"];
      return typeof intentId === "string" && INTENT_ID.test(intentId)
        ? [[event.runId, intentId]]
        : [];
    }),
  );
}

export function runIntentFor(
  events: readonly RunEvent[],
  runId: string,
): string | undefined {
  return projectRunIntents(events).get(runId);
}

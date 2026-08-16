import type { RunEvent, RunRecord } from "@napier/contracts";

const INTENT_ID = /^intent_[a-z0-9]{8,80}$/u;

export function validRunIntentId(value: unknown): value is string {
  return typeof value === "string" && INTENT_ID.test(value);
}

export interface CurrentRunAttempt {
  runId: string;
  intentId?: string;
}

export function projectRunIntentIds(
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
      return validRunIntentId(intentId) ? [[event.runId, intentId]] : [];
    }),
  );
}

export function currentRunAttempt(
  runs: readonly RunRecord[],
  events: readonly RunEvent[],
  intentIds: ReadonlyMap<string, string>,
): CurrentRunAttempt | undefined {
  const runId = runs.at(-1)?.id ?? events.at(-1)?.runId;
  if (!runId) return undefined;
  const intentId = intentIds.get(runId);
  return { runId, ...(intentId ? { intentId } : {}) };
}

export function runIdsBelongToCurrentAttempt(
  runIds: Iterable<string>,
  current: CurrentRunAttempt | undefined,
  intentIds: ReadonlyMap<string, string>,
): boolean {
  if (!current) return false;
  for (const runId of runIds) {
    if (
      runId === current.runId ||
      (current.intentId !== undefined &&
        intentIds.get(runId) === current.intentId)
    ) {
      return true;
    }
  }
  return false;
}

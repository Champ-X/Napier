import type { RunEvent, Usage } from "@napier/contracts";

export const RUN_EVENT_QUERY_MAX_TYPES = 64;

export interface RunEventQueryScope {
  threadId?: string;
  runId?: string;
  afterSeq?: number;
  atOrBeforeSeq?: number;
  types?: readonly string[];
}

export interface RunEventQueryPort {
  listRunEvents(
    runId: string,
    afterSeq?: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
  listEventsRange(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
  findLatestEvent(query: RunEventQueryScope): Promise<RunEvent | undefined>;
  findToolTerminal(
    callId: string,
    scope?: Omit<RunEventQueryScope, "types">,
  ): Promise<RunEvent | undefined>;
  listEventsByCorrelationId(
    correlationId: string,
    scope?: RunEventQueryScope,
  ): Promise<RunEvent[]>;
  aggregateRunUsage(runId: string): Promise<Usage>;
}

export function validateEventQueryId(value: string, label: string): string {
  if (!value.trim() || value.length > 256) {
    throw new Error(`${label} must contain 1 to 256 characters`);
  }
  return value;
}

export function validateEventQuerySeq(
  value: number,
  label: string,
  minimum = 0,
): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${String(minimum)}`);
  }
  return value;
}

export function normalizeEventQueryTypes(
  types: readonly string[] | undefined,
): string[] | undefined {
  if (types === undefined) return undefined;
  if (types.length > RUN_EVENT_QUERY_MAX_TYPES) {
    throw new Error(
      `Event query supports at most ${String(RUN_EVENT_QUERY_MAX_TYPES)} types`,
    );
  }
  const normalized = [...new Set(types)];
  for (const type of normalized) validateEventQueryId(type, "Event type");
  return normalized;
}

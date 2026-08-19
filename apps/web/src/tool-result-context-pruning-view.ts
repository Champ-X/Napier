import type { RunEvent } from "@napier/contracts";

export interface ToolResultContextPruningView {
  eventSeq: number;
  runId: string;
  attempt: number;
  messageCount: number;
  toolResultCount: number;
  replacementCount: number;
  supersededResultCount: number;
  repeatedErrorCount: number;
  largeResultCount: number;
  emptyResultCount: number;
  originalToolResultTextBytes: number;
  activeToolResultTextBytes: number;
  savedToolResultTextBytes: number;
  originalToolResultSetSha256: string;
  activeToolResultSetSha256: string;
  replacementSetSha256: string;
  contentSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const COUNT_KEYS = [
  "attempt",
  "messageCount",
  "toolResultCount",
  "replacementCount",
  "supersededResultCount",
  "repeatedErrorCount",
  "largeResultCount",
  "emptyResultCount",
  "originalToolResultTextBytes",
  "activeToolResultTextBytes",
  "savedToolResultTextBytes",
] as const;
const HASH_KEYS = [
  "originalToolResultSetSha256",
  "activeToolResultSetSha256",
  "replacementSetSha256",
  "contentSha256",
] as const;

export function toolResultContextPruningViews(
  events: readonly RunEvent[],
): ToolResultContextPruningView[] {
  return events.flatMap((event) => {
    const view = pruningView(event);
    return view ? [view] : [];
  });
}

function pruningView(event: RunEvent): ToolResultContextPruningView | undefined {
  if (event.type !== "model.context.tool-results.pruned" || !record(event.payload)) return undefined;
  const payload = event.payload;
  if (payload["kind"] !== "napier.tool-result-context-pruning" || payload["schemaVersion"] !== 1) return undefined;
  const counts = numericFields(payload, COUNT_KEYS);
  const hashes = hashFields(payload, HASH_KEYS);
  if (!counts || !hashes || counts.attempt < 1) return undefined;
  if (counts.originalToolResultTextBytes - counts.activeToolResultTextBytes !== counts.savedToolResultTextBytes) return undefined;
  if (counts.replacementCount !== counts.supersededResultCount + counts.repeatedErrorCount + counts.largeResultCount + counts.emptyResultCount) return undefined;
  if (counts.replacementCount > counts.toolResultCount) return undefined;
  return { eventSeq: event.seq, runId: event.runId, ...counts, ...hashes };
}

function numericFields<Key extends string>(
  payload: Record<string, unknown>,
  keys: readonly Key[],
): Record<Key, number> | undefined {
  const entries = keys.map((key) => [key, payload[key]] as const);
  return entries.every(([, value]) => Number.isSafeInteger(value) && Number(value) >= 0)
    ? Object.fromEntries(entries) as Record<Key, number>
    : undefined;
}

function hashFields<Key extends string>(
  payload: Record<string, unknown>,
  keys: readonly Key[],
): Record<Key, string> | undefined {
  const entries = keys.map((key) => [key, payload[key]] as const);
  return entries.every(([, value]) => typeof value === "string" && SHA256.test(value))
    ? Object.fromEntries(entries) as Record<Key, string>
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

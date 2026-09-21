import type { RunEvent } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";

export interface RejectedAttempt {
  tool: string;
  eventId: string;
  seq: number;
  callId?: string;
  callInputSha256?: string;
  disposition: string;
  laterCompletionObserved: boolean;
  matchingCompletionObserved: boolean;
  matchingCompletionEventId?: string;
}

interface InvocationBinding {
  seq: number;
  inputSha256: string | undefined;
  sourceEventIds: string[];
  conflicted: boolean;
  sourceRecorded: boolean;
}

/** A later completion of the same tool is not a retry of every failed call.
 * Retain each attempt; only a bound, identical input can settle its review hint.
 * This records execution evidence, never task correctness or permission. */
export function projectTaskToolFailures(events: readonly RunEvent[]) {
  const bindings = new Map<string, InvocationBinding>();
  const failures: RejectedAttempt[] = [];
  const sourceEventIds = new Set<string>();
  const familyPending = new Map<string, RejectedAttempt[]>();
  const inputPending = new Map<string, RejectedAttempt[]>();
  for (const event of events) {
    if (event.type !== "tool.started") continue;
    const payload = record(event.payload);
    const key = invocationKey(event, payload);
    if (!key) continue;
    const prior = bindings.get(key);
    if (prior) {
      prior.conflicted = true;
      prior.sourceEventIds.push(event.id);
      continue;
    }
    bindings.set(key, {
      seq: event.seq,
      inputSha256: hash(payload.callInputSha256),
      sourceEventIds: [event.id],
      conflicted: false,
      sourceRecorded: false,
    });
  }
  const bindingFor = (event: RunEvent, payload: Record<string, unknown>) => {
    const key = invocationKey(event, payload);
    const binding = key ? bindings.get(key) : undefined;
    if (binding && !binding.sourceRecorded) {
      binding.sourceEventIds.forEach((id) => sourceEventIds.add(id));
      binding.sourceRecorded = true;
    }
    return binding && !binding.conflicted && binding.seq < event.seq
      ? binding.inputSha256
      : undefined;
  };
  for (const event of events) {
    const payload = record(event.payload);
    const tool = text(payload.toolName);
    if (!tool) continue;
    const family = canonicalJson([event.threadId, tool]);
    if (event.type === "tool.failed" || event.type === "tool.blocked") {
      const inputSha256 = bindingFor(event, payload);
      const attempt: RejectedAttempt = {
        tool,
        eventId: event.id,
        seq: event.seq,
        ...(text(payload.callId) ? { callId: text(payload.callId) } : {}),
        ...(inputSha256 ? { callInputSha256: inputSha256 } : {}),
        disposition:
          text(record(payload.toolFailure).disposition) || "inspect_failure",
        laterCompletionObserved: false,
        matchingCompletionObserved: false,
      };
      failures.push(attempt);
      append(familyPending, family, attempt);
      if (inputSha256)
        append(inputPending, canonicalJson([family, inputSha256]), attempt);
      sourceEventIds.add(event.id);
    } else if (event.type === "tool.completed") {
      const familyAttempts = familyPending.get(family);
      const key = invocationKey(event, payload);
      const binding = key ? bindings.get(key) : undefined;
      const inputKey = binding?.inputSha256
        ? canonicalJson([family, binding.inputSha256])
        : undefined;
      const possibleMatches = inputKey ? inputPending.get(inputKey) : undefined;
      if (!familyAttempts && !possibleMatches) continue;
      const inputSha256 = bindingFor(event, payload);
      familyAttempts?.forEach((attempt) => {
        attempt.laterCompletionObserved = true;
      });
      familyPending.delete(family);
      if (inputSha256 && inputKey) {
        possibleMatches?.forEach((attempt) => {
          attempt.matchingCompletionObserved = true;
          attempt.matchingCompletionEventId = event.id;
        });
        inputPending.delete(inputKey);
      }
      sourceEventIds.add(event.id);
    }
  }
  return { failures, sourceEventIds };
}

function invocationKey(event: RunEvent, payload: Record<string, unknown>) {
  const callId = text(payload.callId),
    tool = text(payload.toolName);
  return event.runId && callId && tool
    ? canonicalJson([event.threadId, event.runId, tool, callId])
    : undefined;
}
function append(
  map: Map<string, RejectedAttempt[]>,
  key: string,
  value: RejectedAttempt,
) {
  const pending = map.get(key);
  if (pending) pending.push(value);
  else map.set(key, [value]);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

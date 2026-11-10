import type { RunEvent, RunRecord } from "@napier/contracts";
import type { RunPromptOptions } from "./agent-runtime-options.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const PROMPT_REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const inFlight = new WeakMap<
  object,
  Map<
    string,
    {
      fingerprint: string;
      result: Promise<RunRecord>;
    }
  >
>();

export function isPromptRequestId(value: unknown): value is string {
  return typeof value === "string" && PROMPT_REQUEST_ID.test(value);
}

/** Transport callbacks and cancellation do not change the submitted intent. */
export function promptRequestFingerprint(options: RunPromptOptions): string {
  const {
    requestId: _id,
    signal: _signal,
    onEvent: _event,
    onRunCreated: _created,
    ...intent
  } = options;
  return sha256(
    canonicalJson({
      ...intent,
      text: options.text.trim(),
      source: options.source ?? "user",
      executionMode: options.executionMode ?? "standard",
    }),
  );
}

/** Share pending admission/execution across runtimes using the same store. */
export async function coalescePromptRequest(
  store: object,
  options: RunPromptOptions,
  execute: (fingerprint: string) => Promise<RunRecord>,
): Promise<RunRecord> {
  const key = JSON.stringify([options.threadId, options.requestId]);
  const fingerprint = promptRequestFingerprint(options);
  const pending = inFlight.get(store) ?? new Map();
  const existing = pending.get(key);
  if (existing) {
    assertMatchingFingerprint(existing.fingerprint, fingerprint);
    return existing.result;
  }
  const result = Promise.resolve().then(() => execute(fingerprint));
  pending.set(key, { fingerprint, result });
  inFlight.set(store, pending);
  try {
    return await result;
  } finally {
    pending.delete(key);
    if (pending.size === 0) inFlight.delete(store);
  }
}

/**
 * Find durable admission evidence for an already admitted request. Prefers the
 * create-time `run.prompt.admitted` marker, then falls back to `run.started`.
 * A fingerprint is required so a reused identity cannot silently change intent.
 */
export function findRunByPromptRequestId(
  runs: readonly RunRecord[],
  events: readonly RunEvent[],
  requestId: string,
  fingerprint?: string,
): RunRecord | undefined {
  if (!isPromptRequestId(requestId)) return undefined;
  const runsById = new Map(runs.map((run) => [run.id, run]));
  let startedMatch: RunRecord | undefined;
  for (const event of events) {
    if (
      event.type !== "run.prompt.admitted" &&
      event.type !== "run.started"
    ) {
      continue;
    }
    const payload =
      event.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : undefined;
    const run = runsById.get(event.runId);
    if (
      payload?.["requestId"] !== requestId ||
      !run ||
      event.threadId !== run.threadId
    ) {
      continue;
    }
    if (fingerprint !== undefined) {
      assertMatchingFingerprint(payload["requestFingerprint"], fingerprint);
    }
    if (event.type === "run.prompt.admitted") return run;
    startedMatch ??= run;
  }
  return startedMatch;
}

export function assertPromptRequestFingerprint(
  actual: unknown,
  expected: string,
): void {
  assertMatchingFingerprint(actual, expected);
}

function assertMatchingFingerprint(actual: unknown, expected: string): void {
  if (actual === undefined) {
    throw new Error(
      "Prompt requestId belongs to a Run without verifiable request evidence",
    );
  }
  if (actual !== expected) {
    throw new Error(
      "Prompt requestId was already used for a different request",
    );
  }
}

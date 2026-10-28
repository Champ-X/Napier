import { setTimeout as delay } from "node:timers/promises";
import type { OperatorDecision, RunEvent, RunRecord } from "@napier/contracts";
import { resolveOperatorDecisionCapabilityContinuation } from "./agent-capability-override.js";
import type {
  ContinueOperatorDecisionOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
import { inheritedHarnessPolicyOptions } from "./harness-run-policy.js";
import { formatOperatorDecisionContinuation } from "./operator-decisions.js";

interface ContinuationStore {
  listRuns(threadId: string): RunRecord[];
  listRunEvents(runId: string): Promise<RunEvent[]>;
  listOperatorDecisions(threadId: string): Promise<OperatorDecision[]>;
}

export async function continueAnsweredOperatorDecision(
  host: {
    store: ContinuationStore;
    runPrompt(options: RunPromptOptions): Promise<RunRecord>;
  },
  options: ContinueOperatorDecisionOptions,
): Promise<RunRecord> {
  const decision = await readDecision(host.store, options);
  // Preserve the Workflow boundary even when this is a retry of a bound Run.
  const continuation = await resolveOperatorDecisionCapabilityContinuation(
    host.store,
    options.threadId,
    decision.runId,
  );
  if (decision.status === "continued") {
    return observeContinuation(host.store, decision, options.signal);
  }
  if (decision.status !== "answered") {
    throw new Error(
      `Operator decision cannot continue in ${decision.status} state`,
    );
  }
  let created = false;
  try {
    return await host.runPrompt({
      ...inheritedHarnessPolicyOptions(
        await host.store.listRunEvents(continuation.originRun.id),
        continuation.originRun.id,
      ),
      threadId: options.threadId,
      text: formatOperatorDecisionContinuation(decision),
      ...continuation.runOptions,
      parentRunId: continuation.originRun.id,
      operatorDecisionId: decision.id,
      source: "user",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      onRunCreated: async (run) => {
        // The decision binding is already in the same transaction as this Run.
        created = true;
        await options.onRunCreated?.(run);
      },
    });
  } catch (error) {
    if (created || options.signal?.aborted) throw error;
    // Another caller/process may have won while capability/environment setup
    // was awaited. Only the durable binding can authorize this observation.
    const current = await readDecision(host.store, options);
    if (current.status !== "continued") throw error;
    return observeContinuation(host.store, current, options.signal);
  }
}

async function readDecision(
  store: ContinuationStore,
  options: ContinueOperatorDecisionOptions,
): Promise<OperatorDecision> {
  const decision = (await store.listOperatorDecisions(options.threadId)).find(
    (candidate) => candidate.id === options.decisionId,
  );
  if (!decision)
    throw new Error(`Operator decision not found: ${options.decisionId}`);
  return decision;
}

async function observeContinuation(
  store: ContinuationStore,
  decision: OperatorDecision,
  signal?: AbortSignal,
): Promise<RunRecord> {
  for (;;) {
    signal?.throwIfAborted();
    const run = store
      .listRuns(decision.threadId)
      .find((candidate) => candidate.id === decision.continuationRunId);
    if (
      !run ||
      run.threadId !== decision.threadId ||
      run.parentRunId !== decision.runId
    ) {
      throw new Error(
        "Operator decision continuation Run binding is unavailable",
      );
    }
    if (run.status !== "running" && run.status !== "queued") return run;
    // A retry observes the existing executor; it never obtains its lease or
    // invokes model/tools. Await settlement so SSE never emits a false done.
    await delay(100, undefined, { signal });
  }
}

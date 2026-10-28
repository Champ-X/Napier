import type { RunEvent, RunRecord } from "@napier/contracts";
import { projectOperatorDecisions } from "./operator-decisions.js";
import { formatOperatorDecisionContinuation } from "./operator-decision-continuation.js";

/** Restore the answer if a bound continuation died before saving its prompt. */
export async function operatorDecisionRecoveryContext(
  store: { listRunEvents(runId: string): Promise<RunEvent[]> },
  run: RunRecord,
): Promise<string> {
  if (!run.parentRunId) return "";
  const decision = projectOperatorDecisions(
    await store.listRunEvents(run.parentRunId),
  ).find(
    (candidate) =>
      candidate.status === "continued" &&
      candidate.threadId === run.threadId &&
      candidate.runId === run.parentRunId &&
      candidate.continuationRunId === run.id,
  );
  return decision ? formatOperatorDecisionContinuation(decision) : "";
}

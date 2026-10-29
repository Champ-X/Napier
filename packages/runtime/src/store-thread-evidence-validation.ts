import type { ExecutionPlan, RunEvaluationRecord, RunEvent, RunRecord, SubagentTask, ThreadRecord } from "@napier/contracts";
import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import { assertRunEvaluationCompletedEventBindings } from "./evaluation-governance.js";
import { assertAccountingProjection } from "./model-accounting-projection.js";
import { assertPlanArtifactEventBindings } from "./plans.js";
import { validateThreadImportProvenanceLedgerReceipt } from "./thread-import-provenance-validation.js";

type EvidenceState = { runs: RunRecord[]; subagents: SubagentTask[];
  evaluations: RunEvaluationRecord[]; plans: ExecutionPlan[] };

/** The caller must keep state restoration and all evidence reads in one read transaction. */
export function assertLedgerEvidenceProjection(state: EvidenceState & { threads: ThreadRecord[] }, ledger: {
  listEventStats(): Array<{ threadId: string; count: number; maxSeq: number }>;
  listEvents(threadId: string): RunEvent[];
}): void {
  const stats = new Map(ledger.listEventStats().map((item) => [item.threadId, item]));
  for (const thread of state.threads) {
    const threadEvents = ledger.listEvents(thread.id), eventStats = stats.get(thread.id);
    const count = eventStats?.count ?? 0, maxSeq = eventStats?.maxSeq ?? 0;
    if (count !== thread.eventCount || maxSeq !== thread.eventCount) {
      throw new Error(`SQLite ledger projection mismatch for ${thread.id}: state=${thread.eventCount}, events=${count}, maxSeq=${maxSeq}`);
    }
    assertThreadEvidenceProjection(state, thread, threadEvents);
    stats.delete(thread.id);
  }
  if (stats.size > 0) throw new Error(`SQLite ledger contains events for unknown thread ${stats.keys().next().value}`);
}

/** A coherent Thread snapshot must agree with its immutable ledger evidence. */
function assertThreadEvidenceProjection(state: EvidenceState, thread: ThreadRecord, events: RunEvent[]): void {
  if (thread.importProvenance) validateThreadImportProvenanceLedgerReceipt(thread, events);
  for (const [index, event] of events.entries())
    assertArtifactReceiptEventBoundary(event, `Persisted Thread ${thread.id} events[${index}]`);
  for (const run of state.runs.filter((value) => value.threadId === thread.id))
    assertAccountingProjection(run, state.subagents.filter((task) => task.runId === run.id), events.filter((event) => event.runId === run.id));
  assertRunEvaluationCompletedEventBindings({ evaluations: state.evaluations.filter((value) => value.threadId === thread.id),
    events, label: `Persisted Thread ${thread.id}` });
  assertPlanArtifactEventBindings({ plans: state.plans.filter((value) => value.threadId === thread.id),
    events, label: `Persisted Thread ${thread.id}` });
}

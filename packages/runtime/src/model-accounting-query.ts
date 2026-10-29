import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { ModelAccountingRepository } from "./model-accounting-repository.js";
import type { ModelAccountingHost } from "./model-accounting-host.js";
import { aggregateRunUsage } from "./run-replay.js";
import type { LedgerModelAccountingMutation, LedgerModelAccountingPort } from "./sqlite-model-accounting.js";

export type { ModelAccountingRepository } from "./model-accounting-repository.js";
export function modelAccountingRepositoryForStore(host: unknown,
  persist: (events: RunEvent[], mutation: LedgerModelAccountingMutation) => Promise<void>) {
  return new ModelAccountingRepository(host as ModelAccountingHost, persist);
}

export function readLedgerRunReplayView(ledger: LedgerModelAccountingPort, runId: string, threadId?: string) {
  const { snapshot, events } = ledger.readRunAccountingView(runId);
  if (!snapshot) throw new Error("Run replay ledger snapshot is unavailable");
  const state = JSON.parse(snapshot.stateJson) as { runs: Array<RunRecord & { leaseTokenSha256?: string }>; subagents: SubagentTask[] };
  const run = state.runs.find((item) => item.id === runId && (threadId === undefined || item.threadId === threadId));
  if (!run) throw new Error(`Run not found in thread: ${runId}`);
  const { leaseTokenSha256: _token, ...publicRun } = run;
  return { run: publicRun, events, subagents: state.subagents.filter((task) => task.runId === runId), workspaceRevision: snapshot.revision };
}
export function aggregateLedgerRunUsage(ledger: LedgerModelAccountingPort, runId: string) {
  const view = readLedgerRunReplayView(ledger, runId);
  return aggregateRunUsage(view.events, view.subagents);
}
export async function readConsistentThreadDetail<T>(revision: () => number, read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = revision();
    try {
      const detail = await read();
      if (before === revision()) return detail;
    } catch (error) { if (before === revision()) throw error; }
  }
  throw new Error("Thread detail changed during its accounting snapshot read; retry the read");
}

export { assertLedgerEvidenceProjection } from "./store-thread-evidence-validation.js";

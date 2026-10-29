import type { AgentProfile, RunEvent, RunRecord, SubagentTask, ThreadRecord } from "@napier/contracts";
import type { AppendEventInput } from "./run-event-registry.js";

export interface ChildPersistedRun extends RunRecord { leaseTokenSha256?: string }
/** The child lifecycle cannot mutate unrelated workspace aggregates. */
export interface SubagentChildRunHost {
  dataRoot: string;
  workspaceRoot: string;
  state: { runs: ChildPersistedRun[]; subagents: SubagentTask[]; agents: AgentProfile[] };
  stateQueue: { run<T>(operation: () => Promise<T>): Promise<T> };
  assertInitialized(): void;
  persistState(events?: RunEvent | RunEvent[]): Promise<void>;
  requireLedger(): { listRunEvents(runId: string): RunEvent[] };
  mutableRun(runId: string): ChildPersistedRun;
  mutableThread(threadId: string): ThreadRecord;
  appendEventsToThread(thread: ThreadRecord, inputs: AppendEventInput[]): RunEvent[];
}

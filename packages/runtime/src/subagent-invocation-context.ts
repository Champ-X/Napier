import type { RunRecord } from "@napier/contracts";
import { createAgentInvocationContextPreparer } from "./agent-invocation-context.js";

type InvocationStore = Parameters<typeof createAgentInvocationContextPreparer>[0]["store"];

/** Supervisor linkage is authority/accounting metadata, not permission to read
 * the parent's conversation. Only this child's continuation lineage is context. */
export function createSubagentInvocationContextPreparer(store: InvocationStore, run: RunRecord) {
  return createAgentInvocationContextPreparer({ store, run,
    executionLineage: () => childContextLineage(run, store.listRuns(run.threadId)) });
}

function childContextLineage(run: RunRecord, runs: readonly RunRecord[]) {
  const selected: Array<{ runId: string; throughSeq?: number }> = [];
  let current: RunRecord | undefined = run;
  let throughSeq: number | undefined;
  while (current) {
    if (selected.length >= 32 || selected.some((source) => source.runId === current!.id) ||
        current.source !== "subagent" || current.threadId !== run.threadId)
      throw new Error("Child invocation context lineage is invalid");
    selected.push({ runId: current.id, ...(throughSeq !== undefined ? { throughSeq } : {}) });
    const continuation: NonNullable<RunRecord["subagent"]>["continuation"] = current.subagent?.continuation;
    if (!continuation) break;
    if (continuation.targetRunId !== current.id || continuation.targetTaskId !== current.subagent!.taskId ||
        continuation.targetExecutionId !== current.subagent!.executionId || continuation.targetParentRunId !== current.parentRunId)
      throw new Error("Child invocation context continuation target is invalid");
    current = runs.find((source) => source.id === continuation.predecessorRunId);
    if (!current || current.subagent?.taskId !== continuation.predecessorTaskId ||
        current.subagent?.executionId !== continuation.predecessorExecutionId)
      throw new Error("Child invocation context predecessor binding is invalid");
    throughSeq = continuation.predecessorRunHeadSeq;
  }
  return selected;
}

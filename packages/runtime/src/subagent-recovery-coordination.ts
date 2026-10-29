import type { AgentProfile, RunRecord, SubagentTask } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import type { InProcessSubagentProvider } from "./in-process-subagent-provider.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { SubagentProviderOptions } from "./subagent-provider-options.js";
import { authorizeSubagentChildContinuation } from "./subagent-continuation-authorization.js";
import type { SubagentContinuationUnavailableReason } from "./subagent-continuation-types.js";

type SubagentRecoveryStore = Pick<SubagentProviderOptions["store"],
  "listRuns" | "listSubagentTasks" | "listRunEvents" | "prepareSubagentChildContinuation" | "appendEvent">;

export function logicalSubagentDelegationCount(store: SubagentRecoveryStore, run: RunRecord): number {
  const tasks = recoveryLineageTasks(store, run);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return new Set(tasks.map((task) => {
    const seen = new Set<string>();
    while (task.continuedFromTaskId && byId.has(task.continuedFromTaskId)) {
      if (seen.has(task.id)) throw new Error("Child continuation lineage cycle");
      seen.add(task.id); task = byId.get(task.continuedFromTaskId)!;
    }
    return task.id;
  })).size;
}

/** Resolve supported children before the recovered parent's next model request.
 * Prior amounts constrain admission only; aggregateRunUsage still owns physical totals. */
export async function resumeInterruptedSubagents(input: {
  store: SubagentRecoveryStore;
  run: RunRecord;
  parentProfile: AgentProfile;
  configuredProfile: AgentProfile;
  provider: InProcessSubagentProvider;
  budget: RunBudgetTracker;
  signal: AbortSignal;
  onEvent?: EventSink;
}): Promise<string> {
  const { store, run } = input;
  if (run.source !== "recovery" || !run.parentRunId) return "";
  const recoveryStarted = (await store.listRunEvents(run.id)).find((event) => event.type === "run.recovery.started");
  if (!recoveryStarted || !recoveryStarted.payload || typeof recoveryStarted.payload !== "object" ||
      Array.isArray(recoveryStarted.payload) || recoveryStarted.payload["purpose"] === "inspection") return "";
  const lineage = recoveryLineageTasks(store, run).filter((task) => task.runId !== run.id);
  input.budget.syncSubagentUsage(lineage);
  const tasks = store.listSubagentTasks(run.threadId, run.parentRunId).filter((task) => task.childRunId && task.status !== "completed");
  if (!tasks.length) return "";
  const unavailableUsage = lineage.some((task) => task.usageStatus === "incomplete");
  const results = await Promise.all(tasks.map(async (source) => {
    input.signal.throwIfAborted();
    if (unavailableUsage) return unavailable(source, "usage_incomplete");
    let launched;
    try {
      const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId: source.id, targetParentRunId: run.id });
      if (prepared.kind === "unavailable") return unavailable(source, prepared.reason);
      if (prepared.assessment.mode === "continue") assertParentBudgetAvailable();
      const runs = store.listRuns(run.threadId);
      const sourceRun = runs.find((candidate) => candidate.id === prepared.assessment.sourceRunId);
      const sourceParent = runs.find((candidate) => candidate.id === source.runId);
      const targetParent = runs.find((candidate) => candidate.id === run.id);
      if (!sourceRun || !sourceParent || !targetParent) throw new Error("Recovery lineage disappeared");
      const authorization = authorizeSubagentChildContinuation({
        assessment: prepared.assessment, sourceRun, sourceTask: source, sourceParent, targetParent,
        parentProfile: input.parentProfile, configuredProfile: input.configuredProfile, recoveryStarted,
      });
      launched = await input.provider.resume({ ...prepared, authorization, assertParentBudgetAvailable });
    } catch (error) {
      input.signal.throwIfAborted();
      return unavailable(source, "parent_authority_unavailable", error);
    }
    const snapshot = await input.provider.inspect(launched.handle);
    if (launched.kind === "existing" && ["running", "starting", "queued", "waiting_input", "reviewing"].includes(snapshot.status))
      return { taskId: source.id, successorTaskId: launched.handle.taskId, status: "existing_active" };
    const result = await input.provider.collect(launched.handle);
    return { taskId: source.id, successorTaskId: result.task.id, status: result.status };
  }));
  input.budget.syncSubagentUsage(store.listSubagentTasks(run.threadId, run.id));
  return `\n<subagent-continuation-results>${JSON.stringify(results)}</subagent-continuation-results>\n` +
    "Use the durable delegation ledger for recovered child outputs. Unavailable children were not restarted; inspect their preserved evidence and stated boundary before choosing further work.\n";

  function assertParentBudgetAvailable(): void {
    input.budget.syncSubagentUsage(recoveryLineageTasks(store, run));
    input.budget.assertCanStartAuxiliaryCall();
  }

  async function unavailable(task: SubagentTask, reason: SubagentContinuationUnavailableReason, error?: unknown) {
    const event = await store.appendEvent({ threadId: run.threadId, runId: run.id,
      type: "subagent.continuation.unavailable", category: "subagent", visibility: "debug",
      payload: { taskId: task.id, reason,
        ...(error ? { diagnosticSha256: sha256(error instanceof Error ? error.message : String(error)) } : {}) } });
    await emitBestEffort(input.onEvent, event);
    return { taskId: task.id, status: "unavailable", reason };
  }
}

function recoveryLineageTasks(store: SubagentRecoveryStore, run: RunRecord): SubagentTask[] {
  const runs = new Map(store.listRuns(run.threadId).map((item) => [item.id, item]));
  const ids = new Set<string>();
  let current: RunRecord | undefined = run;
  while (current) {
    if (ids.has(current.id) || ids.size >= 64) throw new Error("Parent recovery lineage is invalid");
    ids.add(current.id);
    current = current.source === "recovery" && current.parentRunId ? runs.get(current.parentRunId) : undefined;
  }
  return store.listSubagentTasks(run.threadId).filter((task) => ids.has(task.runId));
}

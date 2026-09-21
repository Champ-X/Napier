import type { Context } from "@earendil-works/pi-ai";
import type { RunRecord, RunEvent, MemoryFact } from "@napier/contracts";
import type { HarnessPolicyProfile } from "@napier/contracts/harness-experiments";
import type { AppendEventInput } from "./run-event-registry.js";
import {
  prepareAgentWorkingStateContext,
  taskWorkingStateForContext,
  workingStateRunLineage,
} from "./agent-working-state-context.js";
import {
  prepareInvocationMemoryContext,
  invocationMemoryForContext,
} from "./agent-memory-context.js";
import { taskMemoryQueryFromEvents } from "./task-memory-query.js";
import { taskBranchHistorySources } from "./task-branch-history.js";
import type { RunBudgetTracker } from "./run-budget.js";
import { bindRunBudgetContext, runBudgetForContext } from "./run-budget-context.js";

/** One preparation boundary for invocation-scoped context. Prepare the state
 * projection before binding memory to the resulting Context identity. Neither
 * projection changes the transcript or manufactures a user/tool message. */
export async function prepareAgentInvocationContext(input: {
  context: Context;
  run: RunRecord;
  store: {
    workspaceRoot: string;
    dataRoot?: string;
    listRuns(threadId: string): RunRecord[];
    listEvents(threadId: string): Promise<RunEvent[]>;
    listRunEvents(runId: string): Promise<RunEvent[]>;
    listMemories(options: { agentId: string }): MemoryFact[];
    appendEvent(event: AppendEventInput): Promise<unknown>;
  };
  policy?: HarnessPolicyProfile["context"] | undefined;
  budget?: RunBudgetTracker;
}): Promise<Context> {
  const budgetEnabled = input.policy?.finalization === "request-aware-v2";
  if (budgetEnabled && !input.budget)
    throw new Error("Request-aware budget context requires the current Run tracker");
  const stateEnabled = input.policy?.workingState === "evidence-v1";
  const memoryEnabled =
    input.policy?.memory === "task-aware-v1" ||
    input.policy?.memory === "task-aware-selective-v2" ||
    input.policy?.memory === "task-aware-grouped-v3";
  const threadRuns =
    stateEnabled || memoryEnabled
      ? input.store
          .listRuns(input.run.threadId)
          .filter((run) => run.threadId === input.run.threadId)
      : [];
  const lineage = stateEnabled
    ? workingStateRunLineage(input.run, threadRuns)
    : [input.run.id];
  // Conversation queries include ordinary prior turns, not only recovery
  // ancestors. Branches already own copied local history up to their cutoff.
  // Working-state tool evidence remains restricted to the recovery lineage.
  const events = memoryEnabled
    ? await input.store.listEvents(input.run.threadId)
    : stateEnabled
      ? (
          await Promise.all(lineage.map((id) => input.store.listRunEvents(id)))
        ).flat()
      : [];
  const branchHistory = taskBranchHistorySources({
    threadId: input.run.threadId,
    runs: threadRuns,
    events,
  });
  const context = await prepareAgentWorkingStateContext({
    context: budgetEnabled ? { ...input.context } : input.context,
    runId: input.run.id,
    workspaceRoot: input.store.workspaceRoot,
    enabled: stateEnabled,
    sourceRunIds: lineage,
    branchHistory,
    listEvents: async () =>
      events.filter(
        (event) =>
          event.threadId === input.run.threadId &&
          lineage.includes(event.runId),
      ),
  });
  await prepareInvocationMemoryContext({
    context,
    store: input.store,
    run: input.run,
    enabled: memoryEnabled,
    ...(memoryEnabled
      ? {
          taskQuery: taskMemoryQueryFromEvents({
            events,
            threadId: input.run.threadId,
            branchHistory,
            sourceRunIds: [
              ...new Set([input.run.id, ...threadRuns.map((run) => run.id)]),
            ],
          }),
        }
      : {}),
    policy: input.policy?.memory,
    record: async (event) => {
      await input.store.appendEvent(event);
    },
  });
  if (budgetEnabled) bindRunBudgetContext(context, input.budget!);
  return context;
}

export function agentInvocationContextFor(context: Context) {
  return {
    workingState: taskWorkingStateForContext(context),
    memory: invocationMemoryForContext(context),
    budget: runBudgetForContext(context),
  };
}

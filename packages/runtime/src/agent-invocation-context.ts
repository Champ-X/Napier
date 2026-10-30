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
import { RunInvocationContextCursor } from "./run-invocation-context-cursor.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";

/** The model lifecycle owns one preparation scope, including its optional native
 * event reader. Each call still evaluates current policy, memory, files and budget. */
export function createAgentInvocationContextPreparer(
  owner: Pick<Parameters<typeof prepareAgentInvocationContext>[0], "store" | "run"> & {
    executionLineage?: () => readonly { runId: string; throughSeq?: number }[];
  },
) {
  const eventCursor = new RunInvocationContextCursor(owner.store, owner.run);
  return (input: Omit<Parameters<typeof prepareAgentInvocationContext>[0], "store" | "run" | "eventCursor" | "executionLineage">) =>
    prepareAgentInvocationContext({ ...input, store: owner.store, run: owner.run, eventCursor,
      ...(owner.executionLineage ? { executionLineage: owner.executionLineage() } : {}) });
}

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
  } & Partial<Pick<RunEventQueryPort, "findLatestEvent" | "listEventsRange">>;
  policy?: HarnessPolicyProfile["context"] | undefined;
  budget?: RunBudgetTracker;
  eventCursor?: RunInvocationContextCursor;
  /** An owner-validated execution lineage, distinct from supervisor ancestry. */
  executionLineage?: readonly { runId: string; throughSeq?: number }[];
}): Promise<Context> {
  const budgetEnabled = input.policy?.finalization === "request-aware-v2";
  if (budgetEnabled && !input.budget)
    throw new Error("Request-aware budget context requires the current Run tracker");
  const stateEnabled = input.policy?.workingState === "evidence-v1";
  const memoryEnabled =
    input.policy?.memory === "task-aware-v1" ||
    input.policy?.memory === "task-aware-selective-v2" ||
    input.policy?.memory === "task-aware-grouped-v3";
  const { scope, threadRuns } = invocationExecutionSources(input, stateEnabled || memoryEnabled);
  const lineage = stateEnabled
    ? input.executionLineage?.map((source) => source.runId) ?? workingStateRunLineage(input.run, threadRuns)
    : [input.run.id];
  const project = (events: RunEvent[]) => prepareFromEvents(input, {
    events, threadRuns, lineage, budgetEnabled, stateEnabled, memoryEnabled,
  });
  if (memoryEnabled && !scope && input.eventCursor?.canRead(input.run, threadRuns))
    return input.eventCursor.refresh(project);
  // Conversation queries include ordinary prior turns, not only recovery
  // ancestors. Branches already own copied local history up to their cutoff.
  // Working-state tool evidence remains restricted to the recovery lineage.
  const events = scope && (memoryEnabled || stateEnabled)
    ? (await Promise.all(input.executionLineage!.map(async ({ runId, throughSeq }) =>
        (await input.store.listRunEvents(runId)).filter((event) => event.runId === runId &&
          event.threadId === input.run.threadId && (throughSeq === undefined || event.seq <= throughSeq))))).flat()
    : memoryEnabled
    ? await input.store.listEvents(input.run.threadId)
    : stateEnabled
      ? (
          await Promise.all(lineage.map((id) => input.store.listRunEvents(id)))
        ).flat()
      : [];
  return project(events);
}

function invocationExecutionSources(input: Parameters<typeof prepareAgentInvocationContext>[0], enabled: boolean) {
  const scope = input.executionLineage ? new Set(input.executionLineage.map((source) => source.runId)) : undefined;
  if (scope && (!scope.has(input.run.id) || scope.size !== input.executionLineage!.length || scope.size > 32 ||
      input.executionLineage!.some(({ throughSeq }) => throughSeq !== undefined && (!Number.isSafeInteger(throughSeq) || throughSeq < 1))))
    throw new Error("Invocation context execution lineage is invalid");
  const threadRuns =
    enabled
      ? input.store
          .listRuns(input.run.threadId)
          .filter((run) => run.threadId === input.run.threadId && (!scope || scope.has(run.id)))
      : [];
  if (scope && enabled && threadRuns.length !== scope.size)
    throw new Error("Invocation context execution source is unavailable in this thread");
  return { scope, threadRuns };
}

async function prepareFromEvents(
  input: Parameters<typeof prepareAgentInvocationContext>[0],
  scope: { events: RunEvent[]; threadRuns: RunRecord[]; lineage: string[];
    budgetEnabled: boolean; stateEnabled: boolean; memoryEnabled: boolean },
): Promise<Context> {
  const { events, threadRuns, lineage, budgetEnabled, stateEnabled, memoryEnabled } = scope;
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

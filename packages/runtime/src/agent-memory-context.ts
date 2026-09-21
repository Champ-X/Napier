import type { RunRecord, MemoryFact } from "@napier/contracts";
import type { ContextPolicy } from "@napier/contracts/harness-experiments";
import type { Context } from "@earendil-works/pi-ai";
import type { AppendEventInput } from "./run-event-registry.js";
import { sha256 } from "./ed25519.js";
import { formatMemoryContext } from "./memory.js";
import { formatTaskMemoryContext } from "./task-memory-context.js";
import { runExecutionBoundary } from "./effective-run-profile.js";
import type { taskMemoryQueryFromEvents } from "./task-memory-query.js";
const invocationMemories = new WeakMap<Context, string>();

/** Recheck source versions and review status for every invocation. A fact
 * loaded at Run start must not outlive a later edit, review or expiry. */
export async function prepareInvocationMemoryContext(input: {
  context: Context;
  store: Pick<
    AgentMemoryContextStore,
    "workspaceRoot" | "dataRoot" | "listMemories"
  >;
  run: Pick<RunRecord, "id" | "threadId" | "agentId" | "configuration">;
  enabled: boolean;
  policy?: ContextPolicy["memory"] | undefined;
  taskQuery?: ReturnType<typeof taskMemoryQueryFromEvents>;
  record(event: AppendEventInput): Promise<unknown>;
}) {
  if (!input.enabled) return;
  const query =
    input.taskQuery?.text ??
    input.context.messages
      .filter((message) => message.role === "user")
      .toReversed()
      .slice(0, 8)
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(" "),
      )
      .join("\n");
  const memory = await formatTaskMemoryContext({
    facts: input.store.listMemories({ agentId: input.run.agentId }),
    agentId: input.run.agentId,
    query,
    policy: input.policy,
    workspaceRoot: input.store.workspaceRoot,
    ...(!runExecutionBoundary(input.run.configuration).restricted &&
    input.store.dataRoot
      ? { dataRoot: input.store.dataRoot }
      : {}),
  });
  invocationMemories.set(input.context, memory.text);
  await input.record({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "context.memory",
    category: "memory",
    visibility: "debug",
    payload: {
      factIds: memory.factIds,
      count: memory.factIds.length,
      truncated: memory.truncated,
      staleFactIds: memory.staleFactIds,
      retrievalVersion: memory.retrievalVersion,
      selection: memory.selection,
      ...(input.taskQuery ? { query: input.taskQuery.receipt } : {}),
      ...(memory.grouping ? { grouping: memory.grouping } : {}),
      index: memory.index,
      phase: "model_invocation",
      contentSha256: memory.text ? sha256(memory.text) : "",
    },
  });
}

export function invocationMemoryForContext(
  context: Context,
): string | undefined {
  return invocationMemories.get(context);
}

interface AgentMemoryContextStore {
  workspaceRoot: string;
  dataRoot?: string;
  listMemories(options: { agentId: string }): MemoryFact[];
  expireDueMemories(options: { agentId: string }): Promise<MemoryFact[]>;
  recordMemoryUsage(ids: string[], runId: string): Promise<unknown>;
}

export async function prepareAgentMemoryContext(input: {
  store: AgentMemoryContextStore;
  run: Pick<RunRecord, "id" | "threadId">;
  agentId: string;
  restrictedReadOnly: boolean;
  query: string;
  taskAware?: boolean;
  policy?: ContextPolicy["memory"] | undefined;
  record(event: AppendEventInput): Promise<unknown>;
}) {
  const { store, run, agentId, restrictedReadOnly } = input;
  const expired = restrictedReadOnly
    ? []
    : await store.expireDueMemories({ agentId });
  for (const memory of expired) {
    await input.record({
      threadId: run.threadId,
      runId: run.id,
      type: "memory.stale",
      category: "memory",
      visibility: "user",
      payload: {
        memoryId: memory.id,
        scope: memory.scope,
        ...(memory.agentId ? { agentId: memory.agentId } : {}),
        reviewDueAt: memory.reviewDueAt ?? "",
        reason: "review_due",
        useCount: memory.useCount,
      },
    });
  }
  const facts = store.listMemories({ agentId });
  const taskContext = (
    input.policy ? input.policy !== "legacy" : input.taskAware
  )
    ? await formatTaskMemoryContext({
        facts,
        agentId,
        query: input.query,
        policy: input.policy,
        workspaceRoot: store.workspaceRoot,
        ...(!restrictedReadOnly && store.dataRoot
          ? { dataRoot: store.dataRoot }
          : {}),
      })
    : undefined;
  const context = taskContext ?? formatMemoryContext(facts, agentId);
  if (!restrictedReadOnly)
    await store.recordMemoryUsage(context.factIds, run.id);
  await input.record({
    threadId: run.threadId,
    runId: run.id,
    type: "context.memory",
    category: "memory",
    visibility: "debug",
    payload: {
      factIds: context.factIds,
      count: context.factIds.length,
      truncated: context.truncated,
      ...(taskContext
        ? {
            staleFactIds: taskContext.staleFactIds,
            retrievalVersion: taskContext.retrievalVersion,
            selection: taskContext.selection,
            ...(taskContext.grouping ? { grouping: taskContext.grouping } : {}),
            index: taskContext.index,
          }
        : {}),
      contentSha256: context.text ? sha256(context.text) : "",
    },
  });
  return context;
}

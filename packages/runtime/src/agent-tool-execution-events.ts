import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { RunRecord, SubagentTask } from "@napier/contracts";

import {
  agentToolCallArgumentsLedgerProjection,
  agentToolGenericDetailsLedgerProjection,
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";

export { agentToolCallArgumentsLedgerProjection };
import { agentToolResultText } from "./agent-tool-result-text.js";
import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";
import { builtInToolHarnessProjection } from "./agent-tool-effects.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { claimRunHeadEvent } from "./event-idempotency.js";
import type { PrivateSourceModelContentBoundary } from "./private-source-model-content.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { RunProgressTracker } from "./run-progress-vector.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { toolOperationSetLedgerProjection } from "./tool-operation-journal.js";
import type { ToolOperationJournalStore } from "./tool-operation-model.js";
import { createToolCallSha256 } from "./tool-loop-guard.js";
import { sha256Text } from "./agent-runtime-utils.js";

interface AgentToolExecutionStore extends ToolOperationJournalStore {
  listSubagentTasks(threadId: string, runId?: string): SubagentTask[];
}

export function agentToolStartedLedgerProjection(
  lifecycle: AgentToolResultLifecycle,
  toolCallId: string,
  toolName: string,
  args: unknown,
) {
  return {
    callInputSha256: createToolCallSha256(toolName, args),
    ...builtInToolHarnessProjection(toolName, args),
    ...lifecycle.toolInput(
      args,
      agentToolInputLedgerProjection(toolName, args),
    ),
    ...lifecycle.startedProjection(toolName, args),
    ...lifecycle.protocolProjection(toolCallId, toolName, "started", args),
  };
}

type ToolExecutionEvent = Extract<
  AgentEvent,
  { type: "tool_execution_start" | "tool_execution_end" }
>;

interface AgentToolExecutionEventContext {
  store: AgentToolExecutionStore;
  run: RunRecord;
  lifecycle: AgentToolResultLifecycle;
  progress: RunProgressTracker;
  budget: RunBudgetTracker;
  privateSourceContent: PrivateSourceModelContentBoundary;
  onEvent?: EventSink;
}

export async function recordAgentToolExecutionEvent(
  context: AgentToolExecutionEventContext,
  event: ToolExecutionEvent,
): Promise<void> {
  if (event.type === "tool_execution_start") {
    // pi-agent announces a requested execution before argument validation and
    // policy preflight. The lifecycle wrapper records the canonical started
    // phase only after durable admission and resource acquisition.
    return;
  }
  await recordToolSettled(context, event);
}

async function recordToolSettled(
  context: AgentToolExecutionEventContext,
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): Promise<void> {
  const { budget, lifecycle, privateSourceContent, progress, run, store } =
    context;
  privateSourceContent.observeToolResult(event.toolName);
  const output = agentToolResultText(event.result);
  const reusedProjection = lifecycle.reusedTerminalProjection(event.toolCallId);
  const outputProjection = reusedProjection
    ? {}
    : agentToolOutputLedgerProjection(event.toolName, output, event.result);
  const operationSetProjection = await toolOperationSetLedgerProjection(
    store,
    { threadId: run.threadId, runId: run.id },
    event.toolCallId,
  );
  const receipt = await appendTerminalOnce(store, run, {
    threadId: run.threadId,
    runId: run.id,
    type: event.isError ? "tool.failed" : "tool.completed",
    category: "tool",
    visibility: "user",
    payload: {
      callId: event.toolCallId,
      toolName: event.toolName,
      status: event.isError ? "failed" : "completed",
      outputTextSha256: sha256Text(output),
      outputTextBytes: Buffer.byteLength(output, "utf8"),
      ...operationSetProjection,
      ...(reusedProjection
        ? reusedProjection
        : {
            ...outputProjection,
            ...agentToolGenericDetailsLedgerProjection(
              event.toolName,
              outputProjection,
              event.result.details,
            ),
          }),
      ...(event.isError
        ? lifecycle.failureProjection(
            event.toolCallId,
            event.toolName,
            event.result,
          )
        : {}),
      ...lifecycle.protocolProjection(
        event.toolCallId,
        event.toolName,
        event.isError ? "failed" : "completed",
        undefined,
        event.result,
        event.isError,
      ),
    },
  });
  if (!receipt.appended) return;
  await emitBestEffort(context.onEvent, receipt.event);
  progress.observeEvent(receipt.event);
  if (["delegate_task", "subagent_collect"].includes(event.toolName)) {
    budget.syncSubagentUsage(store.listSubagentTasks(run.threadId, run.id));
  }
}

async function appendTerminalOnce(
  store: AgentToolExecutionStore,
  run: Pick<RunRecord, "id" | "threadId">,
  input: AppendEventInput,
) {
  return claimRunHeadEvent(store, input, {
    namespace: "durable-tool-execution-terminal",
    key: `${run.id}:${String(input.payload["callId"])}:terminal`,
  });
}

import type { RunInvocationSource, RunRecord, Usage } from "@napier/contracts";

import type { RunPromptOptions } from "./agent-runtime-options.js";
import type { EventSink } from "./event-sink.js";
import type { LocalStore } from "./store.js";

export async function recordAgentRunRecoveryStarted(input: {
  store: LocalStore;
  run: RunRecord;
  invocationSource: RunInvocationSource;
  parentRunId?: string;
  recovery?: RunPromptOptions["recovery"];
  onEvent?: EventSink;
}): Promise<void> {
  if (input.invocationSource !== "recovery" || !input.parentRunId) return;
  await record(
    input.store,
    {
      threadId: input.run.threadId,
      runId: input.run.id,
      type: "run.recovery.started",
      category: "lifecycle",
      visibility: "user",
      payload: {
        parentRunId: input.parentRunId,
        status: "running",
        mode: input.recovery?.mode ?? "manual",
        ...(input.recovery?.attemptId
          ? { attemptId: input.recovery.attemptId }
          : {}),
        ...(input.recovery?.assessmentSha256
          ? { assessmentSha256: input.recovery.assessmentSha256 }
          : {}),
      },
    },
    input.onEvent,
  );
}

export async function finishSuccessfulAgentRun(input: {
  store: LocalStore;
  run: RunRecord;
  invocationSource: RunInvocationSource;
  parentRunId?: string;
  recovery?: RunPromptOptions["recovery"];
  usage: Usage;
  leaseToken: string;
  onEvent?: EventSink;
}): Promise<RunRecord> {
  if (input.invocationSource === "recovery" && input.parentRunId) {
    await record(
      input.store,
      {
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "run.recovery.completed",
        category: "lifecycle",
        visibility: "user",
        payload: {
          parentRunId: input.parentRunId,
          status: "completed",
          mode: input.recovery?.mode ?? "manual",
          ...(input.recovery?.attemptId
            ? { attemptId: input.recovery.attemptId }
            : {}),
        },
      },
      input.onEvent,
    );
  }
  return input.store.finishRun(input.run.id, "completed", {
    usage: input.usage,
    leaseToken: input.leaseToken,
    terminalEvent: {
      visibility: "debug",
      payload: { status: "completed" },
    },
    onTerminalEvent: input.onEvent,
  });
}

async function record(
  store: LocalStore,
  event: Parameters<LocalStore["appendEvent"]>[0],
  onEvent?: EventSink,
): Promise<void> {
  const appended = await store.appendEvent(event);
  if (!onEvent) return;
  try {
    await onEvent(appended);
  } catch {
    // A disconnected stream must not cancel durable agent execution.
  }
}

import type {
  JsonValue,
  ModelRef,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import type { ContextCompactionPreview } from "@napier/contracts/context-compaction";

import { toJsonValue } from "./agent-runtime-utils.js";
import { createContextCheckpoint } from "./compaction.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import { planManualContextCompaction } from "./manual-context-compaction.js";
import type { LocalStore } from "./store.js";
import { createThreadBranch } from "./thread-branches.js";

const RUN_LEASE_TTL_MS = 60_000;
type MaterializedContextCheckpoint = ReturnType<
  typeof createContextCheckpoint
> & {
  continuityProjectionVersion: 1;
  continuityEventCount: number;
  continuitySha256: string;
};

export class ContextCompactionPreviewChangedError extends Error {
  constructor() {
    super("Context compaction source changed; generate a new preview");
    this.name = "ContextCompactionPreviewChangedError";
  }
}

export async function materializeContextCompactionFork(input: {
  store: LocalStore;
  sourceThreadId: string;
  sourceEventCount: number;
  preview: ContextCompactionPreview;
  workerId: string;
  title?: string;
}): Promise<{
  targetThreadId: string;
  checkpoint: MaterializedContextCheckpoint;
}> {
  const branch = await createThreadBranch(input.store, input.sourceThreadId, {
    fromSeq: input.sourceEventCount,
    ...(input.title ? { title: input.title } : {}),
  });
  const targetEvents = await input.store.listEvents(branch.detail.thread.id);
  const targetPlan = planManualContextCompaction(
    targetEvents,
    input.preview.retainedMessageCount,
  );
  const sourceEvents = await input.store.listEvents(input.sourceThreadId);
  const sourcePlan = planManualContextCompaction(
    sourceEvents,
    input.preview.retainedMessageCount,
  );
  if (
    targetPlan.compactEvents.length !== input.preview.sourceMessageCount ||
    sourceMessageTextSha256(targetPlan.compactEvents) !==
      sourceMessageTextSha256(sourcePlan.compactEvents)
  ) {
    throw new ContextCompactionPreviewChangedError();
  }
  const checkpoint = createContextCheckpoint({
    checkpointId: createId("checkpoint"),
    compactEvents: targetPlan.compactEvents,
    continuityEvents: targetPlan.compactContinuityEvents,
    retainedFromSeq: targetPlan.recentEvents[0]!.seq,
    result: {
      summary: input.preview.summary,
      decisions: input.preview.decisions,
      openLoops: input.preview.openLoops,
      artifacts: input.preview.artifacts,
    },
  }) as MaterializedContextCheckpoint;
  const targetLease = await input.store.createLeasedRun(
    {
      threadId: branch.detail.thread.id,
      agentId: branch.detail.thread.agentId,
      model: input.preview.model,
      source: "context_compaction",
      executionMode: "context_compaction_single_call",
      parentRunId: branch.run.id,
    },
    { ownerId: input.workerId, ttlMs: RUN_LEASE_TTL_MS },
  );
  try {
    await appendContextCompactionRunStarted(
      input.store,
      targetLease.run,
      input.preview.model,
    );
    await input.store.appendEvent({
      threadId: branch.detail.thread.id,
      runId: targetLease.run.id,
      type: "context.compaction.completed",
      category: "model",
      visibility: "user",
      payload: toJsonValue({
        ...checkpoint,
        previewSha256: input.preview.previewSha256,
        sourceThreadId: input.sourceThreadId,
        previewSourceEventCount: input.preview.sourceEventCount,
        sourceEventSetSha256: input.preview.sourceEventSetSha256,
        sourceMessageSha256: input.preview.sourceMessageSha256,
        sourceContinuitySha256: input.preview.continuitySha256,
      }),
      admission: "run_active",
    });
    await input.store.appendEvent({
      threadId: branch.detail.thread.id,
      runId: targetLease.run.id,
      type: "context.compaction.forked",
      category: "model",
      visibility: "user",
      payload: {
        schemaVersion: 1,
        sourceThreadId: input.sourceThreadId,
        targetThreadId: branch.detail.thread.id,
        previewSha256: input.preview.previewSha256,
        checkpointId: checkpoint.checkpointId,
        sourceEventSetSha256: input.preview.sourceEventSetSha256,
      },
      admission: "run_active",
    });
    await input.store.finishRun(targetLease.run.id, "completed", {
      leaseToken: targetLease.token,
      terminalEvent: contextCompactionRunTerminalEvent("completed"),
    });
  } catch (error) {
    await input.store
      .finishRun(targetLease.run.id, "failed", {
        error: "Context compaction fork materialization failed",
        leaseToken: targetLease.token,
        terminalEvent: contextCompactionRunTerminalEvent("failed"),
      })
      .catch(() => undefined);
    throw error;
  }
  return { targetThreadId: branch.detail.thread.id, checkpoint };
}

export async function appendContextCompactionRunStarted(
  store: LocalStore,
  run: RunRecord,
  model: ModelRef,
): Promise<void> {
  await store.appendEvent({
    threadId: run.threadId,
    runId: run.id,
    type: "run.started",
    category: "lifecycle",
    visibility: "debug",
    payload: {
      agentId: run.agentId,
      model: `${model.provider}/${model.id}`,
      source: "context_compaction",
      configurationSha256: run.configuration?.contentSha256 ?? "",
    },
    admission: "run_active",
  });
}

export function contextCompactionRunTerminalEvent(
  status: "completed" | "failed",
): {
  visibility: "debug" | "user";
  payload: { status: "completed" | "failed" };
} {
  return {
    visibility: status === "completed" ? "debug" : "user",
    payload: { status },
  };
}

function sourceMessageTextSha256(events: RunEvent[]): string {
  return sha256(
    canonicalJson(
      events.map((event) => ({
        type: event.type,
        visibility: event.visibility,
        payload: event.payload as JsonValue,
      })),
    ),
  );
}

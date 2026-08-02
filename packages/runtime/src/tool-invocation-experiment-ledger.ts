import type {
  JsonValue,
  RunEvent,
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentStatus,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";

export async function appendToolExperimentComparison(
  store: LocalStore,
  threadId: string,
  runId: string,
  preview: ToolInvocationExperimentPreview,
  comparison: ToolInvocationExperimentComparison,
  onEvent?: EventSink,
): Promise<void> {
  await appendToolExperimentEvent(
    store,
    {
      threadId,
      runId,
      type: "tool.experiment.compared",
      category: "tool",
      visibility: "user",
      payload: {
        schemaVersion: 1,
        sourceThreadId: preview.sourceThreadId,
        sourceRunId: preview.sourceRunId,
        sourceCallId: preview.sourceCallId,
        sourceToolName: preview.sourceToolName,
        previewSha256: preview.previewSha256,
        status: comparison.target.status,
        outputChanged: comparison.outputChanged,
        durationMsDelta: comparison.durationMsDelta,
        comparisonSha256: comparison.contentSha256,
      },
    },
    onEvent,
  );
}

export async function appendToolExperimentTerminal(
  store: LocalStore,
  threadId: string,
  runId: string,
  status: ToolInvocationExperimentStatus,
  onEvent?: EventSink,
  error?: unknown,
): Promise<void> {
  await appendToolExperimentEvent(
    store,
    {
      threadId,
      runId,
      type:
        status === "completed"
          ? "run.completed"
          : status === "cancelled"
            ? "run.cancelled"
            : "run.failed",
      category: "lifecycle",
      visibility: "debug",
      payload: {
        status,
        ...(error ? { diagnosticSha256: sha256(errorMessage(error)) } : {}),
      },
    },
    onEvent,
  );
}

export async function appendToolExperimentEvent(
  store: LocalStore,
  input: Parameters<LocalStore["appendEvent"]>[0],
  onEvent?: EventSink,
): Promise<RunEvent> {
  const event = await store.appendEvent(input);
  if (onEvent) {
    try {
      await onEvent(event);
    } catch {
      // A disconnected observer must not cancel durable execution.
    }
  }
  return event;
}

export function toolExperimentStartedPayload(
  preview: ToolInvocationExperimentPreview,
): Record<string, JsonValue> {
  return {
    schemaVersion: 1,
    sourceThreadId: preview.sourceThreadId,
    sourceRunId: preview.sourceRunId,
    sourceCallId: preview.sourceCallId,
    sourceCapsuleEventSeq: preview.sourceCapsuleEventSeq,
    sourceStartedEventSeq: preview.sourceStartedEventSeq,
    sourceTerminalEventSeq: preview.sourceTerminalEventSeq,
    sourceToolName: preview.sourceToolName,
    sourceToolDefinitionSha256: preview.sourceToolDefinitionSha256,
    sourceArgumentsSha256: preview.sourceArgumentsSha256,
    sourceWorkspaceScopeSha256: preview.sourceWorkspaceScopeSha256,
    candidateWorkspaceSnapshotSha256: preview.candidateWorkspaceSnapshotSha256,
    previewSha256: preview.previewSha256,
    targetExecutionMode: preview.targetExecutionMode,
  };
}

export function toolResultDetails(result: unknown): JsonValue | undefined {
  if (!result || typeof result !== "object" || !("details" in result)) {
    return undefined;
  }
  const value = result.details;
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

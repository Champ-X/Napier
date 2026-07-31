import path from "node:path";

import type {
  CreateToolInvocationExperimentRequest,
  RunEvent,
  RunRecord,
  ToolInvocationCapsuleReceipt,
  ToolInvocationExperimentObservation,
  ToolInvocationExperimentPreview,
} from "@napier/contracts";

import type { AgentRuntime } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { observeSourceToolInvocation } from "./tool-invocation-experiment-model.js";
import {
  validateCreateToolInvocationExperimentRequest,
  validateToolInvocationExperimentPreview,
} from "./tool-invocation-experiment-protocol.js";
import { resolveToolInvocationExperimentTool } from "./tool-invocation-experiment-tool.js";
import {
  type ToolInvocationCapsule,
  validateToolInvocationCapsuleReceipt,
} from "./tool-invocation-capsule.js";
import type { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";
import type { LocalStore } from "./store.js";
import { createWorkspacePathSnapshot } from "./workspace-snapshot.js";

export interface ToolInvocationExperimentSource {
  preview: ToolInvocationExperimentPreview;
  sourceRun: RunRecord;
  capsule: ToolInvocationCapsule;
  sourceObservation: ToolInvocationExperimentObservation;
  capsuleEvent: RunEvent;
  startedEvent: RunEvent;
  terminalEvent: RunEvent;
  title: string;
}

export async function projectToolInvocationExperimentSource(
  store: LocalStore,
  runtime: AgentRuntime,
  capsules: ToolInvocationCapsuleStore,
  sourceThreadId: string,
  input: CreateToolInvocationExperimentRequest,
): Promise<ToolInvocationExperimentSource> {
  const request = validateCreateToolInvocationExperimentRequest(input);
  const thread = store.getThread(sourceThreadId);
  const sourceRun = store
    .listRuns(sourceThreadId)
    .find((run) => run.id === request.sourceRunId);
  if (
    !sourceRun ||
    sourceRun.threadId !== sourceThreadId ||
    sourceRun.status === "queued" ||
    sourceRun.status === "running" ||
    !sourceRun.configuration ||
    !sourceRun.agentRevision
  ) {
    throw new Error(
      "Tool invocation experiment source Run must be terminal and configured",
    );
  }
  const events = await store.listEvents(sourceThreadId);
  const capsuleEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === "context.tool_invocation" &&
      receiptCallId(event) === request.sourceCallId,
  );
  if (capsuleEvents.length !== 1) {
    throw new Error(
      "Tool invocation experiment source capsule evidence is unavailable",
    );
  }
  const capsuleEvent = capsuleEvents[0]!;
  const receipt = validateToolInvocationCapsuleReceipt(capsuleEvent.payload);
  const startedEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === "tool.started" &&
      event.seq < capsuleEvent.seq &&
      toolEventBinding(event, receipt),
  );
  if (startedEvents.length !== 1) {
    throw new Error(
      "Tool invocation experiment source start evidence is invalid",
    );
  }
  const startedEvent = startedEvents[0]!;
  const terminalEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === "tool.completed" &&
      event.seq > capsuleEvent.seq &&
      toolEventBinding(event, receipt),
  );
  if (terminalEvents.length !== 1) {
    throw new Error(
      "Tool invocation experiment source completion evidence is invalid",
    );
  }
  const terminalEvent = terminalEvents[0]!;
  const capsule = await capsules.read(receipt.capsuleSha256);
  if (
    capsule.sourceThreadId !== sourceThreadId ||
    capsule.sourceRunId !== sourceRun.id ||
    capsule.callId !== receipt.callId ||
    capsule.toolName !== receipt.toolName ||
    capsule.effect !== receipt.effect ||
    capsule.toolDefinitionSha256 !== receipt.toolDefinitionSha256 ||
    capsule.argumentsSha256 !== receipt.argumentsSha256 ||
    capsule.workspaceScopeSha256 !== receipt.workspaceScopeSha256 ||
    capsule.contentSha256 !== receipt.capsuleSha256
  ) {
    throw new Error(
      "Tool invocation experiment local capsule does not match the Ledger",
    );
  }
  resolveToolInvocationExperimentTool({
    store,
    runtime,
    agentId: sourceRun.agentId,
    agentRevision: sourceRun.agentRevision,
    threadId: sourceThreadId,
    runId: sourceRun.id,
    toolName: capsule.toolName,
    arguments: capsule.arguments,
    expectedDefinitionSha256: capsule.toolDefinitionSha256,
  });
  const workspace = await createWorkspacePathSnapshot(
    store.workspaceRoot,
    path.resolve(store.workspaceRoot, capsule.workspaceScope),
  );
  if (workspace.truncated) {
    throw new Error(
      "Tool invocation experiment workspace scope exceeds snapshot limits",
    );
  }
  const sourceObservation = observeSourceToolInvocation({
    sourceThreadId,
    sourceRunId: sourceRun.id,
    toolName: capsule.toolName,
    startedEvent,
    terminalEvent,
  });
  const content = {
    kind: "napier.tool-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId,
    sourceRunId: sourceRun.id,
    sourceAgentId: sourceRun.agentId,
    sourceAgentRevision: sourceRun.agentRevision,
    sourceCallId: receipt.callId,
    sourceCapsuleEventSeq: capsuleEvent.seq,
    sourceStartedEventSeq: startedEvent.seq,
    sourceTerminalEventSeq: terminalEvent.seq,
    sourceToolName: receipt.toolName,
    sourceEffect: "read" as const,
    sourceToolDefinitionSha256: receipt.toolDefinitionSha256,
    sourceArgumentsSha256: receipt.argumentsSha256,
    sourceWorkspaceScopeSha256: receipt.workspaceScopeSha256,
    sourceCapsuleSha256: receipt.capsuleSha256,
    sourceCapsuleBytes: receipt.capsuleBytes,
    sourceDurationMs: sourceObservation.durationMs,
    sourceOutputSha256: sourceObservation.outputSha256,
    sourceOutputBytes: sourceObservation.outputBytes,
    candidateWorkspaceSnapshotSha256: workspace.sha256,
    candidateWorkspaceFileCount: workspace.fileCount,
    candidateWorkspaceBytes: workspace.bytes,
    targetExecutionMode: "tool_experiment_read_only" as const,
  };
  const preview = validateToolInvocationExperimentPreview({
    ...content,
    previewSha256: sha256(canonicalJson(content)),
  });
  return {
    preview,
    sourceRun,
    capsule,
    sourceObservation,
    capsuleEvent,
    startedEvent,
    terminalEvent,
    title:
      request.title ?? defaultExperimentTitle(thread.title, capsule.toolName),
  };
}

function defaultExperimentTitle(sourceTitle: string, toolName: string): string {
  const suffix = ` / ${toolName} replay`;
  return `${sourceTitle.slice(0, Math.max(1, 160 - suffix.length)).trim()}${suffix}`;
}

function receiptCallId(event: RunEvent): string | undefined {
  try {
    return validateToolInvocationCapsuleReceipt(event.payload).callId;
  } catch {
    return undefined;
  }
}

function toolEventBinding(
  event: RunEvent,
  receipt: ToolInvocationCapsuleReceipt,
): boolean {
  const payload = record(event.payload);
  return (
    payload?.["callId"] === receipt.callId &&
    payload["toolName"] === receipt.toolName
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

import type {
  CreateModelInvocationExperimentRequest,
  ModelInvocationCapsuleReceipt,
  ModelInvocationExperimentObservation,
  ModelInvocationExperimentPreview,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelInvocationCapsuleStore } from "./model-invocation-capsule-store.js";
import {
  type ModelInvocationCapsule,
  validateModelInvocationCapsuleReceipt,
} from "./model-invocation-capsule.js";
import { observeSourceModelInvocation } from "./model-invocation-experiment-model.js";
import {
  validateCreateModelInvocationExperimentRequest,
  validateModelInvocationExperimentPreview,
} from "./model-invocation-experiment-protocol.js";
import {
  MODEL_CONTEXT_ENVELOPE_EVENT,
  validateModelContextEnvelopeReceipt,
} from "./model-context-envelope.js";
import type { LocalStore } from "./store.js";

export interface ModelInvocationExperimentSource {
  preview: ModelInvocationExperimentPreview;
  sourceRun: RunRecord;
  capsule: ModelInvocationCapsule;
  capsuleEvent: RunEvent;
  responseEvent: RunEvent;
  sourceObservation: ModelInvocationExperimentObservation;
  title: string;
}

export async function projectModelInvocationExperimentSource(
  store: LocalStore,
  capsules: ModelInvocationCapsuleStore,
  sourceThreadId: string,
  input: CreateModelInvocationExperimentRequest,
): Promise<ModelInvocationExperimentSource> {
  const request = validateCreateModelInvocationExperimentRequest(input);
  const thread = store.getThread(sourceThreadId);
  const sourceRun = store
    .listRuns(sourceThreadId)
    .find((run) => run.id === request.sourceRunId);
  if (
    !sourceRun ||
    sourceRun.threadId !== sourceThreadId ||
    sourceRun.status === "queued" ||
    sourceRun.status === "running" ||
    !sourceRun.configuration
  ) {
    throw new Error(
      "Model invocation experiment source Run must be terminal and configured",
    );
  }
  const events = await store.listEvents(sourceThreadId);
  const capsuleEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === "context.model_invocation" &&
      receiptTurnIndex(event) === request.sourceTurnIndex,
  );
  if (capsuleEvents.length !== 1) {
    throw new Error(
      "Model invocation experiment source capsule evidence is unavailable",
    );
  }
  const capsuleEvent = capsuleEvents[0]!;
  const receipt = validateModelInvocationCapsuleReceipt(capsuleEvent.payload);
  const envelopeEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === MODEL_CONTEXT_ENVELOPE_EVENT &&
      envelopeBinding(event, receipt),
  );
  if (
    envelopeEvents.length !== 1 ||
    envelopeEvents[0]!.seq >= capsuleEvent.seq
  ) {
    throw new Error(
      "Model invocation experiment source envelope evidence is invalid",
    );
  }
  const responseEvents = events.filter(
    (event) =>
      event.runId === sourceRun.id &&
      event.type === "model.response" &&
      event.seq > capsuleEvent.seq &&
      responseBinding(event, receipt),
  );
  if (responseEvents.length !== 1) {
    throw new Error(
      "Model invocation experiment source response evidence is invalid",
    );
  }
  const responseEvent = responseEvents[0]!;
  const capsule = await capsules.read(receipt.capsuleSha256);
  if (
    capsule.sourceThreadId !== sourceThreadId ||
    capsule.sourceRunId !== sourceRun.id ||
    capsule.turnIndex !== receipt.turnIndex ||
    capsule.purpose !== receipt.purpose ||
    capsule.model.provider !== receipt.model.provider ||
    capsule.model.id !== receipt.model.id ||
    capsule.contextEnvelopeSha256 !== receipt.contextEnvelopeSha256 ||
    capsule.contextSha256 !== receipt.contextSha256 ||
    capsule.contentSha256 !== receipt.capsuleSha256
  ) {
    throw new Error(
      "Model invocation experiment local capsule does not match the Ledger",
    );
  }
  const sourceObservation = observeSourceModelInvocation({
    sourceThreadId,
    sourceRunId: sourceRun.id,
    purpose: receipt.purpose,
    capsuleEvent,
    responseEvent,
    events,
  });
  if (
    sourceObservation.model.provider !== receipt.model.provider ||
    sourceObservation.model.id !== receipt.model.id
  ) {
    throw new Error(
      "Model invocation experiment source model evidence is invalid",
    );
  }
  const envelope = validateModelContextEnvelopeReceipt(
    envelopeEvents[0]!.payload,
  );
  const targetModel = request.model ?? receipt.model;
  const content = {
    kind: "napier.model-invocation-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId,
    sourceRunId: sourceRun.id,
    sourceAgentId: sourceRun.agentId,
    sourceAgentRevision: sourceRun.agentRevision,
    sourceTurnIndex: receipt.turnIndex,
    sourceCapsuleEventSeq: capsuleEvent.seq,
    sourceResponseEventSeq: responseEvent.seq,
    purpose: receipt.purpose,
    sourceModel: structuredClone(receipt.model),
    targetModel: structuredClone(targetModel),
    sourceContextEnvelopeSha256: receipt.contextEnvelopeSha256,
    sourceContextSha256: receipt.contextSha256,
    sourceCapsuleSha256: receipt.capsuleSha256,
    sourceCapsuleBytes: receipt.capsuleBytes,
    sourceMessageCount: envelope.messageCount,
    sourceToolCount: envelope.toolCount,
    sourceOutputSha256: sourceObservation.outputSha256,
    sourceTextSha256: sourceObservation.textSha256,
    sourceStopReason: sourceObservation.stopReason,
    targetExecutionMode: "model_experiment_single_call" as const,
  };
  const preview = validateModelInvocationExperimentPreview({
    ...content,
    previewSha256: sha256(canonicalJson(content)),
  });
  return {
    preview,
    sourceRun,
    capsule,
    capsuleEvent,
    responseEvent,
    sourceObservation,
    title:
      request.title ?? defaultExperimentTitle(thread.title, receipt.turnIndex),
  };
}

function defaultExperimentTitle(
  sourceTitle: string,
  turnIndex: number,
): string {
  const suffix = ` / model call ${String(turnIndex + 1)}`;
  return `${sourceTitle.slice(0, Math.max(1, 160 - suffix.length)).trim()}${suffix}`;
}

function receiptTurnIndex(event: RunEvent): number | undefined {
  try {
    return validateModelInvocationCapsuleReceipt(event.payload).turnIndex;
  } catch {
    return undefined;
  }
}

function envelopeBinding(
  event: RunEvent,
  receipt: ModelInvocationCapsuleReceipt,
): boolean {
  try {
    const envelope = validateModelContextEnvelopeReceipt(event.payload);
    return (
      envelope.turnIndex === receipt.turnIndex &&
      envelope.contentSha256 === receipt.contextEnvelopeSha256
    );
  } catch {
    return false;
  }
}

function responseBinding(
  event: RunEvent,
  receipt: ModelInvocationCapsuleReceipt,
): boolean {
  const payload = record(event.payload);
  return (
    payload?.["modelContextEnvelopeTurnIndex"] === receipt.turnIndex &&
    payload["modelContextEnvelopeSha256"] === receipt.contextEnvelopeSha256
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

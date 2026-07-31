import type { RunEvent, RunExecutionMode, RunRecord } from "@napier/contracts";

import { validateModelInvocationCapsuleReceipt } from "./model-invocation-capsule.js";
import type { ModelInvocationExperimentExecution } from "./model-invocation-experiment-execution.js";

export interface ModelInvocationExperimentRunGateInput {
  source: RunRecord["source"] | undefined;
  executionMode: RunExecutionMode;
  targetThreadId: string;
  targetAgentId: string;
  targetAgentRevision: number;
  targetModel: {
    provider: string;
    id: string;
  };
  execution: ModelInvocationExperimentExecution | undefined;
  runs: readonly RunRecord[];
  sourceEvents: readonly RunEvent[];
}

export function validateModelInvocationExperimentRunGate(
  input: ModelInvocationExperimentRunGateInput,
): void {
  const execution = input.execution;
  const sourceRun = execution
    ? input.runs.find((run) => run.id === execution.sourceRunId)
    : undefined;
  const capsuleEvent = execution
    ? input.sourceEvents.find(
        (event) =>
          event.runId === execution.sourceRunId &&
          event.seq === execution.sourceCapsuleEventSeq &&
          event.type === "context.model_invocation",
      )
    : undefined;
  const responseEvent = execution
    ? input.sourceEvents.find(
        (event) =>
          event.runId === execution.sourceRunId &&
          event.seq === execution.sourceResponseEventSeq &&
          event.type === "model.response",
      )
    : undefined;
  let receipt;
  try {
    receipt = capsuleEvent
      ? validateModelInvocationCapsuleReceipt(capsuleEvent.payload)
      : undefined;
  } catch {
    receipt = undefined;
  }
  const response = record(responseEvent?.payload);
  if (
    input.source !== "model_experiment" ||
    input.executionMode !== "model_experiment_single_call" ||
    !execution ||
    !sourceRun ||
    sourceRun.threadId !== execution.sourceThreadId ||
    sourceRun.threadId === input.targetThreadId ||
    sourceRun.agentId !== input.targetAgentId ||
    sourceRun.agentRevision !== execution.sourceAgentRevision ||
    sourceRun.status === "queued" ||
    sourceRun.status === "running" ||
    input.targetAgentRevision !== execution.sourceAgentRevision ||
    input.targetModel.provider !== execution.targetModel.provider ||
    input.targetModel.id !== execution.targetModel.id ||
    !receipt ||
    receipt.turnIndex !== execution.sourceTurnIndex ||
    receipt.contextEnvelopeSha256 !== execution.sourceContextEnvelopeSha256 ||
    receipt.contextSha256 !== execution.sourceContextSha256 ||
    receipt.capsuleSha256 !== execution.sourceCapsuleSha256 ||
    !responseEvent ||
    responseEvent.seq <= (capsuleEvent?.seq ?? Number.MAX_SAFE_INTEGER) ||
    response?.["modelContextEnvelopeTurnIndex"] !== execution.sourceTurnIndex ||
    response["modelContextEnvelopeSha256"] !==
      execution.sourceContextEnvelopeSha256 ||
    !/^[a-f0-9]{64}$/u.test(execution.previewSha256)
  ) {
    throw new Error(
      "Model invocation experiment requires its verified single-call capability",
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

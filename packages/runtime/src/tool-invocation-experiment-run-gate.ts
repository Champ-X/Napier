import type { RunEvent, RunExecutionMode, RunRecord } from "@napier/contracts";

import type { ToolInvocationExperimentExecution } from "./tool-invocation-experiment-execution.js";
import { validateToolInvocationCapsuleReceipt } from "./tool-invocation-capsule.js";

export function validateToolInvocationExperimentRunGate(input: {
  source: RunRecord["source"] | undefined;
  executionMode: RunExecutionMode;
  targetThreadId: string;
  targetAgentId: string;
  targetAgentRevision: number;
  targetModel: { provider: string; id: string };
  execution: ToolInvocationExperimentExecution | undefined;
  runs: readonly RunRecord[];
  sourceEvents: readonly RunEvent[];
}): void {
  const execution = input.execution;
  const sourceRun = execution
    ? input.runs.find((run) => run.id === execution.sourceRunId)
    : undefined;
  const capsuleEvent = execution
    ? input.sourceEvents.find(
        (event) =>
          event.runId === execution.sourceRunId &&
          event.seq === execution.sourceCapsuleEventSeq &&
          event.type === "context.tool_invocation",
      )
    : undefined;
  const startedEvent = execution
    ? input.sourceEvents.find(
        (event) =>
          event.runId === execution.sourceRunId &&
          event.seq === execution.sourceStartedEventSeq &&
          event.type === "tool.started",
      )
    : undefined;
  const terminalEvent = execution
    ? input.sourceEvents.find(
        (event) =>
          event.runId === execution.sourceRunId &&
          event.seq === execution.sourceTerminalEventSeq &&
          event.type === "tool.completed",
      )
    : undefined;
  let receipt;
  try {
    receipt = capsuleEvent
      ? validateToolInvocationCapsuleReceipt(capsuleEvent.payload)
      : undefined;
  } catch {
    receipt = undefined;
  }
  const started = record(startedEvent?.payload);
  const terminal = record(terminalEvent?.payload);
  if (
    input.source !== "tool_experiment" ||
    input.executionMode !== "tool_experiment_read_only" ||
    !execution ||
    execution.executionMode !== input.executionMode ||
    !sourceRun ||
    sourceRun.threadId !== execution.sourceThreadId ||
    sourceRun.threadId === input.targetThreadId ||
    sourceRun.agentId !== input.targetAgentId ||
    sourceRun.agentRevision !== execution.sourceAgentRevision ||
    sourceRun.status === "queued" ||
    sourceRun.status === "running" ||
    !sourceRun.configuration ||
    input.targetAgentRevision !== execution.sourceAgentRevision ||
    input.targetModel.provider !== sourceRun.configuration.model.provider ||
    input.targetModel.id !== sourceRun.configuration.model.id ||
    !receipt ||
    !startedEvent ||
    !capsuleEvent ||
    !terminalEvent ||
    !sourceEvidencePrecedesTerminal(
      startedEvent.seq,
      capsuleEvent.seq,
      terminalEvent.seq,
    ) ||
    receipt.callId !== execution.sourceCallId ||
    receipt.toolName !== execution.sourceToolName ||
    !definitionEvidenceMatches(
      startedEvent,
      receipt.toolDefinitionSha256,
      execution.sourceToolDefinitionSha256,
    ) ||
    receipt.argumentsSha256 !== execution.sourceArgumentsSha256 ||
    receipt.workspaceScopeSha256 !== execution.sourceWorkspaceScopeSha256 ||
    receipt.capsuleSha256 !== execution.sourceCapsuleSha256 ||
    started?.["callId"] !== execution.sourceCallId ||
    started["toolName"] !== execution.sourceToolName ||
    started["effect"] !== "read" ||
    terminal?.["callId"] !== execution.sourceCallId ||
    terminal["toolName"] !== execution.sourceToolName ||
    terminal["status"] !== "completed" ||
    !/^[a-f0-9]{64}$/u.test(execution.candidateWorkspaceSnapshotSha256) ||
    !/^[a-f0-9]{64}$/u.test(execution.previewSha256)
  ) {
    throw new Error(
      "Tool invocation experiment requires its verified read-only capability",
    );
  }
}

function sourceEvidencePrecedesTerminal(
  startedSeq: number,
  capsuleSeq: number,
  terminalSeq: number,
): boolean {
  return (
    startedSeq !== capsuleSeq && Math.max(startedSeq, capsuleSeq) < terminalSeq
  );
}

function toolDefinitionSha256(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  const protocol = record(payload?.["toolProtocol"]);
  const value = protocol?.["definitionSha256"];
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function definitionEvidenceMatches(
  startedEvent: RunEvent,
  receiptDefinitionSha256: string,
  expectedDefinitionSha256: string,
): boolean {
  return (
    receiptDefinitionSha256 === expectedDefinitionSha256 &&
    toolDefinitionSha256(startedEvent) === expectedDefinitionSha256
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

import type { RunEvent } from "@napier/contracts";

import type { AgentMessageExperimentExecution } from "./agent-message-experiment-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { validateToolInvocationResultCapsuleReceipt } from "./tool-invocation-result-capsule.js";
import { validateToolInvocationCapsuleReceipt } from "./tool-invocation-capsule.js";

const HASH = /^[a-f0-9]{64}$/u;

export function validateAgentMessageExperimentToolResultRunGate(input: {
  execution: AgentMessageExperimentExecution;
  sourceEvents: RunEvent[];
}): void {
  const { execution } = input;
  if (
    (execution.toolResultMode !== "live" &&
      execution.toolResultMode !== "reuse_source") ||
    !nonNegativeInteger(execution.sourceReusableToolResultCount) ||
    !HASH.test(execution.sourceToolResultSetSha256)
  ) {
    throw new Error(
      "Agent message experiment tool result capability is invalid",
    );
  }
  if (execution.toolResultMode === "live") return;

  const sourceEvents = input.sourceEvents.filter(
    (event) => event.runId === execution.sourceRunId,
  );
  const entries = sourceEvents
    .filter((event) => event.type === "context.tool_invocation")
    .map((event) => {
      const invocation = validateToolInvocationCapsuleReceipt(event.payload);
      const results = sourceEvents.filter(
        (candidate) =>
          candidate.type === "context.tool_result" &&
          candidate.seq > event.seq &&
          resultCallId(candidate) === invocation.callId,
      );
      if (results.length !== 1) {
        throw new Error(
          "Agent message experiment frozen tool result evidence is incomplete",
        );
      }
      const result = validateToolInvocationResultCapsuleReceipt(
        results[0]!.payload,
      );
      const terminal = sourceEvents.filter(
        (candidate) =>
          candidate.seq > results[0]!.seq &&
          (candidate.type === "tool.completed" ||
            candidate.type === "tool.failed") &&
          toolBinding(candidate, invocation.callId, invocation.toolName),
      );
      if (
        result.callId !== invocation.callId ||
        result.toolName !== invocation.toolName ||
        result.invocationCapsuleSha256 !== invocation.capsuleSha256 ||
        result.toolDefinitionSha256 !== invocation.toolDefinitionSha256 ||
        result.argumentsSha256 !== invocation.argumentsSha256 ||
        terminal.length !== 1 ||
        !terminalBinding(terminal[0]!, result)
      ) {
        throw new Error(
          "Agent message experiment frozen tool result evidence is invalid",
        );
      }
      return {
        sourceCallId: invocation.callId,
        toolName: invocation.toolName,
        toolDefinitionSha256: invocation.toolDefinitionSha256,
        argumentsSha256: invocation.argumentsSha256,
        invocationCapsuleSha256: invocation.capsuleSha256,
        resultCapsuleSha256: result.capsuleSha256,
        resultSha256: result.resultSha256,
        outputTextSha256: result.outputTextSha256,
        outputTextBytes: result.outputTextBytes,
        isError: result.isError,
      };
    });
  if (
    entries.length < 1 ||
    entries.length !== execution.sourceReusableToolResultCount ||
    sha256(canonicalJson(entries)) !== execution.sourceToolResultSetSha256
  ) {
    throw new Error(
      "Agent message experiment frozen tool result set binding is invalid",
    );
  }
}

function resultCallId(event: RunEvent): string | undefined {
  try {
    return validateToolInvocationResultCapsuleReceipt(event.payload).callId;
  } catch {
    return undefined;
  }
}

function toolBinding(
  event: RunEvent,
  callId: string,
  toolName: string,
): boolean {
  const payload = record(event.payload);
  return payload?.["callId"] === callId && payload["toolName"] === toolName;
}

function terminalBinding(
  event: RunEvent,
  result: ReturnType<typeof validateToolInvocationResultCapsuleReceipt>,
): boolean {
  const payload = record(event.payload);
  return (
    event.type === (result.isError ? "tool.failed" : "tool.completed") &&
    payload?.["status"] === (result.isError ? "failed" : "completed") &&
    payload["outputTextSha256"] === result.outputTextSha256 &&
    payload["outputTextBytes"] === result.outputTextBytes
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

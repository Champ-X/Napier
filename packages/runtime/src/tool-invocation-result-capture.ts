import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  RunRecord,
  ToolInvocationCapsuleReceipt,
  ToolInvocationResultCapsuleReceipt,
} from "@napier/contracts";

import { emitBestEffort, type EventSink } from "./event-sink.js";
import {
  claimRunHeadEvent,
  IdempotentEventConflictError,
} from "./event-idempotency.js";
import { sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";

export async function captureToolInvocationResult(
  store: LocalStore,
  capsules: ToolInvocationResultCapsuleStore,
  run: RunRecord,
  invocation: ToolInvocationCapsuleReceipt | undefined,
  result: AgentToolResult<unknown>,
  isError: boolean,
  onEvent?: EventSink,
): Promise<ToolInvocationResultCapsuleReceipt | undefined> {
  if (!invocation) return undefined;
  try {
    const receipt = await capsules.put({
      sourceThreadId: run.threadId,
      sourceRunId: run.id,
      invocation,
      result,
      isError,
    });
    await appendReceiptOnce(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.tool_result",
        category: "tool",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(receipt)),
      },
      `${run.id}:${invocation.callId}`,
      onEvent,
    );
    return receipt;
  } catch (error) {
    if (error instanceof IdempotentEventConflictError) throw error;
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.tool_result_unavailable",
        category: "tool",
        visibility: "debug",
        payload: {
          schemaVersion: 1,
          callId: invocation.callId,
          toolName: invocation.toolName,
          invocationCapsuleSha256: invocation.capsuleSha256,
          reason: captureFailureReason(error),
          diagnosticSha256: sha256(errorMessage(error)),
        },
      },
      onEvent,
    );
    return undefined;
  }
}

async function appendReceiptOnce(
  store: LocalStore,
  input: Parameters<LocalStore["appendEvent"]>[0],
  key: string,
  onEvent?: EventSink,
): Promise<void> {
  const receipt = await claimRunHeadEvent(store, input, {
    namespace: "tool-invocation-result-receipt",
    key,
  });
  if (receipt.appended) await emitBestEffort(onEvent, receipt.event);
}

async function append(
  store: LocalStore,
  input: Parameters<LocalStore["appendEvent"]>[0],
  onEvent?: EventSink,
): Promise<void> {
  const event = await store.appendEvent(input);
  if (!onEvent) return;
  try {
    await onEvent(event);
  } catch {
    // A disconnected observer must not cancel durable Agent execution.
  }
}

function captureFailureReason(error: unknown): "limit" | "storage" | "invalid" {
  const message = errorMessage(error);
  if (/\b(?:byte|count|limit|exceeds)\b/iu.test(message)) return "limit";
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["EACCES", "EDQUOT", "ENOSPC", "EROFS"].includes(String(error.code))
  ) {
    return "storage";
  }
  return "invalid";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

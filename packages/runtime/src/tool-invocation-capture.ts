import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  RunRecord,
  ToolInvocationCapsuleReceipt,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  TOOL_INVOCATION_EXPERIMENT_TOOLS,
  toolDefinitionSha256,
} from "./tool-invocation-capsule.js";
import type { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";

export async function captureToolInvocation(
  store: LocalStore,
  capsules: ToolInvocationCapsuleStore,
  run: RunRecord,
  tool: AgentTool | undefined,
  callId: string,
  toolName: string,
  args: unknown,
  onEvent?: EventSink,
): Promise<ToolInvocationCapsuleReceipt | undefined> {
  if (!TOOL_INVOCATION_EXPERIMENT_TOOLS.has(toolName)) return undefined;
  try {
    if (!tool || tool.name !== toolName) {
      throw new Error("Tool definition is unavailable");
    }
    const receipt = await capsules.put({
      sourceThreadId: run.threadId,
      sourceRunId: run.id,
      callId,
      toolName,
      toolDefinitionSha256: toolDefinitionSha256(tool),
      arguments: args,
    });
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.tool_invocation",
        category: "tool",
        visibility: "debug",
        payload: JSON.parse(JSON.stringify(receipt)),
      },
      onEvent,
    );
    return receipt;
  } catch (error) {
    await append(
      store,
      {
        threadId: run.threadId,
        runId: run.id,
        type: "context.tool_invocation_unavailable",
        category: "tool",
        visibility: "debug",
        payload: {
          schemaVersion: 1,
          callId,
          toolName,
          reason: captureFailureReason(error),
          diagnosticSha256: sha256(errorMessage(error)),
        },
      },
      onEvent,
    );
    return undefined;
  }
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

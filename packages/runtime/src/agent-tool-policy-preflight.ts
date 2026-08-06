import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type {
  AgentProfile,
  JsonValue,
  RunRecord,
  ToolPolicyMode,
} from "@napier/contracts";

import { agentToolInputLedgerProjection } from "./agent-tool-ledger.js";
import {
  BrowserInteractionConfirmationManager,
  isBrowserInteractionAction,
} from "./browser-interaction-confirmations.js";
import { browserInteractionConfirmationPreview } from "./browser-tool.js";
import type { BrowserSessionPauseManager } from "./browser-session-pause.js";
import type { EventSink } from "./event-sink.js";
import type { McpExtensionManager } from "./mcp.js";
import { assessToolCall } from "./policy.js";
import type { LocalStore } from "./store.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";

export async function preflightAgentToolPolicy(input: {
  store: LocalStore;
  run: RunRecord;
  profile: AgentProfile;
  extensionManager?: McpExtensionManager;
  confirmations: BrowserInteractionConfirmationManager;
  browserPauses: BrowserSessionPauseManager;
  browserSessionActive: (owner: { threadId: string; runId: string }) => boolean;
  restrictedReadOnlyExecution: boolean;
  toolCall: { id: string; name: string };
  args: unknown;
  signal?: AbortSignal;
  onEvent?: EventSink;
}): Promise<BeforeToolCallResult | undefined> {
  if (input.toolCall.name === "delegate_task") return undefined;
  if (input.toolCall.name === "browser") {
    await input.browserPauses.waitIfPaused(
      { threadId: input.run.threadId, runId: input.run.id },
      input.signal,
      () =>
        input.browserSessionActive({
          threadId: input.run.threadId,
          runId: input.run.id,
        }),
    );
  }
  const mode: ToolPolicyMode = input.restrictedReadOnlyExecution
    ? "observe"
    : input.profile.toolPolicy;
  const decision = input.restrictedReadOnlyExecution
    ? assessToolCall(
        mode,
        input.toolCall.name,
        toJsonValue(input.args),
        input.store.workspaceRoot,
      )
    : (input.extensionManager?.assessToolCall(
        mode,
        input.toolCall.name,
        input.profile.id,
      ) ??
      assessToolCall(
        mode,
        input.toolCall.name,
        toJsonValue(input.args),
        input.store.workspaceRoot,
      ));
  if (!decision.allowed) {
    return block(input, decision.reason);
  }
  const action = browserInteractionAction(input.toolCall.name, input.args);
  if (!action) return undefined;
  if (input.run.source !== "user") {
    return block(
      input,
      "Browser interaction confirmation is available only for user Runs",
    );
  }
  if (!input.confirmations.available) {
    return block(
      input,
      "Browser interaction confirmation is unavailable in this entry point",
    );
  }
  const owner = { threadId: input.run.threadId, runId: input.run.id };
  const uploadCandidate =
    action === "upload"
      ? await input.confirmations.uploads.prepare({
          owner,
          callId: input.toolCall.id,
          request: input.args as {
            action: "upload";
            target: { ref?: string; selector?: string };
            path: string;
          },
        })
      : undefined;
  const preview = browserInteractionConfirmationPreview(input.args);
  if (uploadCandidate) {
    preview.fileSha256 = uploadCandidate.upload.fileSha256;
    preview.fileBytes = uploadCandidate.upload.fileBytes;
  }
  let confirmation: Awaited<
    ReturnType<BrowserInteractionConfirmationManager["request"]>
  >;
  try {
    confirmation = await input.confirmations.request(
      {
        ...owner,
        callId: input.toolCall.id,
        action,
        argumentsSha256: toolInvocationArgumentsSha256(input.args),
        preview,
      },
      input.signal,
      input.onEvent,
    );
  } catch (error) {
    if (uploadCandidate) input.confirmations.uploads.discard(uploadCandidate);
    throw error;
  }
  if (confirmation.decision === "approve") {
    if (uploadCandidate) input.confirmations.uploads.approve(uploadCandidate);
    return undefined;
  }
  if (uploadCandidate) input.confirmations.uploads.discard(uploadCandidate);
  return block(
    input,
    `Browser ${action} action was not confirmed (${confirmation.confirmation.status})`,
  );
}

async function block(
  input: {
    store: LocalStore;
    run: RunRecord;
    toolCall: { id: string; name: string };
    args: unknown;
    onEvent?: EventSink;
  },
  reason: string,
): Promise<BeforeToolCallResult> {
  const event = await input.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "tool.blocked",
    category: "tool",
    visibility: "user",
    payload: {
      callId: input.toolCall.id,
      toolName: input.toolCall.name,
      status: "blocked",
      ...agentToolInputLedgerProjection(input.toolCall.name, input.args),
      policyReason: reason,
    },
  });
  try {
    await input.onEvent?.(event);
  } catch {
    // Durable policy evidence survives a disconnected observer.
  }
  return { block: true, reason };
}

function browserInteractionAction(
  toolName: string,
  args: unknown,
):
  | Parameters<BrowserInteractionConfirmationManager["request"]>[0]["action"]
  | undefined {
  if (
    toolName !== "browser" ||
    !args ||
    typeof args !== "object" ||
    Array.isArray(args)
  ) {
    return undefined;
  }
  const action = (args as Record<string, unknown>)["action"];
  return isBrowserInteractionAction(action) ? action : undefined;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

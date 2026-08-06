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
import type { BrowserSessionRequest } from "./browser-session-model.js";
import type {
  BrowserConfirmationPageState,
  BrowserConfirmedActionCandidate,
} from "./browser-confirmed-action.js";
import type { BrowserUploadAuthorizationCandidate } from "./browser-upload-authorization.js";
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
  browserConfirmation: {
    capture: (
      owner: { threadId: string; runId: string },
      request: Extract<
        BrowserSessionRequest,
        { action: "click" | "type" | "select" | "upload" | "download" }
      >,
      signal?: AbortSignal,
    ) => Promise<BrowserConfirmationPageState>;
    active: (owner: { threadId: string; runId: string }) => boolean;
  };
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
        input.browserConfirmation.active({
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
  const pageRequest = browserPageConfirmationRequest(input.args);
  let candidates: BrowserConfirmationCandidates | undefined;
  try {
    candidates = await prepareBrowserConfirmationCandidates(
      input,
      owner,
      action,
      pageRequest,
    );
  } catch (error) {
    if (error instanceof SensitiveBrowserTargetError) {
      return block(input, error.message);
    }
    throw error;
  }
  const preview = browserInteractionConfirmationPreview(input.args);
  const effect =
    candidates.action?.pageState.targetEffect ?? nonTargetBrowserEffect(action);
  if (effect) {
    preview.effect = effect;
  }
  if (candidates.action) {
    preview.pageStateSha256 = candidates.action.pageState.contentSha256;
  }
  if (candidates.upload) {
    preview.fileSha256 = candidates.upload.upload.fileSha256;
    preview.fileBytes = candidates.upload.upload.fileBytes;
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
    discardBrowserConfirmationCandidates(input.confirmations, candidates);
    throw error;
  }
  if (confirmation.decision === "approve") {
    approveBrowserConfirmationCandidates(input.confirmations, candidates);
    return undefined;
  }
  discardBrowserConfirmationCandidates(input.confirmations, candidates);
  return block(
    input,
    `Browser ${action} action was not confirmed (${confirmation.confirmation.status})`,
  );
}

function nonTargetBrowserEffect(
  action: Parameters<
    BrowserInteractionConfirmationManager["request"]
  >[0]["action"],
) {
  return action === "save_screenshot"
    ? ("screenshot_save" as const)
    : undefined;
}

interface BrowserConfirmationCandidates {
  action?: BrowserConfirmedActionCandidate;
  upload?: BrowserUploadAuthorizationCandidate;
}

class SensitiveBrowserTargetError extends Error {}

async function prepareBrowserConfirmationCandidates(
  input: Parameters<typeof preflightAgentToolPolicy>[0],
  owner: { threadId: string; runId: string },
  action: Parameters<
    BrowserInteractionConfirmationManager["request"]
  >[0]["action"],
  pageRequest: ReturnType<typeof browserPageConfirmationRequest>,
): Promise<BrowserConfirmationCandidates> {
  const pageState = pageRequest
    ? await input.browserConfirmation.capture(owner, pageRequest, input.signal)
    : undefined;
  if (pageState && pageState.targetSensitivity !== "ordinary") {
    throw new SensitiveBrowserTargetError(
      sensitiveBrowserTargetReason(pageState.targetSensitivity),
    );
  }
  const candidate = pageRequest
    ? input.confirmations.actions.prepare({
        owner,
        callId: input.toolCall.id,
        request: pageRequest,
        pageState: pageState!,
      })
    : undefined;
  try {
    const upload =
      action === "upload"
        ? await input.confirmations.uploads.prepare({
            owner,
            callId: input.toolCall.id,
            request: pageRequest as Extract<
              BrowserSessionRequest,
              { action: "upload" }
            >,
          })
        : undefined;
    return {
      ...(candidate ? { action: candidate } : {}),
      ...(upload ? { upload } : {}),
    };
  } catch (error) {
    if (candidate) input.confirmations.actions.discard(candidate);
    throw error;
  }
}

function approveBrowserConfirmationCandidates(
  confirmations: BrowserInteractionConfirmationManager,
  candidates: BrowserConfirmationCandidates,
): void {
  if (candidates.action) confirmations.actions.approve(candidates.action);
  if (candidates.upload) confirmations.uploads.approve(candidates.upload);
}

function discardBrowserConfirmationCandidates(
  confirmations: BrowserInteractionConfirmationManager,
  candidates: BrowserConfirmationCandidates,
): void {
  if (candidates.action) confirmations.actions.discard(candidates.action);
  if (candidates.upload) confirmations.uploads.discard(candidates.upload);
}

function sensitiveBrowserTargetReason(
  sensitivity: "credential" | "human_verification",
): string {
  return sensitivity === "credential"
    ? "Browser credential entry or login submission requires pause-bound human takeover"
    : "Browser human-verification controls require pause-bound human takeover";
}

function browserPageConfirmationRequest(
  args: unknown,
):
  | Extract<
      BrowserSessionRequest,
      { action: "click" | "type" | "select" | "upload" | "download" }
    >
  | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const action = (args as Record<string, unknown>)["action"];
  return action === "click" ||
    action === "type" ||
    action === "select" ||
    action === "upload" ||
    action === "download"
    ? (args as Extract<
        BrowserSessionRequest,
        { action: "click" | "type" | "select" | "upload" | "download" }
      >)
    : undefined;
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

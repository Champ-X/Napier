import type { PromptRequest, ResumeRunRequest } from "@napier/contracts";
import {
  RUN_STREAM_ERROR_CODE,
  RUN_STREAM_ERROR_MESSAGE,
} from "@napier/runtime/core";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  sha256Text,
} from "./http-response-evidence.js";

export function setOperatorDecisionContinueStreamHeaders(
  context: Context,
  threadId: string,
  decisionId: string,
): void {
  context.header("X-Accel-Buffering", "no");
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Operator-Decision-Id", decisionId);
  context.header("X-Napier-Run-Intent", "operator-decision-continuation");
  setThreadRunStreamErrorHeaders(context);
}

export function setThreadStopHeaders(
  context: Context,
  threadId: string,
  receipt: { stopped: boolean },
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, receipt);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Thread-Stopped", String(receipt.stopped));
}

export function setThreadResumeStreamHeaders(
  context: Context,
  threadId: string,
  runId: string | undefined,
  model: ResumeRunRequest["model"] | undefined,
): void {
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Resume-Requested", "true");
  setThreadRunStreamErrorHeaders(context);
  if (runId) context.header("X-Napier-Run-Id", runId);
  setThreadRunStreamModelHeaders(context, model);
}

export function setThreadPromptStreamHeaders(
  context: Context,
  threadId: string,
  model: PromptRequest["model"] | undefined,
  capabilityPreset: PromptRequest["capabilityPreset"] | undefined,
  sourceContinuityRunId?: string,
): void {
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Prompt-Requested", "true");
  if (capabilityPreset) {
    context.header("X-Napier-Capability-Preset", capabilityPreset);
  }
  if (sourceContinuityRunId) {
    context.header("X-Napier-Source-Continuity-Run-Id", sourceContinuityRunId);
  }
  setThreadRunStreamErrorHeaders(context);
  setThreadRunStreamModelHeaders(context, model);
}

function setThreadRunStreamModelHeaders(
  context: Context,
  model: PromptRequest["model"] | ResumeRunRequest["model"] | undefined,
): void {
  if (!model) return;
  context.header("X-Napier-Model-Provider", model.provider);
  context.header("X-Napier-Model-Id", model.id);
}

function setThreadRunStreamErrorHeaders(context: Context): void {
  context.header("X-Napier-Stream-Error-Code", RUN_STREAM_ERROR_CODE);
  context.header("X-Napier-Stream-Error-Diagnostic", "sha256");
  context.header(
    "X-Napier-Stream-Error-Message-SHA256",
    sha256Text(RUN_STREAM_ERROR_MESSAGE),
  );
}

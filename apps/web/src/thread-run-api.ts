import { requestJson } from "./api-client";
import type {
  QueueRunControlMessageRequest,
  RunControlMessage,
  AnswerOperatorDecisionRequest,
  OperatorDecision,
  PromptRequest,
  ResumeRunRequest,
  StreamFrame,
} from "@napier/contracts";

import { streamRunFrames } from "./stream-run-api";

export function streamPrompt(
  threadId: string,
  body: PromptRequest,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  return streamRunFrames(
    `/api/threads/${encodeURIComponent(threadId)}/messages`,
    body,
    {
      kind: "prompt",
      threadId,
      ...(body.harnessPolicyPreset
        ? { harnessPolicyPreset: body.harnessPolicyPreset }
        : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.capabilityPreset
        ? { capabilityPreset: body.capabilityPreset }
        : {}),
    },
    onFrame,
  );
}

export function resumeInterruptedRun(
  threadId: string,
  body: ResumeRunRequest,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  return streamRunFrames(
    `/api/threads/${encodeURIComponent(threadId)}/resume`,
    body,
    {
      kind: "resume",
      threadId,
      ...(body.runId ? { runId: body.runId } : {}),
      ...(body.model ? { model: body.model } : {}),
    },
    onFrame,
  );
}

export function continueOperatorDecision(
  threadId: string,
  decisionId: string,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  return streamRunFrames(
    `/api/threads/${encodeURIComponent(threadId)}/operator-decisions/${encodeURIComponent(decisionId)}/continue`,
    {},
    {
      kind: "operator_decision",
      threadId,
      decisionId,
    },
    onFrame,
  );
}

export function answerOperatorDecision(
  threadId: string,
  decisionId: string,
  body: AnswerOperatorDecisionRequest,
): Promise<OperatorDecision> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/operator-decisions/${encodeURIComponent(decisionId)}/answer`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function cancelOperatorDecision(
  threadId: string,
  decisionId: string,
): Promise<OperatorDecision> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/operator-decisions/${encodeURIComponent(decisionId)}/cancel`,
    { method: "POST" },
  );
}

export function queueRunControlMessage(
  threadId: string,
  runId: string,
  body: QueueRunControlMessageRequest,
): Promise<RunControlMessage> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/control-messages`,
    {
      signal: AbortSignal.timeout(20000),
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function listRunControlMessages(
  threadId: string,
  runId: string,
): Promise<RunControlMessage[]> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/control-messages`,
    { signal: AbortSignal.timeout(20000) },
  );
}

export function cancelRunControlMessage(
  threadId: string,
  runId: string,
  controlMessageId: string,
): Promise<RunControlMessage> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/control-messages/${encodeURIComponent(controlMessageId)}/cancel`,
    { method: "POST", signal: AbortSignal.timeout(20000) },
  );
}

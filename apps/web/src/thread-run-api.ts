import type {
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

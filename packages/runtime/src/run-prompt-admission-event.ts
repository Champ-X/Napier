import type { JsonObject } from "@napier/contracts";
import type { AppendEventInput } from "./run-event-registry.js";
import { isPromptRequestId } from "./prompt-request-admission.js";

export const RUN_PROMPT_ADMITTED_EVENT = "run.prompt.admitted" as const;

export interface RunPromptAdmissionPayload extends JsonObject {
  kind: "napier.run-prompt-admission";
  schemaVersion: 1;
  requestId: string;
  requestFingerprint: string;
}

export function createRunPromptAdmissionPayload(input: {
  requestId: string;
  requestFingerprint: string;
}): RunPromptAdmissionPayload {
  if (!isPromptRequestId(input.requestId)) {
    throw new Error("Prompt requestId is invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.requestFingerprint)) {
    throw new Error("Prompt request fingerprint is invalid");
  }
  return {
    kind: "napier.run-prompt-admission",
    schemaVersion: 1,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
  };
}

export function runPromptAdmissionAppendInput(input: {
  threadId: string;
  runId: string;
  requestId: string;
  requestFingerprint: string;
}): AppendEventInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    type: RUN_PROMPT_ADMITTED_EVENT,
    category: "lifecycle",
    visibility: "debug",
    payload: createRunPromptAdmissionPayload({
      requestId: input.requestId,
      requestFingerprint: input.requestFingerprint,
    }),
  };
}

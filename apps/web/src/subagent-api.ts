import type {
  ModelRef,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
} from "@napier/contracts";

import { requestJson } from "./api-client";

export function verifySubagentOutcomeEvidence(
  threadId: string,
  taskId: string,
): Promise<SubagentOutcomeEvidenceVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(taskId)}/outcome/verify`,
    { method: "POST" },
  );
}

export function reviewSubagentOutcome(
  threadId: string,
  taskId: string,
  model: ModelRef,
): Promise<SubagentOutcomeReview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(taskId)}/outcome/review`,
    {
      method: "POST",
      body: JSON.stringify({ model }),
    },
  );
}

import type { SubagentOutcomeEvidenceVerification } from "@napier/contracts";

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

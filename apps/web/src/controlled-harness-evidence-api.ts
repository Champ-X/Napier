import type {
  ControlledHarnessEvidence,
  ControlledHarnessGateProjection,
} from "@napier/contracts/controlled-harness-evidence";

import { requestJson } from "./api-client";

export async function getControlledHarnessGate(
  threadId: string,
  casebookId: string,
): Promise<ControlledHarnessGateProjection> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/controlled-harness-gate?casebookId=${encodeURIComponent(casebookId)}`,
  );
}

export async function recordControlledHarnessEvidence(
  threadId: string,
  casebookId: string,
  evidence: ControlledHarnessEvidence,
): Promise<{
  evidence: ControlledHarnessEvidence;
  gate: ControlledHarnessGateProjection;
}> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/controlled-harness-evidence`,
    {
      method: "POST",
      body: JSON.stringify({ casebookId, evidence }),
    },
  );
}

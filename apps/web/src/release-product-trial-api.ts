import type {
  CreateReleaseProductTrialRequest,
  ReleaseProductGateProjection,
  ReleaseProductTrial,
} from "@napier/contracts/release-product-trial";

import { requestJson } from "./api-client";

export async function getReleaseProductGate(
  threadId: string,
  casebookId: string,
): Promise<ReleaseProductGateProjection> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/release-product-gate?casebookId=${encodeURIComponent(casebookId)}`,
  );
}

export async function recordReleaseProductTrial(
  threadId: string,
  request: CreateReleaseProductTrialRequest,
): Promise<{ trial: ReleaseProductTrial; gate: ReleaseProductGateProjection }> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/release-product-trials`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

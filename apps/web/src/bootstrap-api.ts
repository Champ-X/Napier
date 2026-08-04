import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { requestJson } from "./api-client";

export function getBootstrap(
  threadId?: string,
): Promise<LiveReadyBootstrapResponse> {
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
  return requestJson(`/api/bootstrap${query}`);
}

import type {
  BrowserInteractionConfirmation,
  DecideBrowserInteractionConfirmationRequest,
} from "@napier/contracts/browser-interaction-confirmation";

import { requestJson } from "./api-client";

export function decideBrowserInteractionConfirmation(
  threadId: string,
  runId: string,
  confirmationId: string,
  body: DecideBrowserInteractionConfirmationRequest,
): Promise<BrowserInteractionConfirmation> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-interaction-confirmations/${encodeURIComponent(confirmationId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

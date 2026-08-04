import { useCallback, useMemo, useState } from "react";

import type { ThreadDetail } from "@napier/contracts";

import { decideBrowserInteractionConfirmation as decideApi } from "./browser-interaction-confirmation-api";
import { openBrowserInteractionConfirmation } from "./browser-interaction-confirmation-view";
import { formatApiErrorMessage } from "./api-error";

export function useBrowserInteractionConfirmation(
  detail: ThreadDetail | undefined,
  setError: (message: string | undefined) => void,
) {
  const [browserInteractionConfirmationBusy, setBusy] = useState(false);
  const browserInteractionConfirmation = useMemo(
    () => openBrowserInteractionConfirmation(detail?.events ?? []),
    [detail?.events],
  );
  const decideBrowserInteractionConfirmation = useCallback(
    async (decision: "approve" | "reject"): Promise<void> => {
      if (
        !detail ||
        !browserInteractionConfirmation ||
        browserInteractionConfirmationBusy
      ) {
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        await decideApi(
          detail.thread.id,
          browserInteractionConfirmation.runId,
          browserInteractionConfirmation.id,
          {
            decision,
            expectedRequestSha256: browserInteractionConfirmation.requestSha256,
          },
        );
      } catch (error) {
        setError(formatApiErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [
      browserInteractionConfirmation,
      browserInteractionConfirmationBusy,
      detail,
      setError,
    ],
  );
  return {
    browserInteractionConfirmation,
    browserInteractionConfirmationBusy,
    decideBrowserInteractionConfirmation,
  };
}

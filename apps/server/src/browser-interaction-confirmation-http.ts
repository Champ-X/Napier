import type { BrowserInteractionConfirmationManager } from "@napier/runtime/browser-interaction-confirmations";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { parseBrowserInteractionConfirmationDecision } from "./thread-control-http-validation.js";

const MAX_CONFIRMATION_DECISION_BYTES = 1_024;

export function registerBrowserInteractionConfirmationHttp(
  app: Hono,
  confirmations: BrowserInteractionConfirmationManager,
): void {
  app.get(
    "/api/threads/:threadId/runs/:runId/browser-interaction-confirmations",
    (context) => {
      const confirmationsForRun = confirmations.list({
        threadId: context.req.param("threadId"),
        runId: context.req.param("runId"),
      });
      return context.json(confirmationsForRun);
    },
  );
  app.post(
    "/api/threads/:threadId/runs/:runId/browser-interaction-confirmations/:confirmationId/decision",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_CONFIRMATION_DECISION_BYTES,
          "Browser interaction confirmation decision",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const request = parseBrowserInteractionConfirmationDecision(input);
      if (!request) {
        return jsonError(
          context,
          "Browser interaction confirmation decision is invalid",
          400,
        );
      }
      try {
        const confirmation = await confirmations.decide(
          {
            threadId: context.req.param("threadId"),
            runId: context.req.param("runId"),
          },
          context.req.param("confirmationId"),
          request,
        );
        return context.json(confirmation);
      } catch (error) {
        return jsonError(context, errorMessage(error), 409);
      }
    },
  );
}

import type { BrowserSessionPauseState } from "@napier/contracts/browser-session-control";
import type { BrowserSessionControlService } from "@napier/runtime/browser-session-control";
import type { Context } from "hono";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setStableContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { parseResumeBrowserSessionRequest } from "./thread-control-http-validation.js";

const MAX_BROWSER_SESSION_CONTROL_BYTES = 1_024;

export function registerBrowserSessionControlHttp(
  app: Hono,
  controls: BrowserSessionControlService,
): void {
  app.get(
    "/api/threads/:threadId/runs/:runId/browser-session-control",
    async (context) => {
      try {
        return stateResponse(
          context,
          await controls.state(
            context.req.param("threadId"),
            context.req.param("runId"),
          ),
        );
      } catch (error) {
        return controlError(context, error);
      }
    },
  );
  app.post(
    "/api/threads/:threadId/runs/:runId/browser-session-control/pause",
    async (context) => {
      try {
        return stateResponse(
          context,
          await controls.pause(
            context.req.param("threadId"),
            context.req.param("runId"),
          ),
        );
      } catch (error) {
        return controlError(context, error);
      }
    },
  );
  app.post(
    "/api/threads/:threadId/runs/:runId/browser-session-control/resume",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_BROWSER_SESSION_CONTROL_BYTES,
          "Browser Session resume request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const request = parseResumeBrowserSessionRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Browser Session resume request is invalid",
          400,
        );
      }
      try {
        return stateResponse(
          context,
          await controls.resume(
            context.req.param("threadId"),
            context.req.param("runId"),
            request.expectedPauseStateSha256,
          ),
        );
      } catch (error) {
        return controlError(context, error);
      }
    },
  );
}

function stateResponse(
  context: Context,
  state: BrowserSessionPauseState,
): Response {
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
  setStableContentSha256Header(context, state.contentSha256);
  return context.json(state);
}

function controlError(context: Context, error: unknown): Response {
  return jsonError(context, errorMessage(error), 409);
}

import {
  MAX_CONTEXT_COMPACTION_REQUEST_BYTES,
  validateApplyContextCompactionForkRequest,
  validatePreviewContextCompactionRequest,
} from "@napier/contracts/context-compaction";
import {
  ContextCompactionPreviewChangedError,
  ContextCompactionPreviewUnavailableError,
  type ContextCompactionWorkbenchService,
} from "@napier/runtime/model";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";

export interface ContextCompactionHttpServices {
  contextCompactionWorkbench: ContextCompactionWorkbenchService;
}

export function registerContextCompactionHttp(
  app: Hono,
  services: ContextCompactionHttpServices,
): void {
  app.post(
    "/api/threads/:threadId/context-compaction/preview",
    async (context) => {
      const request = await readRequest(
        context.req.raw,
        validatePreviewContextCompactionRequest,
      );
      if (request instanceof Error) {
        return jsonError(
          context,
          request.message,
          request instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      try {
        const preview = await services.contextCompactionWorkbench.preview(
          context.req.param("threadId"),
          request,
          context.req.raw.signal,
        );
        context.header("Cache-Control", "no-store");
        setBodyContentSha256Header(context, preview);
        context.header(
          "X-Napier-Context-Compaction-Preview-SHA256",
          preview.previewSha256,
        );
        return context.json(preview);
      } catch (error) {
        return contextCompactionError(context, error);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/context-compaction/forks",
    async (context) => {
      const request = await readRequest(
        context.req.raw,
        validateApplyContextCompactionForkRequest,
      );
      if (request instanceof Error) {
        return jsonError(
          context,
          request.message,
          request instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      try {
        const result = await services.contextCompactionWorkbench.applyFork(
          context.req.param("threadId"),
          request,
        );
        context.header("Cache-Control", "no-store");
        setBodyContentSha256Header(context, result);
        context.header(
          "X-Napier-Context-Compaction-Preview-SHA256",
          result.previewSha256,
        );
        return context.json(result, 201);
      } catch (error) {
        return contextCompactionError(context, error);
      }
    },
  );
}

async function readRequest<T>(
  request: Request,
  validate: (input: unknown) => T,
): Promise<T | Error> {
  try {
    return validate(
      await readLimitedJson(
        request,
        MAX_CONTEXT_COMPACTION_REQUEST_BYTES,
        "Context compaction request",
      ),
    );
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function contextCompactionError(
  context: Parameters<typeof jsonError>[0],
  error: unknown,
): Response {
  const message = errorMessage(error);
  return jsonError(
    context,
    message,
    error instanceof ContextCompactionPreviewChangedError ||
      error instanceof ContextCompactionPreviewUnavailableError
      ? 409
      : message.includes("not found")
        ? 404
        : 400,
  );
}

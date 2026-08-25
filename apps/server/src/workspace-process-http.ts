import type { WorkspaceProcessManager } from "@napier/runtime/code";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const MAX_INPUT_REQUEST_BYTES = 128 * 1024;
const MAX_ROLLBACK_REQUEST_BYTES = 4 * 1024;

interface WorkspaceProcessHttpHelpers {
  jsonError(
    context: Context,
    message: string,
    status: ContentfulStatusCode,
  ): Response;
  errorMessage(error: unknown): string;
  readLimitedJson(
    request: Request,
    maximumBytes: number,
    subject: string,
  ): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  requestRecord(
    input: unknown,
    allowedKeys: readonly string[],
  ): Record<string, unknown> | undefined;
  setProjectionHeaders(context: Context, projection: unknown): void;
}

export function registerWorkspaceProcessHttp(
  app: Hono,
  processes: WorkspaceProcessManager,
  helpers: WorkspaceProcessHttpHelpers,
): void {
  app.get("/api/threads/:threadId/processes", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      const sessions = await processes.list(threadId);
      helpers.setProjectionHeaders(context, sessions);
      return context.json(sessions);
    } catch (error) {
      return helpers.jsonError(context, helpers.errorMessage(error), 404);
    }
  });

  app.get(
    "/api/threads/:threadId/processes/:processId/output",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      const after = Number.parseInt(context.req.query("after") ?? "0", 10);
      const wait = Number.parseInt(context.req.query("wait") ?? "0", 10);
      if (
        !validProcessId(processId) ||
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(wait) ||
        wait < 0 ||
        wait > 5_000
      ) {
        return helpers.jsonError(
          context,
          "Workspace Process output request is invalid",
          400,
        );
      }
      try {
        const output = await processes.output(threadId, processId, {
          afterCursor: after,
          waitMs: wait,
          signal: context.req.raw.signal,
        });
        helpers.setProjectionHeaders(context, output);
        return context.json(output);
      } catch (error) {
        return helpers.jsonError(context, helpers.errorMessage(error), 404);
      }
    },
  );

  app.get(
    "/api/threads/:threadId/processes/:processId/delta",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validProcessId(processId)) {
        return helpers.jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      try {
        const delta = await processes.delta(threadId, processId);
        helpers.setProjectionHeaders(context, delta);
        return context.json(delta);
      } catch (error) {
        return helpers.jsonError(context, helpers.errorMessage(error), 404);
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/rollback/preview",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validProcessId(processId)) {
        return helpers.jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      try {
        const preview = await processes.previewRollback(
          threadId,
          processId,
          context.req.raw.signal,
        );
        helpers.setProjectionHeaders(context, preview);
        return context.json(preview);
      } catch (error) {
        const message = helpers.errorMessage(error);
        return helpers.jsonError(
          context,
          message,
          rollbackErrorStatus(message),
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/rollback",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validProcessId(processId)) {
        return helpers.jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      let input: unknown;
      try {
        input = await helpers.readLimitedJson(
          context.req.raw,
          MAX_ROLLBACK_REQUEST_BYTES,
          "Workspace Process rollback request",
        );
      } catch (error) {
        return helpers.jsonError(
          context,
          helpers.errorMessage(error),
          helpers.requestBodyTooLarge(error) ? 413 : 400,
        );
      }
      const request = parseRollbackRequest(input, helpers.requestRecord);
      if (!request) {
        return helpers.jsonError(
          context,
          "Workspace Process rollback request is invalid",
          400,
        );
      }
      try {
        const result = await processes.rollback(
          threadId,
          processId,
          request.previewId,
          context.req.raw.signal,
        );
        helpers.setProjectionHeaders(context, result);
        return context.json(result);
      } catch (error) {
        const message = helpers.errorMessage(error);
        return helpers.jsonError(
          context,
          message,
          rollbackErrorStatus(message),
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/input",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validProcessId(processId)) {
        return helpers.jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      let input: unknown;
      try {
        input = await helpers.readLimitedJson(
          context.req.raw,
          MAX_INPUT_REQUEST_BYTES,
          "Workspace Process input request",
        );
      } catch (error) {
        return helpers.jsonError(
          context,
          helpers.errorMessage(error),
          helpers.requestBodyTooLarge(error) ? 413 : 400,
        );
      }
      const request = parseInputRequest(input, helpers.requestRecord);
      if (!request) {
        return helpers.jsonError(
          context,
          "Workspace Process input request is invalid",
          400,
        );
      }
      try {
        const receipt = await processes.writeInput({
          threadId,
          processId,
          ...request,
          initiatedBy: "operator",
          signal: context.req.raw.signal,
        });
        helpers.setProjectionHeaders(context, receipt);
        return context.json(receipt);
      } catch (error) {
        const message = helpers.errorMessage(error);
        return helpers.jsonError(
          context,
          message,
          message.includes("limit")
            ? 413
            : message.includes("valid UTF-8") ||
                message.includes("input is empty")
              ? 400
              : message.includes("not open") ||
                  message.includes("pipe close semantics") ||
                  message.includes("unavailable") ||
                  message.includes("unknown")
                ? 409
                : 404,
        );
      }
    },
  );

  app.post(
    "/api/threads/:threadId/processes/:processId/cancel",
    async (context) => {
      const threadId = context.req.param("threadId");
      const processId = context.req.param("processId");
      if (!validProcessId(processId)) {
        return helpers.jsonError(
          context,
          "Workspace Process Session ID is invalid",
          400,
        );
      }
      try {
        const session = await processes.cancel(threadId, processId);
        helpers.setProjectionHeaders(context, session);
        return context.json(session);
      } catch (error) {
        return helpers.jsonError(context, helpers.errorMessage(error), 404);
      }
    },
  );
}

function validProcessId(value: unknown): value is string {
  return typeof value === "string" && /^process_[a-z0-9]{8,80}$/u.test(value);
}

function parseInputRequest(
  input: unknown,
  requestRecord: WorkspaceProcessHttpHelpers["requestRecord"],
):
  | {
      text: string;
      appendNewline?: boolean;
      close?: boolean;
    }
  | undefined {
  const record = requestRecord(input, ["text", "appendNewline", "close"]);
  if (
    !record ||
    typeof record["text"] !== "string" ||
    (record["appendNewline"] !== undefined &&
      typeof record["appendNewline"] !== "boolean") ||
    (record["close"] !== undefined && typeof record["close"] !== "boolean") ||
    (record["text"].length === 0 &&
      record["appendNewline"] !== true &&
      record["close"] !== true)
  ) {
    return undefined;
  }
  return {
    text: record["text"],
    ...(record["appendNewline"] === true ? { appendNewline: true } : {}),
    ...(record["close"] === true ? { close: true } : {}),
  };
}

function parseRollbackRequest(
  input: unknown,
  requestRecord: WorkspaceProcessHttpHelpers["requestRecord"],
): { previewId: string } | undefined {
  const record = requestRecord(input, ["previewId"]);
  if (
    !record ||
    typeof record["previewId"] !== "string" ||
    !/^processrbprev_[a-z0-9]{8,80}$/u.test(record["previewId"])
  ) {
    return undefined;
  }
  return { previewId: record["previewId"] };
}

function rollbackErrorStatus(message: string): 404 | 409 | 500 {
  const normalized = message.toLowerCase();
  if (
    [
      "rollback is unavailable",
      "recovery binding is invalid",
      "recovery snapshot drifted",
      "workspace changed",
      "preview not found",
      "preview is stale",
      "already being edited",
      "was aborted",
    ].some((candidate) => normalized.includes(candidate))
  ) {
    return 409;
  }
  return normalized.includes("not found") ? 404 : 500;
}

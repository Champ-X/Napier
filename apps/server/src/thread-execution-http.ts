import type { RunEvent, RunRecord, StreamFrame } from "@napier/contracts";
import {
  type AgentRuntime,
  hashEventStream,
  type LocalStore,
  type ModelRegistry,
  streamEventFrame,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
} from "@napier/runtime";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import {
  setOperatorDecisionContinueStreamHeaders,
  setThreadPromptStreamHeaders,
  setThreadResumeStreamHeaders,
  setThreadStopHeaders,
} from "./thread-execution-http-response.js";
import {
  parsePromptRequest,
  parseResumeRunRequest,
} from "./thread-execution-http-validation.js";

const MAX_RESUME_REQUEST_BYTES = 8 * 1024;
const MAX_PROMPT_REQUEST_BYTES = 64 * 1024;

type ThreadExecutionStore = Pick<LocalStore, "getDetail">;
type ThreadExecutionRuntime = Pick<
  AgentRuntime,
  "continueOperatorDecision" | "resumeInterruptedRun" | "runPrompt" | "stop"
>;

export interface ThreadExecutionHttpServices {
  store: ThreadExecutionStore;
  models: ModelRegistry;
  runtime: ThreadExecutionRuntime;
}

export function registerThreadExecutionHttp(
  app: Hono,
  services: ThreadExecutionHttpServices,
): void {
  registerDecisionContinuationHttp(app, services);
  registerStopHttp(app, services.runtime);
  registerResumeHttp(app, services);
  registerPromptHttp(app, services);
}

function registerDecisionContinuationHttp(
  app: Hono,
  services: ThreadExecutionHttpServices,
): void {
  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/continue",
    (context) => {
      const threadId = context.req.param("threadId");
      const decisionId = context.req.param("decisionId");
      setOperatorDecisionContinueStreamHeaders(context, threadId, decisionId);
      return streamAgentRun(context, services, threadId, (onEvent) =>
        services.runtime.continueOperatorDecision({
          threadId,
          decisionId,
          onEvent,
        }),
      );
    },
  );
}

function registerStopHttp(app: Hono, runtime: ThreadExecutionRuntime): void {
  app.post("/api/threads/:threadId/stop", (context) => {
    const threadId = context.req.param("threadId");
    const receipt = { stopped: runtime.stop(threadId) };
    setThreadStopHeaders(context, threadId, receipt);
    return context.json(receipt, receipt.stopped ? 202 : 409);
  });
}

function registerResumeHttp(
  app: Hono,
  services: ThreadExecutionHttpServices,
): void {
  app.post("/api/threads/:threadId/resume", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_RESUME_REQUEST_BYTES,
        "Resume request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseResumeRunRequest(input);
    if (!body) return jsonError(context, "Resume request is invalid", 400);
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    setThreadResumeStreamHeaders(context, threadId, body.runId, body.model);
    return streamAgentRun(context, services, threadId, (onEvent) =>
      services.runtime.resumeInterruptedRun({
        threadId,
        ...(body.runId ? { runId: body.runId } : {}),
        ...(body.model ? { model: body.model } : {}),
        onEvent,
      }),
    );
  });
}

function registerPromptHttp(
  app: Hono,
  services: ThreadExecutionHttpServices,
): void {
  app.post("/api/threads/:threadId/messages", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_PROMPT_REQUEST_BYTES,
        "Prompt request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parsePromptRequest(input);
    if (!body) return jsonError(context, "Prompt request is invalid", 400);
    if (body.model) {
      try {
        await assertAvailableModel(services, body.model);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    }
    setThreadPromptStreamHeaders(context, threadId, body.model);
    return streamAgentRun(context, services, threadId, (onEvent) =>
      services.runtime.runPrompt({
        threadId,
        text: body.text,
        ...(body.model ? { model: body.model } : {}),
        onEvent,
      }),
    );
  });
}

function streamAgentRun(
  context: Context,
  services: ThreadExecutionHttpServices,
  threadId: string,
  execute: (
    onEvent: (event: RunEvent) => Promise<void>,
  ) => Promise<Pick<RunRecord, "id" | "status">>,
): Response {
  return streamSSE(context, async (stream) => {
    const writeFrame = async (
      frame: StreamFrame,
      id?: string,
    ): Promise<void> => {
      await stream.writeSSE({
        event: frame.type,
        data: JSON.stringify(frame),
        ...(id ? { id } : {}),
      });
    };
    try {
      const run = await execute(async (event) => {
        await writeFrame(streamEventFrame(event), String(event.seq));
      });
      const snapshotFrame = streamSnapshotFrame(
        await services.store.getDetail(threadId),
      );
      const doneFrame = streamRunDoneFrame(
        threadId,
        run.id,
        run.status,
        snapshotFrame.detailSha256,
        snapshotFrame.detailBytes,
        snapshotFrame.detail.thread.eventCount,
        snapshotFrame.eventBytes,
        hashEventStream(snapshotFrame.detail.events),
      );
      await writeFrame(snapshotFrame);
      await writeFrame(doneFrame);
    } catch (error) {
      await writeFrame(streamRunErrorFrame(threadId, error));
    }
  });
}

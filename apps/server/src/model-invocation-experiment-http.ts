import type {
  ModelInvocationExperimentResultFrame,
  StreamFrame,
} from "@napier/contracts";
import {
  createModelInvocationExperimentResultFrame,
  MAX_MODEL_INVOCATION_EXPERIMENT_REQUEST_BYTES,
  validateCreateModelInvocationExperimentRequest,
  type ModelInvocationExperimentRuntime,
} from "@napier/runtime/evaluation";
import {
  hashEventStream,
  OrderedRunEventWriter,
  streamEventFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
} from "@napier/runtime/core";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { ThreadWorkflowHttpStore } from "./thread-workflow-http-store.js";

export interface ModelInvocationExperimentHttpServices {
  store: ThreadWorkflowHttpStore;
  modelInvocationExperiments: ModelInvocationExperimentRuntime;
}

export interface ModelInvocationExperimentHttpHelpers {
  readJson(
    request: Request,
    maximumBytes: number,
    label: string,
  ): Promise<unknown>;
  jsonError(
    context: Context,
    message: string,
    status: 400 | 409 | 413,
  ): Response;
  isBodyTooLarge(error: unknown): boolean;
}

export async function previewModelInvocationExperimentHttp(
  context: Context,
  services: ModelInvocationExperimentHttpServices,
  helpers: ModelInvocationExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  if (prepared.request.expectedPreviewSha256 !== undefined) {
    return helpers.jsonError(
      context,
      "Model invocation experiment preview cannot include confirmation",
      400,
    );
  }
  try {
    const preview = await services.modelInvocationExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
      context.req.raw.signal,
    );
    setPreviewHeaders(context, preview.previewSha256);
    return context.json(preview);
  } catch {
    return helpers.jsonError(
      context,
      "Model invocation experiment preview is invalid",
      400,
    );
  }
}

export async function executeModelInvocationExperimentHttp(
  context: Context,
  services: ModelInvocationExperimentHttpServices,
  helpers: ModelInvocationExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  if (!prepared.request.expectedPreviewSha256) {
    return helpers.jsonError(
      context,
      "Model invocation experiment requires an expected preview hash",
      409,
    );
  }
  let preview;
  try {
    preview = await services.modelInvocationExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
      context.req.raw.signal,
    );
  } catch {
    return helpers.jsonError(
      context,
      "Model invocation experiment request is invalid",
      400,
    );
  }
  setPreviewHeaders(context, preview.previewSha256);
  if (prepared.request.expectedPreviewSha256 !== preview.previewSha256) {
    return helpers.jsonError(
      context,
      "Model invocation experiment preview changed before execution",
      409,
    );
  }

  const response = streamSSE(context, async (stream) => {
    let targetThreadId = prepared.sourceThreadId;
    let eventWriter: OrderedRunEventWriter | undefined;
    const writeFrame = async (
      frame: StreamFrame | ModelInvocationExperimentResultFrame,
      id?: string,
    ): Promise<void> => {
      await stream.writeSSE({
        event: frame.type,
        data: JSON.stringify(frame),
        ...(id ? { id } : {}),
      });
    };
    try {
      const experiment = await services.modelInvocationExperiments.run({
        sourceThreadId: prepared.sourceThreadId,
        request: prepared.request,
        signal: context.req.raw.signal,
        onTargetCreated: (thread) => {
          targetThreadId = thread.id;
          eventWriter = new OrderedRunEventWriter(
            thread.id,
            thread.eventCount + 1,
            async (event) =>
              writeFrame(streamEventFrame(event), String(event.seq)),
          );
        },
        onEvent: async (event) => {
          if (!eventWriter) {
            throw new Error(
              "Model invocation experiment target stream is unavailable",
            );
          }
          await eventWriter.write(event);
        },
      });
      const detail = await services.store.getDetail(experiment.targetThreadId);
      if (!eventWriter) {
        throw new Error(
          "Model invocation experiment target stream is unavailable",
        );
      }
      await eventWriter.finish(detail.thread.eventCount);
      const snapshot = streamSnapshotFrame(detail);
      const resultFrame = createModelInvocationExperimentResultFrame(
        experiment,
        snapshot,
        hashEventStream(detail.events),
      );
      await writeFrame(snapshot);
      await writeFrame(resultFrame);
    } catch (error) {
      await writeFrame(streamRunErrorFrame(targetThreadId, error));
    }
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function prepareRequest(
  context: Context,
  services: ModelInvocationExperimentHttpServices,
  helpers: ModelInvocationExperimentHttpHelpers,
): Promise<
  | {
      sourceThreadId: string;
      request: ReturnType<
        typeof validateCreateModelInvocationExperimentRequest
      >;
    }
  | Response
> {
  const sourceThreadId = context.req.param("threadId");
  if (!sourceThreadId) {
    return helpers.jsonError(
      context,
      "Model invocation experiment source is invalid",
      400,
    );
  }
  try {
    services.store.getThread(sourceThreadId);
  } catch {
    return helpers.jsonError(context, "Thread not found", 400);
  }
  let input: unknown;
  try {
    input = await helpers.readJson(
      context.req.raw,
      MAX_MODEL_INVOCATION_EXPERIMENT_REQUEST_BYTES,
      "Model invocation experiment request",
    );
  } catch (error) {
    return helpers.jsonError(
      context,
      helpers.isBodyTooLarge(error)
        ? errorMessage(error)
        : "Model invocation experiment request is invalid",
      helpers.isBodyTooLarge(error) ? 413 : 400,
    );
  }
  try {
    return {
      sourceThreadId,
      request: validateCreateModelInvocationExperimentRequest(input),
    };
  } catch {
    return helpers.jsonError(
      context,
      "Model invocation experiment request is invalid",
      400,
    );
  }
}

function setPreviewHeaders(context: Context, previewSha256: string): void {
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Content-SHA256", previewSha256);
  context.header("X-Napier-Content-SHA256-Mode", "stable");
  context.header(
    "X-Napier-Model-Invocation-Experiment-Preview-SHA256",
    previewSha256,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import type {
  AgentMessageExperimentResultFrame,
  StreamFrame,
} from "@napier/contracts";
import {
  createAgentMessageExperimentResultFrame,
  hashEventStream,
  MAX_AGENT_MESSAGE_EXPERIMENT_REQUEST_BYTES,
  OrderedRunEventWriter,
  streamEventFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  validateCreateAgentMessageExperimentRequest,
  type AgentMessageExperimentRuntime,
  type LocalStore,
} from "@napier/runtime";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

export interface AgentMessageExperimentHttpServices {
  store: LocalStore;
  agentMessageExperiments: AgentMessageExperimentRuntime;
}

export interface AgentMessageExperimentHttpHelpers {
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

export async function previewAgentMessageExperimentHttp(
  context: Context,
  services: AgentMessageExperimentHttpServices,
  helpers: AgentMessageExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  if (prepared.request.expectedPreviewSha256 !== undefined) {
    return helpers.jsonError(
      context,
      "Agent message experiment preview cannot include execution confirmation",
      400,
    );
  }
  try {
    const preview = await services.agentMessageExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
      context.req.raw.signal,
    );
    setPreviewHeaders(context, preview.previewSha256);
    return context.json(preview);
  } catch {
    return helpers.jsonError(
      context,
      "Agent message experiment preview is invalid",
      400,
    );
  }
}

export async function executeAgentMessageExperimentHttp(
  context: Context,
  services: AgentMessageExperimentHttpServices,
  helpers: AgentMessageExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  if (!prepared.request.expectedPreviewSha256) {
    return helpers.jsonError(
      context,
      "Agent message experiment requires an expected preview hash",
      409,
    );
  }
  let preview;
  try {
    preview = await services.agentMessageExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
      context.req.raw.signal,
    );
  } catch {
    return helpers.jsonError(
      context,
      "Agent message experiment request is invalid",
      400,
    );
  }
  setPreviewHeaders(context, preview.previewSha256);
  if (prepared.request.expectedPreviewSha256 !== preview.previewSha256) {
    return helpers.jsonError(
      context,
      "Agent message experiment preview changed before execution",
      409,
    );
  }
  context.header(
    "X-Napier-Agent-Experiment-Workspace-SHA256",
    preview.candidateWorkspaceSnapshotSha256,
  );

  const response = streamSSE(context, async (stream) => {
    let targetThreadId = prepared.sourceThreadId;
    let eventWriter: OrderedRunEventWriter | undefined;
    const writeFrame = async (
      frame: StreamFrame | AgentMessageExperimentResultFrame,
      id?: string,
    ): Promise<void> => {
      await stream.writeSSE({
        event: frame.type,
        data: JSON.stringify(frame),
        ...(id ? { id } : {}),
      });
    };
    try {
      const experiment = await services.agentMessageExperiments.run({
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
            throw new Error("Agent experiment target stream is unavailable");
          }
          await eventWriter.write(event);
        },
      });
      const detail = await services.store.getDetail(experiment.targetThreadId);
      if (!eventWriter) {
        throw new Error("Agent experiment target stream is unavailable");
      }
      await eventWriter.finish(detail.thread.eventCount);
      const snapshot = streamSnapshotFrame(detail);
      const resultFrame = createAgentMessageExperimentResultFrame(
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
  services: AgentMessageExperimentHttpServices,
  helpers: AgentMessageExperimentHttpHelpers,
): Promise<
  | {
      sourceThreadId: string;
      request: ReturnType<typeof validateCreateAgentMessageExperimentRequest>;
    }
  | Response
> {
  const sourceThreadId = context.req.param("threadId");
  if (!sourceThreadId) {
    return helpers.jsonError(
      context,
      "Agent message experiment source is invalid",
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
      MAX_AGENT_MESSAGE_EXPERIMENT_REQUEST_BYTES,
      "Agent message experiment request",
    );
  } catch (error) {
    return helpers.jsonError(
      context,
      helpers.isBodyTooLarge(error)
        ? errorMessage(error)
        : "Agent message experiment request is invalid",
      helpers.isBodyTooLarge(error) ? 413 : 400,
    );
  }
  try {
    return {
      sourceThreadId,
      request: validateCreateAgentMessageExperimentRequest(input),
    };
  } catch {
    return helpers.jsonError(
      context,
      "Agent message experiment request is invalid",
      400,
    );
  }
}

function setPreviewHeaders(context: Context, previewSha256: string): void {
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Content-SHA256", previewSha256);
  context.header("X-Napier-Content-SHA256-Mode", "stable");
  context.header("X-Napier-Agent-Experiment-Preview-SHA256", previewSha256);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

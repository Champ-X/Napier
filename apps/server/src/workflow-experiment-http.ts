import type {
  ExecutionPlanWorkflowExperimentResultFrame,
  StreamFrame,
} from "@napier/contracts";
import {
  createExecutionPlanWorkflowExperimentResultFrame,
  hashEventStream,
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
  OrderedRunEventWriter,
  streamEventFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  validateCreateExecutionPlanWorkflowExperimentRequest,
  type ExecutionPlanWorkflowExperimentRuntime,
  type LocalStore,
} from "@napier/runtime";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

export interface WorkflowExperimentHttpServices {
  store: LocalStore;
  workflowExperiments: ExecutionPlanWorkflowExperimentRuntime;
}

export interface WorkflowExperimentHttpHelpers {
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

export async function previewWorkflowExperimentHttp(
  context: Context,
  services: WorkflowExperimentHttpServices,
  helpers: WorkflowExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareExperimentRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  try {
    const preview = await services.workflowExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
    );
    setPreviewHeaders(context, preview.previewSha256);
    return context.json(preview);
  } catch {
    return helpers.jsonError(
      context,
      "Workflow experiment preview is invalid",
      400,
    );
  }
}

export async function executeWorkflowExperimentHttp(
  context: Context,
  services: WorkflowExperimentHttpServices,
  helpers: WorkflowExperimentHttpHelpers,
): Promise<Response> {
  const prepared = await prepareExperimentRequest(context, services, helpers);
  if (prepared instanceof Response) return prepared;
  let preview;
  try {
    preview = await services.workflowExperiments.preview(
      prepared.sourceThreadId,
      prepared.request,
    );
  } catch {
    return helpers.jsonError(
      context,
      "Workflow experiment request is invalid",
      400,
    );
  }
  setPreviewHeaders(context, preview.previewSha256);
  if (
    prepared.request.expectedPreviewSha256 !== undefined &&
    prepared.request.expectedPreviewSha256 !== preview.previewSha256
  ) {
    return helpers.jsonError(
      context,
      "Workflow experiment preview changed before execution",
      409,
    );
  }
  if (
    preview.requiresSideEffectConfirmation &&
    (prepared.request.confirmSideEffects !== true ||
      prepared.request.expectedPreviewSha256 !== preview.previewSha256)
  ) {
    return helpers.jsonError(
      context,
      "Workflow experiment requires explicit side-effect confirmation",
      409,
    );
  }
  context.header(
    "X-Napier-Workflow-Experiment-Source-Manifest-SHA256",
    preview.sourceManifestSha256,
  );
  context.header(
    "X-Napier-Workflow-Experiment-Candidate-Manifest-SHA256",
    preview.candidateManifestSha256,
  );

  const response = streamSSE(context, async (stream) => {
    let targetThreadId = prepared.sourceThreadId;
    let eventWriter: OrderedRunEventWriter | undefined;
    const writeFrame = async (
      frame: StreamFrame | ExecutionPlanWorkflowExperimentResultFrame,
      id?: string,
    ): Promise<void> => {
      await stream.writeSSE({
        event: frame.type,
        data: JSON.stringify(frame),
        ...(id ? { id } : {}),
      });
    };
    try {
      const experiment = await services.workflowExperiments.run({
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
            throw new Error("Workflow experiment target stream is unavailable");
          }
          await eventWriter.write(event);
        },
      });
      const detail = await services.store.getDetail(experiment.targetThreadId);
      if (!eventWriter) {
        throw new Error("Workflow experiment target stream is unavailable");
      }
      await eventWriter.finish(detail.thread.eventCount);
      const snapshot = streamSnapshotFrame(detail);
      const resultFrame = createExecutionPlanWorkflowExperimentResultFrame(
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

async function prepareExperimentRequest(
  context: Context,
  services: WorkflowExperimentHttpServices,
  helpers: WorkflowExperimentHttpHelpers,
): Promise<
  | {
      sourceThreadId: string;
      request: ReturnType<
        typeof validateCreateExecutionPlanWorkflowExperimentRequest
      >;
    }
  | Response
> {
  const sourceThreadId = context.req.param("threadId");
  const planId = context.req.param("planId");
  if (!sourceThreadId || !planId) {
    return helpers.jsonError(
      context,
      "Workflow experiment source is invalid",
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
      MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
      "Workflow experiment request",
    );
  } catch (error) {
    return helpers.jsonError(
      context,
      helpers.isBodyTooLarge(error)
        ? errorMessage(error)
        : "Workflow experiment request is invalid",
      helpers.isBodyTooLarge(error) ? 413 : 400,
    );
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    "planId" in input
  ) {
    return helpers.jsonError(
      context,
      "Workflow experiment request is invalid",
      400,
    );
  }
  try {
    return {
      sourceThreadId,
      request: validateCreateExecutionPlanWorkflowExperimentRequest({
        ...input,
        planId,
      }),
    };
  } catch {
    return helpers.jsonError(
      context,
      "Workflow experiment request is invalid",
      400,
    );
  }
}

function setPreviewHeaders(context: Context, previewSha256: string): void {
  context.header("Cache-Control", "no-store");
  context.header("X-Napier-Content-SHA256", previewSha256);
  context.header("X-Napier-Content-SHA256-Mode", "stable");
  context.header("X-Napier-Workflow-Experiment-Preview-SHA256", previewSha256);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

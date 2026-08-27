import type {
  ExecutionPlanWorkflowResultFrame,
  StreamFrame,
} from "@napier/contracts";
import {
  createExecutionPlanWorkflowResultFrame,
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
  validateExecuteExecutionPlanWorkflowRequest,
  type ExecutionPlanWorkflowRuntime,
} from "@napier/runtime/workflow";
import {
  hashEventStream,
  OrderedRunEventWriter,
  streamEventFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
} from "@napier/runtime/core";
import {
  type AgentKernel,
} from "@napier/runtime/agent";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { ThreadWorkflowHttpStore } from "./thread-workflow-http-store.js";
import {
  attachKernelThreadProjections,
  projectKernelThreadProjections,
} from "./kernel-thread-projections.js";

export interface WorkflowHttpServices {
  store: ThreadWorkflowHttpStore;
  kernel: Pick<
    AgentKernel,
    | "activePlans"
    | "conversationActivityCandidates"
    | "conversationActivityEvents"
    | "conversationArtifacts"
    | "conversationCitations"
    | "conversationMessages"
    | "conversationPlans"
    | "conversationRecoveries"
    | "conversationSubagents"
    | "operatorDecisions"
    | "taskNarratives"
  >;
  workflows: ExecutionPlanWorkflowRuntime;
  subagentHubControls: Pick<
    import("@napier/runtime/subagents").SubagentHubControlService,
    "availability"
  >;
}

export interface WorkflowHttpHelpers {
  readJson(
    request: Request,
    maximumBytes: number,
    label: string,
  ): Promise<unknown>;
  jsonError(context: Context, message: string, status: 400 | 413): Response;
  isBodyTooLarge(error: unknown): boolean;
}

export async function executeWorkflowHttp(
  context: Context,
  services: WorkflowHttpServices,
  helpers: WorkflowHttpHelpers,
): Promise<Response> {
  const threadId = context.req.param("threadId");
  if (!threadId) {
    return helpers.jsonError(context, "Thread not found", 400);
  }
  try {
    services.store.getThread(threadId);
  } catch {
    return helpers.jsonError(context, "Thread not found", 400);
  }
  let input: unknown;
  try {
    input = await helpers.readJson(
      context.req.raw,
      MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
      "Workflow execution request",
    );
  } catch (error) {
    return helpers.jsonError(
      context,
      helpers.isBodyTooLarge(error)
        ? errorMessage(error)
        : "Workflow execution request is invalid",
      helpers.isBodyTooLarge(error) ? 413 : 400,
    );
  }
  let request: ReturnType<typeof validateExecuteExecutionPlanWorkflowRequest>;
  try {
    request = validateExecuteExecutionPlanWorkflowRequest(input);
  } catch {
    return helpers.jsonError(
      context,
      "Workflow execution request is invalid",
      400,
    );
  }
  context.header(
    "X-Napier-Workflow-Manifest-SHA256",
    request.manifest.contentSha256,
  );
  context.header(
    "X-Napier-Workflow-Blueprint-SHA256",
    request.manifest.blueprint.contentSha256,
  );
  context.header("X-Napier-Workflow-Version", String(request.manifest.version));
  context.header(
    "X-Napier-Workflow-Node-Count",
    String(request.manifest.nodeCount),
  );
  context.header(
    "X-Napier-Workflow-Max-Concurrency",
    String(request.manifest.maxConcurrency ?? 1),
  );
  if ("breakBeforeNodeIds" in request) {
    context.header(
      "X-Napier-Workflow-Breakpoint-Count",
      String(request.breakBeforeNodeIds?.length ?? 0),
    );
  }

  return streamSSE(context, async (stream) => {
    const writeFrame = async (
      frame: StreamFrame | ExecutionPlanWorkflowResultFrame,
      id?: string,
    ): Promise<void> => {
      await stream.writeSSE({
        event: frame.type,
        data: JSON.stringify(frame),
        ...(id ? { id } : {}),
      });
    };
    const eventWriter = new OrderedRunEventWriter(
      threadId,
      services.store.getThread(threadId).eventCount + 1,
      async (event) =>
        projectKernelThreadProjections(
          threadId,
          services.kernel,
          services.subagentHubControls,
        ).then(
          (projections) =>
            writeFrame(streamEventFrame(event, projections), String(event.seq)),
        ),
    );
    try {
      const result = await services.workflows.run({
        threadId,
        request,
        signal: context.req.raw.signal,
        onEvent: async (event) => eventWriter.write(event),
      });
      const detail = await services.store.getDetail(threadId, {
        kernelProjections: false,
      });
      await attachKernelThreadProjections(
        detail,
        services.kernel,
        services.subagentHubControls,
      );
      await eventWriter.reconcile(detail.events);
      await eventWriter.finish(detail.thread.eventCount);
      const snapshot = streamSnapshotFrame(detail);
      const resultFrame = createExecutionPlanWorkflowResultFrame(
        result,
        snapshot,
        hashEventStream(detail.events),
      );
      await writeFrame(snapshot);
      await writeFrame(resultFrame);
    } catch (error) {
      await writeFrame(streamRunErrorFrame(threadId, error));
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

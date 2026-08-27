import type { RunEvent, RunRecord, StreamFrame } from "@napier/contracts";
import {
  type AgentKernel,
} from "@napier/runtime/agent";
import {
  hashEventStream,
  streamEventFrame,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
} from "@napier/runtime/core";
import {
  type LocalStore,
} from "@napier/runtime/store";
import {
  type ModelRegistry,
} from "@napier/runtime/model";
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
import { inspectThreadPromptReadiness } from "./thread-run-readiness.js";
import {
  attachKernelThreadProjections,
  projectKernelThreadProjections,
} from "./kernel-thread-projections.js";

const MAX_RESUME_REQUEST_BYTES = 8 * 1024;
const MAX_PROMPT_REQUEST_BYTES = 64 * 1024;

type ThreadExecutionStore = Pick<LocalStore, "getDetail" | "getThread">;
type ThreadExecutionRuntime = Pick<
  AgentKernel,
  "continueOperatorDecision" | "resumeInterruptedRun" | "runPrompt" | "stop"
>;

export interface ThreadExecutionHttpServices {
  store: ThreadExecutionStore;
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
    | "continueOperatorDecision"
    | "operatorDecisions"
    | "resumeInterruptedRun"
    | "runPrompt"
    | "stop"
    | "taskNarratives"
  >;
  models: ModelRegistry;
  subagentHubControls: Pick<
    import("@napier/runtime/subagents").SubagentHubControlService,
    "availability"
  >;
  agentCapabilities: Pick<
    import("@napier/runtime/agent").LocalAgentRuntimeServices["agentCapabilities"],
    "blockedRunReadinessProjection"
  >;
}

export function registerThreadExecutionHttp(
  app: Hono,
  services: ThreadExecutionHttpServices,
): void {
  registerDecisionContinuationHttp(app, services);
  registerStopHttp(app, services.kernel);
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
        services.kernel.continueOperatorDecision({
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
      services.kernel.resumeInterruptedRun({
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
    try {
      const subagentModels = Object.values(
        body.modelRoute?.subagentRoles ?? {},
      ).flatMap((binding) =>
        binding ? [binding.model, ...(binding.fallbackModels ?? [])] : [],
      );
      await Promise.all(
        [...(body.modelRoute?.fallbackModels ?? []), ...subagentModels].map((candidate) =>
          assertAvailableModel(services, candidate),
        ),
      );
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
    try {
      const readiness = await inspectThreadPromptReadiness({
        store: services.store,
        agentCapabilities: services.agentCapabilities,
        threadId,
        ...(body.capabilityPreset
          ? { capabilityPreset: body.capabilityPreset }
          : {}),
      });
      if (readiness.executionMode === "environment_degraded_read_only") {
        context.header("X-Napier-Run-Readiness", "degraded_read_only");
        context.header(
          "X-Napier-Agent-Capability-Projection-SHA256",
          readiness.projectionSha256,
        );
      }
    } catch (error) {
      if (!errorMessage(error).startsWith("Thread not found:")) {
        return jsonError(
          context,
          "Run readiness could not be verified; refresh capability readiness and retry.",
          503,
        );
      }
    }
    setThreadPromptStreamHeaders(
      context,
      threadId,
      body.model,
      body.capabilityPreset,
      body.sourceContinuityRunId,
    );
    return streamAgentRun(context, services, threadId, (onEvent) =>
      services.kernel.runPrompt({
        threadId,
        text: body.text,
        ...(body.model ? { model: body.model } : {}),
        ...(body.modelRoute ? { modelRoute: body.modelRoute } : {}),
        ...(body.capabilityPreset
          ? { capabilityPreset: body.capabilityPreset }
          : {}),
        ...(body.sourceContinuityRunId
          ? { sourceContinuityRunId: body.sourceContinuityRunId }
          : {}),
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
        const projections = await projectKernelThreadProjections(
          threadId,
          services.kernel,
          services.subagentHubControls,
        );
        await writeFrame(
          streamEventFrame(event, projections),
          String(event.seq),
        );
      });
      const detail = await services.store.getDetail(threadId, {
        kernelProjections: false,
      });
      await attachKernelThreadProjections(
        detail,
        services.kernel,
        services.subagentHubControls,
      );
      const snapshotFrame = streamSnapshotFrame(detail);
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

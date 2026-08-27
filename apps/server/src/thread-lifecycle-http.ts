import {
  type AgentKernel,
  createGoal,
  MAX_THREAD_REPLAY_BUNDLE_BYTES,
  validateThreadReplayBundle,
} from "@napier/runtime/agent";
import {
  createId,
} from "@napier/runtime/core";
import {
  type LocalStore,
} from "@napier/runtime/store";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  normalizeThreadTitle,
  parseCreateThreadRequest,
  parseImportThreadReplayBundleRequest,
  parseSetGoalRequest,
} from "./thread-lifecycle-http-validation.js";
import { setThreadDetailProjectionHeaders } from "./thread-lifecycle-http-response.js";
import { attachKernelThreadProjections } from "./kernel-thread-projections.js";

const MAX_THREAD_CREATE_REQUEST_BYTES = 8 * 1024;
const MAX_GOAL_REQUEST_BYTES = 8 * 1024;

type ThreadLifecycleHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createThread"
  | "getAgent"
  | "getDetail"
  | "importThreadReplayBundle"
  | "listAgents"
  | "restoreThread"
  | "setGoal"
  | "trashThread"
>;

export interface ThreadLifecycleHttpServices {
  store: ThreadLifecycleHttpStore;
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
  subagentHubControls: Pick<
    import("@napier/runtime/subagents").SubagentHubControlService,
    "availability"
  >;
}

export function registerThreadLifecycleHttp(
  app: Hono,
  services: ThreadLifecycleHttpServices,
): void {
  app.get("/api/threads/:threadId", async (context) => {
    const detail = await projectDetail(services, context.req.param("threadId"));
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });

  app.post("/api/threads", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_THREAD_CREATE_REQUEST_BYTES,
        "Thread creation request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateThreadRequest(input);
    if (!body) {
      return jsonError(context, "Thread creation request is invalid", 400);
    }
    const agent = body.agentId
      ? services.store.getAgent(body.agentId)
      : services.store.listAgents()[0];
    if (!agent) throw new Error("No agent profiles are available");
    const thread = await services.store.createThread({
      title: normalizeThreadTitle(body.title),
      agentId: agent.id,
    });
    const detail = await projectDetail(services, thread.id);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail, 201);
  });

  app.post("/api/threads/import", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid thread replay import request: ${error.message}`
          : "Invalid thread replay import request",
        400,
      );
    }
    const request = parseImportThreadReplayBundleRequest(input);
    if (!request) {
      return jsonError(context, "Thread replay import request is invalid", 400);
    }
    let bundle;
    try {
      bundle = validateThreadReplayBundle(request.bundle);
    } catch (error) {
      return jsonError(
        context,
        error instanceof Error
          ? error.message
          : "Thread replay bundle is invalid",
        400,
      );
    }
    const detail = await services.store.importThreadReplayBundle(
      bundle,
      request.title,
    );
    await attachKernelThreadProjections(
      detail,
      services.kernel,
      services.subagentHubControls,
    );
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail, 201);
  });

  app.delete("/api/threads/:threadId", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      await services.store.trashThread(threadId);
      const detail = await projectDetail(services, threadId);
      setThreadDetailProjectionHeaders(context, detail);
      return context.json(detail);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(
        context,
        message,
        message.includes("not found")
          ? 404
          : message.includes("active work")
            ? 409
            : 400,
      );
    }
  });

  app.post("/api/threads/:threadId/restore", async (context) => {
    const threadId = context.req.param("threadId");
    try {
      await services.store.restoreThread(threadId);
      const detail = await projectDetail(services, threadId);
      setThreadDetailProjectionHeaders(context, detail);
      return context.json(detail);
    } catch (error) {
      const message = errorMessage(error);
      return jsonError(
        context,
        message,
        message.includes("not found") ? 404 : 400,
      );
    }
  });

  registerGoalHttp(app, services);
}

function registerGoalHttp(
  app: Hono,
  services: ThreadLifecycleHttpServices,
): void {
  const store = services.store;
  app.put("/api/threads/:threadId/goal", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_GOAL_REQUEST_BYTES,
        "Goal request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetGoalRequest(input);
    if (!body) return jsonError(context, "Goal request is invalid", 400);
    const goal = createGoal(body.objective, body.maxContinuations);
    const threadId = context.req.param("threadId");
    await store.setGoal(threadId, goal);
    await store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "goal.set",
      category: "goal",
      visibility: "user",
      payload: {
        objective: goal.objective,
        maxContinuations: goal.maxContinuations,
      },
    });
    const detail = await projectDetail(services, threadId);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });

  app.delete("/api/threads/:threadId/goal", async (context) => {
    const threadId = context.req.param("threadId");
    await store.setGoal(threadId, undefined);
    await store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "goal.cleared",
      category: "goal",
      visibility: "user",
      payload: {},
    });
    const detail = await projectDetail(services, threadId);
    setThreadDetailProjectionHeaders(context, detail);
    return context.json(detail);
  });
}

async function projectDetail(
  services: ThreadLifecycleHttpServices,
  threadId: string,
) {
  const detail = await services.store.getDetail(threadId, {
    kernelProjections: false,
  });
  return attachKernelThreadProjections(
    detail,
    services.kernel,
    services.subagentHubControls,
  );
}

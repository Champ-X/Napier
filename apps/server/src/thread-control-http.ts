import {
  type AgentKernel,
  createThreadBranch,
  MAX_RUN_CONTROL_MESSAGE_BYTES,
  ThreadBranchRequestError,
} from "@napier/runtime/agent";
import {
  type LocalStore,
} from "@napier/runtime/store";
import { Hono } from "hono";

import { registerBrowserInteractionConfirmationHttp } from "./browser-interaction-confirmation-http.js";
import { registerBrowserLiveViewHttp } from "./browser-live-view-http.js";
import { registerBrowserSessionControlHttp } from "./browser-session-control-http.js";
import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  setAgentMilestoneListHeaders,
  operatorDecisionErrorStatus,
  runControlMessageErrorStatus,
  setOperatorDecisionHeaders,
  setOperatorDecisionListHeaders,
  setRunControlMessageHeaders,
  setRunControlMessageListHeaders,
} from "./thread-control-http-response.js";
import {
  parseAnswerOperatorDecisionRequest,
  parseCreateBranchRequest,
  parseQueueRunControlMessageRequest,
} from "./thread-control-http-validation.js";
import { setThreadDetailProjectionHeaders } from "./thread-lifecycle-http-response.js";

const MAX_BRANCH_REQUEST_BYTES = 8 * 1024;
const MAX_OPERATOR_DECISION_REQUEST_BYTES = 32 * 1024;
const MAX_RUN_CONTROL_MESSAGE_REQUEST_BYTES =
  MAX_RUN_CONTROL_MESSAGE_BYTES * 6 + 1024;

type ThreadBranchStore = Parameters<typeof createThreadBranch>[0];
type ThreadControlHttpStore = ThreadBranchStore &
  Pick<
    LocalStore,
    | "answerOperatorDecision"
    | "cancelOperatorDecision"
    | "cancelRunControlMessage"
    | "listAgentMilestones"
    | "listOperatorDecisions"
    | "listRunControlMessages"
    | "listRuns"
    | "queueRunControlMessage"
  >;

export interface ThreadControlHttpServices {
  store: ThreadControlHttpStore;
  kernel: Pick<AgentKernel, "operatorDecisions">;
  runtime: {
    browserInteractionConfirmations: Parameters<
      typeof registerBrowserInteractionConfirmationHttp
    >[1];
    browserLiveViews: Parameters<typeof registerBrowserLiveViewHttp>[1];
    browserSessionControls: Parameters<
      typeof registerBrowserSessionControlHttp
    >[1];
  };
}

export function registerThreadControlHttp(
  app: Hono,
  services: ThreadControlHttpServices,
): void {
  registerThreadBranchHttp(app, services.store);
  registerRunControlMessageHttp(app, services.store);
  registerBrowserInteractionConfirmationHttp(
    app,
    services.runtime.browserInteractionConfirmations,
  );
  registerBrowserLiveViewHttp(app, services.runtime.browserLiveViews);
  registerBrowserSessionControlHttp(
    app,
    services.runtime.browserSessionControls,
  );
  registerOperatorDecisionHttp(app, services);
  registerAgentMilestoneHttp(app, services.store);
}

function registerThreadBranchHttp(
  app: Hono,
  store: ThreadControlHttpStore,
): void {
  app.post("/api/threads/:threadId/branches", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_BRANCH_REQUEST_BYTES,
        "Thread branch request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateBranchRequest(input);
    if (!body) {
      return jsonError(context, "Thread branch request is invalid", 400);
    }
    try {
      const { detail } = await createThreadBranch(
        store,
        context.req.param("threadId"),
        body,
      );
      setThreadDetailProjectionHeaders(context, detail);
      return context.json(detail, 201);
    } catch (error) {
      if (error instanceof ThreadBranchRequestError) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
  });
}

function registerRunControlMessageHttp(
  app: Hono,
  store: ThreadControlHttpStore,
): void {
  app.get(
    "/api/threads/:threadId/runs/:runId/control-messages",
    async (context) => {
      const threadId = context.req.param("threadId");
      const runId = context.req.param("runId");
      const run = store
        .listRuns(threadId)
        .find((candidate) => candidate.id === runId);
      if (!run) return jsonError(context, `Run not found: ${runId}`, 404);
      const messages = await store.listRunControlMessages(threadId, runId);
      setRunControlMessageListHeaders(context, threadId, runId, messages);
      return context.json(messages);
    },
  );
  app.post(
    "/api/threads/:threadId/runs/:runId/control-messages",
    async (context) => {
      const threadId = context.req.param("threadId");
      const runId = context.req.param("runId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_RUN_CONTROL_MESSAGE_REQUEST_BYTES,
          "Run control message request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseQueueRunControlMessageRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Run control message request is invalid",
          400,
        );
      }
      try {
        const message = await store.queueRunControlMessage({
          threadId,
          runId,
          mode: body.mode,
          text: body.text,
        });
        setRunControlMessageHeaders(context, message);
        return context.json(message, 202);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          runControlMessageErrorStatus(error),
        );
      }
    },
  );
  app.post(
    "/api/threads/:threadId/runs/:runId/control-messages/:controlMessageId/cancel",
    async (context) => {
      try {
        const message = await store.cancelRunControlMessage(
          context.req.param("threadId"),
          context.req.param("runId"),
          context.req.param("controlMessageId"),
        );
        setRunControlMessageHeaders(context, message);
        return context.json(message);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          runControlMessageErrorStatus(error),
        );
      }
    },
  );
}

function registerOperatorDecisionHttp(
  app: Hono,
  services: ThreadControlHttpServices,
): void {
  const store = services.store;
  app.get("/api/threads/:threadId/operator-decisions", async (context) => {
    const threadId = context.req.param("threadId");
    const decisions = (
      await services.kernel.operatorDecisions.project(threadId)
    ).view;
    setOperatorDecisionListHeaders(context, threadId, decisions);
    return context.json(decisions);
  });
  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/answer",
    async (context) => {
      const threadId = context.req.param("threadId");
      const decisionId = context.req.param("decisionId");
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_OPERATOR_DECISION_REQUEST_BYTES,
          "Operator decision answer request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const body = parseAnswerOperatorDecisionRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Operator decision answer request is invalid",
          400,
        );
      }
      try {
        const mutation = await store.answerOperatorDecision(
          threadId,
          decisionId,
          body,
        );
        setOperatorDecisionHeaders(context, mutation.decision);
        return context.json(mutation.decision, 202);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          operatorDecisionErrorStatus(error),
        );
      }
    },
  );
  app.post(
    "/api/threads/:threadId/operator-decisions/:decisionId/cancel",
    async (context) => {
      try {
        const mutation = await store.cancelOperatorDecision(
          context.req.param("threadId"),
          context.req.param("decisionId"),
        );
        setOperatorDecisionHeaders(context, mutation.decision);
        return context.json(mutation.decision);
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          operatorDecisionErrorStatus(error),
        );
      }
    },
  );
}

function registerAgentMilestoneHttp(
  app: Hono,
  store: ThreadControlHttpStore,
): void {
  app.get("/api/threads/:threadId/agent-milestones", async (context) => {
    const threadId = context.req.param("threadId");
    const milestones = await store.listAgentMilestones(threadId);
    setAgentMilestoneListHeaders(context, threadId, milestones);
    return context.json(milestones);
  });
}

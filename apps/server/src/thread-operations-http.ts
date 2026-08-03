import {
  reviewSubagentOutcome,
  type LocalStore,
  type ModelRegistry,
  verifySubagentOutcomeEvidence,
  type WorkspaceFileMutationManager,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import {
  setAutomaticRecoveryProjectionHeaders,
  setSubagentOutcomeEvidenceVerificationHeaders,
  setSubagentOutcomeReviewHeaders,
  setWorkspaceFileProjectionHeaders,
} from "./thread-operations-http-response.js";
import {
  parseReviewSubagentOutcomeRequest,
  validWorkspaceTrashId,
} from "./thread-operations-http-validation.js";

const MAX_SUBAGENT_REVIEW_REQUEST_BYTES = 8 * 1024;

type ThreadOperationsHttpStore = Pick<
  LocalStore,
  | "getThread"
  | "listAutomaticRecoveryAssessments"
  | "listAutomaticRecoveryAttempts"
  | "listSubagentTasks"
  | "workspaceRoot"
>;

export interface ThreadOperationsHttpServices {
  store: ThreadOperationsHttpStore;
  models: ModelRegistry;
  workspaceFileMutations: WorkspaceFileMutationManager;
}

export function registerThreadOperationsHttp(
  app: Hono,
  services: ThreadOperationsHttpServices,
): void {
  registerSubagentOutcomeHttp(app, services);
  registerRecoveryHttp(app, services.store);
  registerWorkspaceTrashHttp(app, services.workspaceFileMutations);
}

function registerSubagentOutcomeHttp(
  app: Hono,
  services: ThreadOperationsHttpServices,
): void {
  app.post(
    "/api/threads/:threadId/subagents/:taskId/outcome/verify",
    async (context) => {
      const task = subagentTask(
        services.store,
        context.req.param("threadId"),
        context.req.param("taskId"),
      );
      if (!task) return jsonError(context, "Subagent task not found", 404);
      if (!task.outcome) {
        return jsonError(context, "Subagent outcome is unavailable", 409);
      }
      const verification = await verifySubagentOutcomeEvidence(
        task.outcome,
        services.store.workspaceRoot,
      );
      setSubagentOutcomeEvidenceVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.post(
    "/api/threads/:threadId/subagents/:taskId/outcome/review",
    async (context) => {
      const task = subagentTask(
        services.store,
        context.req.param("threadId"),
        context.req.param("taskId"),
      );
      if (!task) return jsonError(context, "Subagent task not found", 404);
      if (!task.outcome) {
        return jsonError(context, "Subagent outcome is unavailable", 409);
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_SUBAGENT_REVIEW_REQUEST_BYTES,
          "Subagent outcome review request",
        );
      } catch (error) {
        return jsonError(
          context,
          errorMessage(error),
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const request = parseReviewSubagentOutcomeRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Subagent outcome review request is invalid",
          400,
        );
      }
      try {
        await assertAvailableModel(services, request.model);
        const review = await reviewSubagentOutcome(
          services.models,
          task,
          request.model,
        );
        setSubagentOutcomeReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function subagentTask(
  store: ThreadOperationsHttpStore,
  threadId: string,
  taskId: string,
):
  | ReturnType<ThreadOperationsHttpStore["listSubagentTasks"]>[number]
  | undefined {
  store.getThread(threadId);
  const task = store
    .listSubagentTasks(threadId)
    .find((candidate) => candidate.id === taskId);
  return task;
}

function registerRecoveryHttp(
  app: Hono,
  store: ThreadOperationsHttpStore,
): void {
  app.get("/api/threads/:threadId/recovery", (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const recovery = {
      assessments: store.listAutomaticRecoveryAssessments(threadId),
      attempts: store.listAutomaticRecoveryAttempts(threadId),
    };
    setAutomaticRecoveryProjectionHeaders(context, recovery);
    return context.json(recovery);
  });
}

function registerWorkspaceTrashHttp(
  app: Hono,
  workspaceFiles: WorkspaceFileMutationManager,
): void {
  app.get("/api/threads/:threadId/workspace-trash", async (context) => {
    try {
      const list = await workspaceFiles.listTrash(
        context.req.param("threadId"),
      );
      setWorkspaceFileProjectionHeaders(context, list);
      return context.json(list);
    } catch (error) {
      return jsonError(context, errorMessage(error), 404);
    }
  });
  app.post(
    "/api/threads/:threadId/workspace-trash/:trashId/restore",
    async (context) => {
      const trashId = context.req.param("trashId");
      if (!validWorkspaceTrashId(trashId)) {
        return jsonError(context, "Workspace trash ID is invalid", 400);
      }
      try {
        const result = await workspaceFiles.restoreTrash(
          context.req.param("threadId"),
          trashId,
          context.req.raw.signal,
        );
        setWorkspaceFileProjectionHeaders(context, result);
        return context.json(result);
      } catch (error) {
        const message = errorMessage(error);
        return jsonError(
          context,
          message,
          message.includes("already exists") ||
            message.includes("drifted") ||
            message.includes("stale")
            ? 409
            : 404,
        );
      }
    },
  );
}

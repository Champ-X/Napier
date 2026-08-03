import type {
  TransitionPlanStepRequest,
  UpdateArtifactManifestRequest,
} from "@napier/contracts";
import {
  createId,
  createPlanArtifactEventPayload,
  createWorkspaceArtifactDriftRequest,
  createWorkspaceArtifactVerificationRequest,
  type LocalStore,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { getThreadPlan } from "./plan-artifact-http-store.js";
import { setExecutionPlanHeaders } from "./plan-lifecycle-http-response.js";
import {
  parseTransitionPlanStepRequest,
  parseUpdateArtifactManifestRequest,
} from "./plan-progress-http-validation.js";

export type PlanProgressHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getPlan"
  | "transitionPlanStep"
  | "updatePlanArtifact"
  | "workspaceRoot"
>;

export function registerPlanProgressHttp(
  app: Hono,
  store: PlanProgressHttpStore,
): void {
  registerPlanStepTransitionHttp(app, store);
  registerPlanArtifactLifecycleHttp(app, store);
}

function registerPlanStepTransitionHttp(
  app: Hono,
  store: PlanProgressHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/steps/:stepId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      getThreadPlan(store, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          8 * 1024,
          "Plan step transition request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Plan step transition request is invalid",
          400,
        );
      }
      const body = parseTransitionPlanStepRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Plan step transition request is invalid",
          400,
        );
      }
      const before = store.getPlan(planId);
      const plan = await store.transitionPlanStep(
        planId,
        context.req.param("stepId"),
        body,
      );
      const step = plan.steps.find(
        (candidate) => candidate.id === context.req.param("stepId"),
      );
      if (plan.revision !== before.revision && step) {
        await store.appendEvent({
          threadId,
          runId: body.runId ?? createId("runctl"),
          type: `plan.step.${planStepEventSuffix(body.action)}`,
          category: "plan",
          visibility: "user",
          payload: {
            planId,
            stepId: step.id,
            title: step.title,
            status: step.status,
            planStatus: plan.status,
            criticalPathStepIds: plan.criticalPathStepIds,
            readyStepIds: plan.readyStepIds,
            blockedStepIds: plan.blockedStepIds,
            evidence: step.evidence,
            ...(step.blocker ? { blocker: step.blocker } : {}),
            ...(step.runId ? { runId: step.runId } : {}),
          },
        });
      }
      setExecutionPlanHeaders(context, plan);
      return context.json(plan);
    },
  );
}

function registerPlanArtifactLifecycleHttp(
  app: Hono,
  store: PlanProgressHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      getThreadPlan(store, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          16 * 1024,
          "Plan artifact request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(context, "Plan artifact request is invalid", 400);
      }
      const body = parseUpdateArtifactManifestRequest(input);
      if (!body) {
        return jsonError(context, "Plan artifact request is invalid", 400);
      }
      const before = store.getPlan(planId);
      let artifactRequest: UpdateArtifactManifestRequest = body;
      if (body.observeWorkspace) {
        const artifact = before.artifacts.find(
          (candidate) => candidate.id === context.req.param("artifactId"),
        );
        if (!artifact) {
          return jsonError(context, "Plan artifact request is invalid", 400);
        }
        try {
          artifactRequest =
            body.status === "missing"
              ? await createWorkspaceArtifactDriftRequest(
                  store.workspaceRoot,
                  artifact,
                  body,
                )
              : await createWorkspaceArtifactVerificationRequest(
                  store.workspaceRoot,
                  artifact,
                  body,
                );
        } catch (error) {
          return jsonError(context, errorMessage(error), 400);
        }
      }
      const plan = await store.updatePlanArtifact(
        planId,
        context.req.param("artifactId"),
        artifactRequest,
      );
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (plan.revision !== before.revision && artifact) {
        await store.appendEvent({
          threadId,
          runId: artifactRequest.sourceRunId ?? createId("runctl"),
          type: `plan.artifact.${artifact.status}`,
          category: "plan",
          visibility: "user",
          payload: createPlanArtifactEventPayload(plan, artifact),
        });
      }
      setExecutionPlanHeaders(context, plan);
      return context.json(plan);
    },
  );
}

function planStepEventSuffix(
  action: TransitionPlanStepRequest["action"],
): string {
  if (action === "start") return "started";
  if (action === "complete") return "completed";
  if (action === "block") return "blocked";
  if (action === "skip") return "skipped";
  return "reopened";
}

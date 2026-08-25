import {
  createExecutionPlanArchive,
  createExecutionPlanBlueprint,
  MAX_EXECUTION_PLAN_ARCHIVE_BYTES,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
  reviewExecutionPlanReplanDraft,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
} from "@napier/runtime/workflow";
import {
  createId,
} from "@napier/runtime/core";
import {
  type LocalStore,
} from "@napier/runtime/store";
import {
  type ModelRegistry,
} from "@napier/runtime/model";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import {
  bindExecutionPlanArchiveVerification,
  setExecutionPlanArchiveHeaders,
  setExecutionPlanArchiveVerificationHeaders,
  setExecutionPlanBlueprintHeaders,
  setExecutionPlanBlueprintVerificationHeaders,
  setExecutionPlanHeaders,
  setExecutionPlanListHeaders,
  setExecutionPlanReplanDraftReviewHeaders,
} from "./plan-lifecycle-http-response.js";
import {
  parseCreateExecutionPlanRequest,
  parseReplanExecutionPlanRequest,
  parseReviewExecutionPlanReplanDraftRequest,
  parseVerifyExecutionPlanArchiveRequest,
  parseVerifyExecutionPlanBlueprintRequest,
} from "./plan-lifecycle-http-validation.js";

type PlanLifecycleHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createPlan"
  | "getAgent"
  | "getPlan"
  | "getThread"
  | "listEvents"
  | "listPlans"
  | "replanPlan"
>;

export interface PlanLifecycleHttpServices {
  store: PlanLifecycleHttpStore;
  models: ModelRegistry;
}

export function registerPlanLifecycleHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  registerPlanListAndCreateHttp(app, services);
  registerPlanReplanHttp(app, services);
  registerPlanReplanReviewHttp(app, services);
  registerPlanExportHttp(app, services);
  registerPlanVerificationHttp(app, services);
}

function registerPlanListAndCreateHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  app.get("/api/threads/:threadId/plans", (context) => {
    const threadId = context.req.param("threadId");
    services.store.getThread(threadId);
    const plans = services.store.listPlans(threadId);
    setExecutionPlanListHeaders(context, threadId, plans);
    return context.json(plans);
  });

  app.post("/api/threads/:threadId/plans", async (context) => {
    const threadId = context.req.param("threadId");
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        128 * 1024,
        "Execution plan request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Execution plan request is invalid", 400);
    }
    const body = parseCreateExecutionPlanRequest(input);
    if (!body) {
      return jsonError(context, "Execution plan request is invalid", 400);
    }
    const plan = await services.store.createPlan(threadId, body);
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: {
        planId: plan.id,
        objective: plan.objective,
        status: plan.status,
        stepCount: plan.steps.length,
        artifactCount: plan.artifacts.length,
        criticalPathStepIds: plan.criticalPathStepIds,
        readyStepIds: plan.readyStepIds,
        blockedStepIds: plan.blockedStepIds,
      },
    });
    setExecutionPlanHeaders(context, plan);
    return context.json(plan, 201);
  });
}

function registerPlanReplanHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  app.post("/api/threads/:threadId/plans/:planId/replan", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services.store, planId, threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        64 * 1024,
        "Plan replan request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(context, "Plan replan request is invalid", 400);
    }
    const body = parseReplanExecutionPlanRequest(input);
    if (!body) {
      return jsonError(context, "Plan replan request is invalid", 400);
    }
    const before = services.store.getPlan(planId);
    const plan = await services.store.replanPlan(planId, body);
    const replan = plan.replans.at(-1);
    if (plan.revision !== before.revision && replan) {
      await services.store.appendEvent({
        threadId,
        runId: createId("runctl"),
        type: "plan.replanned",
        category: "plan",
        visibility: "user",
        payload: {
          planId,
          replanId: replan.id,
          strategy: replan.strategy,
          fromRevision: replan.fromRevision,
          toRevision: replan.toRevision,
          replanSha256: replan.replanSha256,
          addedStepIds: replan.addedStepIds,
          addedArtifactIds: replan.addedArtifactIds,
          supersededStepIds: replan.supersededStepIds,
          supersededArtifactIds: replan.supersededArtifactIds,
          dependencyUpdatedStepIds: replan.dependencyUpdatedStepIds,
          addedStepsSha256: replan.addedStepsSha256,
          addedArtifactsSha256: replan.addedArtifactsSha256,
          dependencyUpdatesSha256: replan.dependencyUpdatesSha256,
          status: plan.status,
          criticalPathStepIds: plan.criticalPathStepIds,
          readyStepIds: plan.readyStepIds,
          blockedStepIds: plan.blockedStepIds,
        },
      });
    }
    setExecutionPlanHeaders(context, plan);
    return context.json(plan);
  });
}

function registerPlanReplanReviewHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/replan-draft-review",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services.store, planId, threadId);
      const plan = services.store.getPlan(planId);
      let input: unknown;
      try {
        input = await readOptionalLimitedJson(
          context.req.raw,
          8 * 1024,
          "Plan replan draft review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Plan replan draft review request is invalid",
          400,
        );
      }
      const body = parseReviewExecutionPlanReplanDraftRequest(input);
      if (!body) {
        return jsonError(
          context,
          "Plan replan draft review request is invalid",
          400,
        );
      }
      if (!plan.replanRecommendation) {
        return jsonError(
          context,
          "Plan has no active replan recommendation",
          409,
        );
      }
      const thread = services.store.getThread(threadId);
      const agent = services.store.getAgent(thread.agentId);
      const model = body.model ?? agent.model;
      try {
        await assertAvailableModel(services, model);
        const review = await reviewExecutionPlanReplanDraft(
          services.models,
          plan,
          model,
        );
        setExecutionPlanReplanDraftReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerPlanExportHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  app.get("/api/threads/:threadId/plans/:planId/archive", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services.store, planId, threadId);
    const archive = await createExecutionPlanArchive(
      services.store,
      threadId,
      planId,
    );
    setExecutionPlanArchiveHeaders(context, archive);
    return context.json(archive);
  });

  app.get("/api/threads/:threadId/plans/:planId/blueprint", async (context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    assertPlanThread(services.store, planId, threadId);
    const blueprint = await createExecutionPlanBlueprint(
      services.store,
      threadId,
      planId,
    );
    setExecutionPlanBlueprintHeaders(context, blueprint);
    return context.json(blueprint);
  });
}

function registerPlanVerificationHttp(
  app: Hono,
  services: PlanLifecycleHttpServices,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/archive/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const planId = context.req.param("planId");
      assertPlanThread(services.store, planId, threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_ARCHIVE_BYTES,
          "Execution plan archive verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan archive verification request is invalid",
          400,
        );
      }
      const request = parseVerifyExecutionPlanArchiveRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan archive verification request is invalid",
          400,
        );
      }
      const verification = bindExecutionPlanArchiveVerification(
        verifyExecutionPlanArchive(request.archive),
        threadId,
        planId,
      );
      setExecutionPlanArchiveVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.post(
    "/api/threads/:threadId/plans/blueprints/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      services.store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint verification request is invalid",
          400,
        );
      }
      const request = parseVerifyExecutionPlanBlueprintRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint verification request is invalid",
          400,
        );
      }
      const verification = verifyExecutionPlanBlueprint(request.blueprint);
      setExecutionPlanBlueprintVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );
}

function assertPlanThread(
  store: PlanLifecycleHttpStore,
  planId: string,
  threadId: string,
): void {
  const plan = store.getPlan(planId);
  if (plan.threadId !== threadId) {
    throw new Error(`Plan not found in thread: ${planId}`);
  }
}

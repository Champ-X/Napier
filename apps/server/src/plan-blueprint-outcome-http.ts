import {
  type LocalStore,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
  type ModelRegistry,
  reviewExecutionPlanBlueprintRecordOutcomes,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import { assertAvailableModel } from "./model-http-availability.js";
import {
  setExecutionPlanBlueprintRecordOutcomeBaselineListHeaders,
  setExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders,
  setExecutionPlanBlueprintRecordOutcomeQualificationHeaders,
  setExecutionPlanBlueprintRecordOutcomeReviewHeaders,
} from "./plan-blueprint-outcome-http-response.js";
import {
  parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  parseReviewExecutionPlanBlueprintRecordOutcomesRequest,
} from "./plan-blueprint-outcome-http-validation.js";

const MAX_BLUEPRINT_OUTCOME_REVIEW_REQUEST_BYTES = 64 * 1024;

export type PlanBlueprintOutcomeHttpStore = Pick<
  LocalStore,
  | "getExecutionPlanBlueprintRecord"
  | "getExecutionPlanBlueprintRecordReplayOutcomes"
  | "listExecutionPlanBlueprintRecordOutcomeBaselines"
  | "promoteExecutionPlanBlueprintRecordOutcomeBaseline"
  | "qualifyExecutionPlanBlueprintRecord"
  | "qualifyExecutionPlanBlueprintRecordOutcomes"
>;

export interface PlanBlueprintOutcomeHttpServices {
  store: PlanBlueprintOutcomeHttpStore;
  models: ModelRegistry;
}

export function registerPlanBlueprintOutcomeHttp(
  app: Hono,
  services: PlanBlueprintOutcomeHttpServices,
): void {
  registerOutcomeReviewHttp(app, services);
  registerOutcomeBaselineHttp(app, services.store);
  registerOutcomeQualificationHttp(app, services.store);
}

function registerOutcomeReviewHttp(
  app: Hono,
  services: PlanBlueprintOutcomeHttpServices,
): void {
  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/review",
    async (context) => {
      const recordId = context.req.param("recordId");
      services.store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_BLUEPRINT_OUTCOME_REVIEW_REQUEST_BYTES,
          "Execution plan blueprint outcome review request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint outcome review request is invalid",
          400,
        );
      }
      const request =
        parseReviewExecutionPlanBlueprintRecordOutcomesRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint outcome review request is invalid",
          400,
        );
      }
      try {
        await assertAvailableModel(services, request.model);
        const review = await reviewExecutionPlanBlueprintRecordOutcomes(
          services.store,
          services.models,
          recordId,
          request,
        );
        setExecutionPlanBlueprintRecordOutcomeReviewHeaders(context, review);
        return context.json(review);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerOutcomeBaselineHttp(
  app: Hono,
  store: PlanBlueprintOutcomeHttpStore,
): void {
  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes/baselines",
    (context) => {
      const baselines = store.listExecutionPlanBlueprintRecordOutcomeBaselines(
        context.req.param("recordId"),
      );
      setExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
        context,
        baselines,
      );
      return context.json(baselines);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/baselines",
    async (context) => {
      const recordId = context.req.param("recordId");
      store.getExecutionPlanBlueprintRecord(recordId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint outcome baseline request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint outcome baseline request is invalid",
          400,
        );
      }
      const request =
        parsePromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint outcome baseline request is invalid",
          400,
        );
      }
      try {
        const result =
          await store.promoteExecutionPlanBlueprintRecordOutcomeBaseline(
            recordId,
            request,
          );
        setExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
          context,
          result,
        );
        return context.json(result, result.created ? 201 : 200);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Execution plan blueprint outcome baseline")
        ) {
          return jsonError(context, error.message, 409);
        }
        throw error;
      }
    },
  );
}

function registerOutcomeQualificationHttp(
  app: Hono,
  store: PlanBlueprintOutcomeHttpStore,
): void {
  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes/qualification",
    async (context) => {
      const qualification =
        await store.qualifyExecutionPlanBlueprintRecordOutcomes(
          context.req.param("recordId"),
        );
      setExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
        context,
        qualification,
      );
      return context.json(qualification);
    },
  );
}

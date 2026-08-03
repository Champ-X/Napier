import {
  createId,
  type LocalStore,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  setExecutionPlanBlueprintRecordHeaders,
  setExecutionPlanBlueprintRecordListHeaders,
  setExecutionPlanBlueprintRecordQualificationHeaders,
  setExecutionPlanBlueprintRecordSelectionHeaders,
  setExecutionPlanBlueprintSaveResultHeaders,
} from "./plan-blueprint-library-http-response.js";
import {
  parseSaveExecutionPlanBlueprintRequest,
  parseSelectExecutionPlanBlueprintRecordRequest,
  parseSetExecutionPlanBlueprintRecordStatusRequest,
} from "./plan-blueprint-library-http-validation.js";

export type PlanBlueprintLibraryHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getThread"
  | "listExecutionPlanBlueprints"
  | "qualifyExecutionPlanBlueprintRecord"
  | "saveExecutionPlanBlueprint"
  | "selectExecutionPlanBlueprintRecord"
  | "setExecutionPlanBlueprintRecordStatus"
>;

export function registerPlanBlueprintLibraryHttp(
  app: Hono,
  store: PlanBlueprintLibraryHttpStore,
): void {
  registerPlanBlueprintCatalogHttp(app, store);
  registerPlanBlueprintSaveHttp(app, store);
  registerPlanBlueprintSelectionHttp(app, store);
  registerPlanBlueprintStatusHttp(app, store);
}

function registerPlanBlueprintCatalogHttp(
  app: Hono,
  store: PlanBlueprintLibraryHttpStore,
): void {
  app.get("/api/plan-blueprints", (context) => {
    const status = context.req.query("status");
    if (status !== undefined && status !== "active" && status !== "archived") {
      return jsonError(
        context,
        "Execution plan blueprint status is invalid",
        400,
      );
    }
    const records = store.listExecutionPlanBlueprints(status);
    setExecutionPlanBlueprintRecordListHeaders(context, records);
    return context.json(records);
  });

  app.get("/api/plan-blueprints/:recordId/qualification", async (context) => {
    const qualification = await store.qualifyExecutionPlanBlueprintRecord(
      context.req.param("recordId"),
    );
    setExecutionPlanBlueprintRecordQualificationHeaders(context, qualification);
    return context.json(qualification);
  });
}

function registerPlanBlueprintSaveHttp(
  app: Hono,
  store: PlanBlueprintLibraryHttpStore,
): void {
  app.post("/api/threads/:threadId/plan-blueprints", async (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
        "Execution plan blueprint save request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint save request is invalid",
        400,
      );
    }
    const request = parseSaveExecutionPlanBlueprintRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint save request is invalid",
        400,
      );
    }
    try {
      const result = await store.saveExecutionPlanBlueprint(threadId, request);
      await store.appendEvent({
        threadId,
        runId: createId("runctl"),
        type: result.created ? "plan.blueprint.saved" : "plan.blueprint.reused",
        category: "plan",
        visibility: "user",
        payload: {
          blueprintRecordId: result.record.id,
          blueprintSha256: result.record.blueprintSha256,
          sourcePlanId: result.record.sourcePlanId,
          sourcePlanRevision: result.record.sourcePlanRevision,
          sourcePlanArchiveSha256: result.record.sourcePlanArchiveSha256,
          created: result.created,
        },
      });
      setExecutionPlanBlueprintSaveResultHeaders(context, result);
      return context.json(result, result.created ? 201 : 200);
    } catch (error) {
      return jsonError(context, errorMessage(error), 400);
    }
  });
}

function registerPlanBlueprintSelectionHttp(
  app: Hono,
  store: PlanBlueprintLibraryHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plan-blueprints/selection",
    async (context) => {
      const threadId = context.req.param("threadId");
      store.getThread(threadId);
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
          "Execution plan blueprint selection request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          "Execution plan blueprint selection request is invalid",
          400,
        );
      }
      const request = parseSelectExecutionPlanBlueprintRecordRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Execution plan blueprint selection request is invalid",
          400,
        );
      }
      try {
        const selection = await store.selectExecutionPlanBlueprintRecord(
          threadId,
          request,
        );
        setExecutionPlanBlueprintRecordSelectionHeaders(context, selection);
        return context.json(selection);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Execution plan blueprint selection")
        ) {
          return jsonError(context, error.message, 400);
        }
        throw error;
      }
    },
  );
}

function registerPlanBlueprintStatusHttp(
  app: Hono,
  store: PlanBlueprintLibraryHttpStore,
): void {
  app.post("/api/plan-blueprints/:recordId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        8 * 1024,
        "Execution plan blueprint status request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint status request is invalid",
        400,
      );
    }
    const request = parseSetExecutionPlanBlueprintRecordStatusRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint status request is invalid",
        400,
      );
    }
    const record = await store.setExecutionPlanBlueprintRecordStatus(
      context.req.param("recordId"),
      request,
    );
    setExecutionPlanBlueprintRecordHeaders(context, record);
    return context.json(record);
  });
}

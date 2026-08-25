import {
  createId,
} from "@napier/runtime/core";
import {
  executionPlanRequestFromBlueprint,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
  verifyExecutionPlanBlueprint,
} from "@napier/runtime/workflow";
import {
  type LocalStore,
} from "@napier/runtime/store";
import { Hono, type Context } from "hono";

import { jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  setExecutionPlanBlueprintRecordPreviewHeaders,
  setExecutionPlanFromBlueprintHeaders,
  setExecutionPlanFromBlueprintRecordHeaders,
} from "./plan-blueprint-instantiation-http-response.js";
import {
  parseCreateExecutionPlanFromBlueprintRecordRequest,
  parseCreateExecutionPlanFromBlueprintRequest,
} from "./plan-blueprint-instantiation-http-validation.js";
import { setExecutionPlanBlueprintVerificationHeaders } from "./plan-lifecycle-http-response.js";

export type PlanBlueprintInstantiationHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createPlan"
  | "createPlanFromBlueprintRecord"
  | "getThread"
  | "previewPlanFromBlueprintRecord"
>;

export function registerPlanBlueprintInstantiationHttp(
  app: Hono,
  store: PlanBlueprintInstantiationHttpStore,
): void {
  registerDirectBlueprintInstantiationHttp(app, store);
  registerBlueprintRecordPreviewHttp(app, store);
  registerBlueprintRecordInstantiationHttp(app, store);
}

function registerDirectBlueprintInstantiationHttp(
  app: Hono,
  store: PlanBlueprintInstantiationHttpStore,
): void {
  app.post("/api/threads/:threadId/plans/from-blueprint", async (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
        "Execution plan blueprint request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        "Execution plan blueprint request is invalid",
        400,
      );
    }
    const request = parseCreateExecutionPlanFromBlueprintRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Execution plan blueprint request is invalid",
        400,
      );
    }
    const verification = verifyExecutionPlanBlueprint(request.blueprint);
    if (verification.status !== "valid") {
      setExecutionPlanBlueprintVerificationHeaders(context, verification);
      return context.json(verification, 400);
    }
    const planRequest = executionPlanRequestFromBlueprint(
      request.blueprint,
      request.objective,
    );
    const plan = await store.createPlan(threadId, planRequest);
    await store.appendEvent({
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
        blueprintSha256: request.blueprint.contentSha256,
        blueprintSourcePlanId: request.blueprint.source.planId,
        blueprintSourcePlanRevision: request.blueprint.source.planRevision,
        blueprintSourceArchiveSha256:
          request.blueprint.source.planArchiveSha256,
      },
    });
    setExecutionPlanFromBlueprintHeaders(context, plan, request.blueprint);
    return context.json(plan, 201);
  });
}

function registerBlueprintRecordPreviewHttp(
  app: Hono,
  store: PlanBlueprintInstantiationHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/from-blueprint-record/preview",
    async (context) => {
      const threadId = context.req.param("threadId");
      store.getThread(threadId);
      const request = await readBlueprintRecordRequest(
        context,
        "Execution plan blueprint record preview request",
      );
      if (request instanceof Response) return request;
      const preview = await store.previewPlanFromBlueprintRecord(
        threadId,
        request,
      );
      setExecutionPlanBlueprintRecordPreviewHeaders(context, preview);
      return context.json(preview);
    },
  );
}

function registerBlueprintRecordInstantiationHttp(
  app: Hono,
  store: PlanBlueprintInstantiationHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/from-blueprint-record",
    async (context) => {
      const threadId = context.req.param("threadId");
      store.getThread(threadId);
      const request = await readBlueprintRecordRequest(
        context,
        "Execution plan blueprint record request",
      );
      if (request instanceof Response) return request;
      const preview = await store.previewPlanFromBlueprintRecord(
        threadId,
        request,
      );
      if (
        preview.status !== "ready" ||
        (request.expectedPreviewSha256 !== undefined &&
          request.expectedPreviewSha256 !== preview.previewSha256)
      ) {
        setExecutionPlanBlueprintRecordPreviewHeaders(context, preview);
        return context.json(preview, 409);
      }
      const { plan, record, qualification, event, previewSha256 } =
        await store.createPlanFromBlueprintRecord(threadId, request);
      setExecutionPlanFromBlueprintRecordHeaders(
        context,
        plan,
        record,
        qualification,
        previewSha256,
        event,
      );
      return context.json(plan, 201);
    },
  );
}

async function readBlueprintRecordRequest(context: Context, label: string) {
  let input: unknown;
  try {
    input = await readLimitedJson(context.req.raw, 16 * 1024, label);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(context, error.message, 413);
    }
    return jsonError(context, `${label} is invalid`, 400);
  }
  const request = parseCreateExecutionPlanFromBlueprintRecordRequest(input);
  return request ?? jsonError(context, `${label} is invalid`, 400);
}

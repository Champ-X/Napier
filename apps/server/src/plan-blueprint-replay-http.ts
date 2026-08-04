import {
  type LocalStore,
  MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
} from "@napier/runtime";
import { Hono, type Context } from "hono";

import { jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  setExecutionPlanBlueprintRecordReplayEventVerificationHeaders,
  setExecutionPlanBlueprintRecordReplayHistoryHeaders,
  setExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders,
  setExecutionPlanBlueprintRecordReplayOutcomesHeaders,
  setExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders,
} from "./plan-blueprint-replay-http-response.js";
import {
  parseVerifyExecutionPlanBlueprintRecordReplayEventRequest,
  parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
} from "./plan-blueprint-replay-http-validation.js";

export type PlanBlueprintReplayHttpStore = Pick<
  LocalStore,
  | "getExecutionPlanBlueprintRecord"
  | "getExecutionPlanBlueprintRecordReplayHistory"
  | "getExecutionPlanBlueprintRecordReplayOutcomes"
  | "verifyExecutionPlanBlueprintRecordReplayEvent"
  | "verifyExecutionPlanBlueprintRecordReplayHistory"
  | "verifyExecutionPlanBlueprintRecordReplayOutcomes"
>;

export function registerPlanBlueprintReplayHttp(
  app: Hono,
  store: PlanBlueprintReplayHttpStore,
): void {
  registerReplayHistoryHttp(app, store);
  registerReplayOutcomesHttp(app, store);
  registerReplayEventVerificationHttp(app, store);
}

function registerReplayHistoryHttp(
  app: Hono,
  store: PlanBlueprintReplayHttpStore,
): void {
  app.get("/api/plan-blueprints/:recordId/replays", async (context) => {
    const history = await store.getExecutionPlanBlueprintRecordReplayHistory(
      context.req.param("recordId"),
    );
    setExecutionPlanBlueprintRecordReplayHistoryHeaders(context, history);
    return context.json(history);
  });

  app.post("/api/plan-blueprints/:recordId/replays/verify", async (context) => {
    const recordId = context.req.param("recordId");
    store.getExecutionPlanBlueprintRecord(recordId);
    const request = await readVerificationRequest(
      context,
      "Execution plan blueprint replay history verification request",
      parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
    );
    if (request instanceof Response) return request;
    const verification =
      await store.verifyExecutionPlanBlueprintRecordReplayHistory(
        recordId,
        request.history,
      );
    setExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
      context,
      verification,
    );
    return context.json(verification);
  });
}

function registerReplayOutcomesHttp(
  app: Hono,
  store: PlanBlueprintReplayHttpStore,
): void {
  app.get(
    "/api/plan-blueprints/:recordId/replays/outcomes",
    async (context) => {
      const outcomes =
        await store.getExecutionPlanBlueprintRecordReplayOutcomes(
          context.req.param("recordId"),
        );
      setExecutionPlanBlueprintRecordReplayOutcomesHeaders(context, outcomes);
      return context.json(outcomes);
    },
  );

  app.post(
    "/api/plan-blueprints/:recordId/replays/outcomes/verify",
    async (context) => {
      const recordId = context.req.param("recordId");
      store.getExecutionPlanBlueprintRecord(recordId);
      const request = await readVerificationRequest(
        context,
        "Execution plan blueprint replay outcomes verification request",
        parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
      );
      if (request instanceof Response) return request;
      const verification =
        await store.verifyExecutionPlanBlueprintRecordReplayOutcomes(
          recordId,
          request.outcomes,
        );
      setExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );
}

function registerReplayEventVerificationHttp(
  app: Hono,
  store: PlanBlueprintReplayHttpStore,
): void {
  app.post(
    "/api/plan-blueprints/:recordId/replays/events/verify",
    async (context) => {
      const recordId = context.req.param("recordId");
      store.getExecutionPlanBlueprintRecord(recordId);
      const request = await readVerificationRequest(
        context,
        "Execution plan blueprint replay event verification request",
        parseVerifyExecutionPlanBlueprintRecordReplayEventRequest,
      );
      if (request instanceof Response) return request;
      const verification =
        await store.verifyExecutionPlanBlueprintRecordReplayEvent(
          recordId,
          request,
        );
      setExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
        context,
        verification,
      );
      return context.json(verification);
    },
  );
}

async function readVerificationRequest<T>(
  context: Context,
  label: string,
  parse: (input: unknown) => T | undefined,
): Promise<T | Response> {
  let input: unknown;
  try {
    input = await readLimitedJson(
      context.req.raw,
      MAX_EXECUTION_PLAN_BLUEPRINT_BYTES,
      label,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(context, error.message, 413);
    }
    return jsonError(context, `${label} is invalid`, 400);
  }
  return parse(input) ?? jsonError(context, `${label} is invalid`, 400);
}

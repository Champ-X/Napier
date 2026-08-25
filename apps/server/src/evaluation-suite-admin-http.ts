import type { Context, Hono } from "hono";

import type { EvaluationSuite, JsonValue } from "@napier/contracts";
import {
  createId,
} from "@napier/runtime/core";
import {
  type EvaluationSuiteService,
} from "@napier/runtime/evaluation";
import {
  type LocalStore,
} from "@napier/runtime/store";
import {
  type ModelRegistry,
} from "@napier/runtime/model";

import {
  setEvaluationSuiteExecutionHeaders,
  setEvaluationSuiteProjectionHeaders,
} from "./evaluation-admin-http-response.js";
import {
  parseCreateEvaluationSuiteRequest,
  parseUpdateEvaluationSuiteRequest,
} from "./evaluation-http-validation.js";
import { assertAvailableModel } from "./model-http-availability.js";

export type EvaluationSuiteAdminStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createEvaluationSuite"
  | "getEvaluationSuite"
  | "updateEvaluationSuite"
>;

export interface EvaluationSuiteAdminHttpServices {
  store: EvaluationSuiteAdminStore;
  models: ModelRegistry;
  suites: Pick<EvaluationSuiteService, "execute">;
}

export interface EvaluationSuiteAdminHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(context: Context, message: string, status: 400 | 413): Response;
}

export function registerEvaluationSuiteAdminHttp(
  app: Hono,
  services: EvaluationSuiteAdminHttpServices,
  adapter: EvaluationSuiteAdminHttpAdapter,
): void {
  app.post("/api/threads/:threadId/evaluation-suites", async (context) => {
    const threadId = context.req.param("threadId");
    const body = await readBody(
      context,
      "Evaluation suite request",
      parseCreateEvaluationSuiteRequest,
      "Evaluation suite request is invalid",
      adapter,
    );
    if (body instanceof Response) return body;
    try {
      if (body.model) await assertAvailableModel(services, body.model);
    } catch (error) {
      return adapter.jsonError(context, adapter.errorMessage(error), 400);
    }
    const suite = await services.store.createEvaluationSuite(threadId, body);
    await appendSuiteEvent(
      services.store,
      threadId,
      "evaluation.suite.created",
      suite,
    );
    setEvaluationSuiteProjectionHeaders(context, suite);
    return context.json(suite, 201);
  });

  app.put(
    "/api/threads/:threadId/evaluation-suites/:suiteId",
    async (context) => {
      const threadId = context.req.param("threadId");
      const current = services.store.getEvaluationSuite(
        context.req.param("suiteId"),
      );
      if (current.threadId !== threadId) {
        throw new Error(
          "Evaluation suite does not belong to the target thread",
        );
      }
      const body = await readBody(
        context,
        "Evaluation suite update request",
        parseUpdateEvaluationSuiteRequest,
        "Evaluation suite update request is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      try {
        if (body.model) await assertAvailableModel(services, body.model);
      } catch (error) {
        return adapter.jsonError(context, adapter.errorMessage(error), 400);
      }
      const suite = await services.store.updateEvaluationSuite(
        current.id,
        body,
      );
      if (suite.revision !== current.revision) {
        await appendSuiteEvent(
          services.store,
          threadId,
          "evaluation.suite.updated",
          suite,
        );
      }
      setEvaluationSuiteProjectionHeaders(context, suite);
      return context.json(suite);
    },
  );

  app.post(
    "/api/threads/:threadId/evaluation-suites/:suiteId/executions",
    async (context) => {
      const threadId = context.req.param("threadId");
      const suiteId = context.req.param("suiteId");
      const suite = services.store.getEvaluationSuite(suiteId);
      if (suite.threadId !== threadId) {
        return adapter.jsonError(
          context,
          "Evaluation suite does not belong to the target thread",
          400,
        );
      }
      try {
        await assertAvailableModel(services, suite.evaluatorModel);
      } catch (error) {
        return adapter.jsonError(context, adapter.errorMessage(error), 400);
      }
      const execution = await services.suites.execute(threadId, suiteId);
      setEvaluationSuiteExecutionHeaders(context, execution);
      return context.json(execution, 201);
    },
  );
}

async function readBody<T>(
  context: Context,
  label: string,
  parse: (input: unknown) => T | undefined,
  invalidMessage: string,
  adapter: EvaluationSuiteAdminHttpAdapter,
): Promise<T | Response> {
  let input: unknown;
  try {
    input = await adapter.readRequest(context.req.raw, label);
  } catch (error) {
    return adapter.jsonError(
      context,
      adapter.errorMessage(error),
      adapter.requestBodyTooLarge(error) ? 413 : 400,
    );
  }
  return parse(input) ?? adapter.jsonError(context, invalidMessage, 400);
}

async function appendSuiteEvent(
  store: EvaluationSuiteAdminStore,
  threadId: string,
  type: string,
  suite: EvaluationSuite,
): Promise<void> {
  await store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "evaluation",
    visibility: "user",
    payload: evaluationSuiteEventPayload(suite),
  });
}

function evaluationSuiteEventPayload(
  suite: EvaluationSuite,
): Record<string, JsonValue> {
  return {
    suiteId: suite.id,
    name: suite.name,
    revision: suite.revision,
    baselineRunId: suite.baselineRunId,
    candidateRunIds: suite.candidateRunIds,
    rubric: suite.rubric.name,
    evaluatorModel: {
      provider: suite.evaluatorModel.provider,
      id: suite.evaluatorModel.id,
    },
    gate: {
      minimumPassRate: suite.gate.minimumPassRate,
      minimumCandidateScore: suite.gate.minimumCandidateScore,
      allowInconclusive: suite.gate.allowInconclusive,
    },
  };
}

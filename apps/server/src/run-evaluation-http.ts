import type { Context, Hono } from "hono";

import {
  type LocalStore,
  type ModelRegistry,
  type RunEvaluationService,
} from "@napier/runtime";

import { parseCreateRunEvaluationRequest } from "./evaluation-http-validation.js";
import { assertAvailableModel } from "./model-http-availability.js";
import { setRunEvaluationRecordHeaders } from "./thread-evaluation-http-response.js";

export type RunEvaluationHttpStore = Pick<LocalStore, "getAgent" | "getThread">;

export interface RunEvaluationHttpServices {
  store: RunEvaluationHttpStore;
  models: ModelRegistry;
  evaluations: Pick<RunEvaluationService, "evaluate">;
}

export interface RunEvaluationHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(context: Context, message: string, status: 400 | 413): Response;
}

export function registerRunEvaluationHttp(
  app: Hono,
  services: RunEvaluationHttpServices,
  adapter: RunEvaluationHttpAdapter,
): void {
  app.post("/api/threads/:threadId/evaluations", async (context) => {
    let input: unknown;
    try {
      input = await adapter.readRequest(
        context.req.raw,
        "Run evaluation request",
      );
    } catch (error) {
      return adapter.jsonError(
        context,
        adapter.errorMessage(error),
        adapter.requestBodyTooLarge(error) ? 413 : 400,
      );
    }
    const body = parseCreateRunEvaluationRequest(input);
    if (!body) {
      return adapter.jsonError(
        context,
        "Run evaluation request is invalid",
        400,
      );
    }
    const threadId = context.req.param("threadId");
    const thread = services.store.getThread(threadId);
    const agent = services.store.getAgent(thread.agentId);
    try {
      await assertAvailableModel(services, body.model ?? agent.model);
    } catch (error) {
      return adapter.jsonError(context, adapter.errorMessage(error), 400);
    }
    const evaluation = await services.evaluations.evaluate(threadId, body);
    setRunEvaluationRecordHeaders(context, evaluation);
    return context.json(evaluation, 201);
  });
}

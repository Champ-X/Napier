import type { Context, Hono } from "hono";

import type { EvaluationCasebook, JsonValue } from "@napier/contracts";
import {
  createId,
  type EvaluationCasebookQualificationService,
  type LocalStore,
  type ModelRegistry,
} from "@napier/runtime";

import {
  setEvaluationCasebookProjectionHeaders,
  setEvaluationCasebookQualificationExecutionHeaders,
} from "./evaluation-admin-http-response.js";
import {
  parseCreateEvaluationCasebookRequest,
  parseCurateEvaluationCaseRequest,
  parseExecuteEvaluationCasebookRequest,
  parseRemoveEvaluationCaseRequest,
  parseUpdateEvaluationCasebookRequest,
} from "./evaluation-casebook-http-validation.js";
import { assertAvailableModel } from "./model-http-availability.js";

export type EvaluationCasebookAdminStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createEvaluationCasebook"
  | "curateEvaluationCasebookCase"
  | "getEvaluationCasebook"
  | "removeEvaluationCasebookCase"
  | "updateEvaluationCasebook"
>;

export interface EvaluationCasebookAdminHttpServices {
  store: EvaluationCasebookAdminStore;
  models: ModelRegistry;
  qualifications: Pick<EvaluationCasebookQualificationService, "execute">;
}

export interface EvaluationCasebookAdminHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(
    context: Context,
    message: string,
    status: 400 | 409 | 413,
  ): Response;
}

export function registerEvaluationCasebookAdminHttp(
  app: Hono,
  services: EvaluationCasebookAdminHttpServices,
  adapter: EvaluationCasebookAdminHttpAdapter,
): void {
  app.post("/api/evaluation-casebooks", async (context) => {
    const body = await readBody(
      context,
      "Evaluation casebook request",
      parseCreateEvaluationCasebookRequest,
      "Casebook request is invalid",
      adapter,
    );
    if (body instanceof Response) return body;
    const casebook = await services.store.createEvaluationCasebook(body);
    await appendCasebookEvent(
      services.store,
      body.threadId,
      "evaluation.casebook.created",
      casebook,
    );
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(casebook, 201);
  });

  app.put("/api/evaluation-casebooks/:casebookId", async (context) => {
    const body = await readBody(
      context,
      "Evaluation casebook update request",
      parseUpdateEvaluationCasebookRequest,
      "Casebook update is invalid",
      adapter,
    );
    if (body instanceof Response) return body;
    const before = services.store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    const casebook = await services.store.updateEvaluationCasebook(
      before.id,
      body,
    );
    if (casebook.currentRevision !== before.currentRevision) {
      await appendCasebookEvent(
        services.store,
        body.threadId,
        "evaluation.casebook.updated",
        casebook,
      );
    }
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(casebook);
  });

  app.post("/api/evaluation-casebooks/:casebookId/cases", async (context) => {
    const body = await readBody(
      context,
      "Evaluation casebook curation request",
      parseCurateEvaluationCaseRequest,
      "Casebook curation is invalid",
      adapter,
    );
    if (body instanceof Response) return body;
    const before = services.store.getEvaluationCasebook(
      context.req.param("casebookId"),
    );
    const casebook = await services.store.curateEvaluationCasebookCase(
      before.id,
      body,
    );
    const changed = casebook.currentRevision !== before.currentRevision;
    const revision = casebook.revisions.at(-1);
    if (changed && revision) {
      await appendCasebookEvent(
        services.store,
        body.threadId,
        revision.source === "case_refreshed"
          ? "evaluation.casebook.case.refreshed"
          : "evaluation.casebook.case.curated",
        casebook,
      );
    }
    setEvaluationCasebookProjectionHeaders(context, casebook);
    return context.json(
      casebook,
      changed && revision?.source === "case_curated" ? 201 : 200,
    );
  });

  app.post(
    "/api/evaluation-casebooks/:casebookId/cases/:caseId/remove",
    async (context) => {
      const body = await readBody(
        context,
        "Evaluation casebook removal request",
        parseRemoveEvaluationCaseRequest,
        "Casebook removal is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      const casebook = await services.store.removeEvaluationCasebookCase(
        context.req.param("casebookId"),
        context.req.param("caseId"),
        body,
      );
      await appendCasebookEvent(
        services.store,
        body.threadId,
        "evaluation.casebook.case.removed",
        casebook,
      );
      setEvaluationCasebookProjectionHeaders(context, casebook);
      return context.json(casebook);
    },
  );

  app.post(
    "/api/evaluation-casebooks/:casebookId/qualifications",
    async (context) => {
      const body = await readBody(
        context,
        "Evaluation casebook qualification request",
        parseExecuteEvaluationCasebookRequest,
        "Casebook qualification request is invalid",
        adapter,
      );
      if (body instanceof Response) return body;
      try {
        await assertAvailableModel(services, body.model);
        const execution = await services.qualifications.execute(
          context.req.param("casebookId"),
          body,
        );
        setEvaluationCasebookQualificationExecutionHeaders(context, execution);
        return context.json(execution, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("changed during qualification")
        ) {
          return adapter.jsonError(context, error.message, 409);
        }
        throw error;
      }
    },
  );
}

async function readBody<T>(
  context: Context,
  label: string,
  parse: (input: unknown) => T | undefined,
  invalidMessage: string,
  adapter: EvaluationCasebookAdminHttpAdapter,
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

async function appendCasebookEvent(
  store: EvaluationCasebookAdminStore,
  threadId: string,
  type: string,
  casebook: EvaluationCasebook,
): Promise<void> {
  await store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "evaluation",
    visibility: "user",
    payload: evaluationCasebookEventPayload(casebook),
  });
}

function evaluationCasebookEventPayload(
  casebook: EvaluationCasebook,
): Record<string, JsonValue> {
  const revision = casebook.revisions.at(-1)!;
  return {
    casebookId: casebook.id,
    name: revision.name,
    revision: revision.revision,
    source: revision.source,
    caseCount: revision.caseIds.length,
    contentSha256: revision.contentSha256,
    ...(revision.caseId ? { caseId: revision.caseId } : {}),
    ...(revision.sourceEvaluationId
      ? { sourceEvaluationId: revision.sourceEvaluationId }
      : {}),
  };
}

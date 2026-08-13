import type { Context, Hono } from "hono";

import type { JsonValue } from "@napier/contracts";
import type {
  CreateReleaseProductTrialRequest,
  ReleaseProductGateProjection,
  ReleaseProductTrial,
} from "@napier/contracts/release-product-trial";
import type { LocalStore } from "@napier/runtime";
import {
  createReleaseProductTrial,
  NAPIER_PRODUCT_VERSION,
  parseReleaseProductTrial,
  projectReleaseProductGate,
  RELEASE_PRODUCT_TRIAL_EVENT_TYPE,
} from "@napier/runtime/release-product-gate";

import { setBodyContentSha256Header } from "./http-response-evidence.js";

export type ReleaseProductTrialStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getEvaluationCasebook"
  | "getThread"
  | "listEvents"
  | "listRuns"
  | "listThreads"
>;

export interface ReleaseProductTrialHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(
    context: Context,
    message: string,
    status: 400 | 409 | 413,
  ): Response;
}

export function registerReleaseProductTrialHttp(
  app: Hono,
  store: ReleaseProductTrialStore,
  adapter: ReleaseProductTrialHttpAdapter,
): void {
  app.get("/api/threads/:threadId/release-product-gate", async (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const casebookId = context.req.query("casebookId");
    if (!casebookId)
      return adapter.jsonError(
        context,
        "Release Product Casebook is required",
        400,
      );
    const projection = await loadProjection(store, casebookId);
    setReleaseProductGateHeaders(context, projection);
    return context.json(projection);
  });

  app.post("/api/threads/:threadId/release-product-trials", async (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    let input: unknown;
    try {
      input = await adapter.readRequest(
        context.req.raw,
        "Release Product Trial request",
      );
    } catch (error) {
      return adapter.jsonError(
        context,
        adapter.errorMessage(error),
        adapter.requestBodyTooLarge(error) ? 413 : 400,
      );
    }
    const request = parseCreateReleaseProductTrialRequest(input);
    if (!request)
      return adapter.jsonError(
        context,
        "Release Product Trial request is invalid",
        400,
      );
    const casebook = store.getEvaluationCasebook(request.casebookId);
    const run = store
      .listRuns(threadId)
      .find((candidate) => candidate.id === request.runId);
    if (!run)
      return adapter.jsonError(
        context,
        "Release Product Trial Run does not belong to this Thread",
        409,
      );
    const existing = await loadTrials(store);
    if (
      existing.some(
        (trial) =>
          trial.runId === request.runId &&
          trial.productVersion === request.productVersion,
      )
    ) {
      return adapter.jsonError(
        context,
        "This Run is already recorded for the selected product version",
        409,
      );
    }
    let trial: ReleaseProductTrial;
    try {
      trial = createReleaseProductTrial(casebook, run, request, {
        currentProductVersion: NAPIER_PRODUCT_VERSION,
      });
    } catch (error) {
      return adapter.jsonError(context, adapter.errorMessage(error), 409);
    }
    await store.appendEvent({
      threadId,
      runId: run.id,
      type: RELEASE_PRODUCT_TRIAL_EVENT_TYPE,
      category: "evaluation",
      visibility: "user",
      payload: trial as unknown as JsonValue,
    });
    const projection = projectReleaseProductGate(
      casebook,
      [...existing, trial],
      NAPIER_PRODUCT_VERSION,
    );
    const body = { trial, gate: projection };
    setReleaseProductGateHeaders(context, projection, body);
    context.header("X-Napier-Release-Product-Trial", trial.id);
    return context.json(body, 201);
  });
}

export function parseCreateReleaseProductTrialRequest(
  input: unknown,
): CreateReleaseProductTrialRequest | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const allowed = [
    "casebookId",
    "configurationInterventions",
    "failureReason",
    "humanInterventions",
    "productVersion",
    "recoveryEvents",
    "runId",
    "status",
    "templateCaseId",
    "uxScore",
  ];
  if (keys.some((key) => !allowed.includes(key))) return undefined;
  if (
    typeof value["casebookId"] !== "string" ||
    typeof value["templateCaseId"] !== "string" ||
    typeof value["runId"] !== "string" ||
    typeof value["productVersion"] !== "string" ||
    !["passed", "failed", "inconclusive"].includes(String(value["status"])) ||
    (value["failureReason"] !== undefined &&
      ![
        "task_result",
        "tool_failure",
        "configuration",
        "manual_intervention",
        "recovery_failure",
        "ux_blocker",
      ].includes(String(value["failureReason"]))) ||
    !Number.isInteger(value["configurationInterventions"]) ||
    !Number.isInteger(value["humanInterventions"]) ||
    !Number.isInteger(value["recoveryEvents"]) ||
    !Number.isInteger(value["uxScore"])
  ) {
    return undefined;
  }
  return value as unknown as CreateReleaseProductTrialRequest;
}

async function loadProjection(
  store: ReleaseProductTrialStore,
  casebookId: string,
): Promise<ReleaseProductGateProjection> {
  return projectReleaseProductGate(
    store.getEvaluationCasebook(casebookId),
    await loadTrials(store),
    NAPIER_PRODUCT_VERSION,
  );
}

async function loadTrials(
  store: ReleaseProductTrialStore,
): Promise<ReleaseProductTrial[]> {
  const events = await Promise.all(
    store.listThreads().map((thread) => store.listEvents(thread.id)),
  );
  return events
    .flat()
    .filter((event) => event.type === RELEASE_PRODUCT_TRIAL_EVENT_TYPE)
    .flatMap((event) => {
      const trial = parseReleaseProductTrial(event.payload);
      return trial ? [trial] : [];
    });
}

function setReleaseProductGateHeaders(
  context: Context,
  projection: ReleaseProductGateProjection,
  body: unknown = projection,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "X-Napier-Release-Product-Gate",
    projection.defaultTrackReady ? "passed" : "blocked",
  );
  context.header(
    "X-Napier-Release-Product-Consecutive-Versions",
    String(projection.consecutivePassingVersions.length),
  );
  setBodyContentSha256Header(context, body);
}

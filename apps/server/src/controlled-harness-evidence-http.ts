import type { Context, Hono } from "hono";

import type { JsonObject } from "@napier/contracts";
import type {
  ControlledHarnessEvidence,
  ControlledHarnessGateProjection,
} from "@napier/contracts/controlled-harness-evidence";
import { createId } from "@napier/runtime/core";
import { type LocalStore } from "@napier/runtime/store";
import {
  CONTROLLED_HARNESS_EVIDENCE_EVENT_TYPE,
  parseControlledHarnessEvidence,
  projectControlledHarnessGate,
} from "@napier/runtime/controlled-harness-evidence";
import { RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID } from "@napier/runtime/evaluation-casebook-templates";
import { NAPIER_PRODUCT_VERSION } from "@napier/runtime/release-product-gate";

import { setBodyContentSha256Header } from "./http-response-evidence.js";
import { registerReleaseProductTrialHttp } from "./release-product-trial-http.js";

export type ControlledHarnessEvidenceStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getEvaluationCasebook"
  | "getThread"
  | "listEvents"
  | "listRuns"
  | "listThreads"
>;

export interface ControlledHarnessEvidenceHttpAdapter {
  readRequest(request: Request, label: string): Promise<unknown>;
  requestBodyTooLarge(error: unknown): boolean;
  errorMessage(error: unknown): string;
  jsonError(
    context: Context,
    message: string,
    status: 400 | 409 | 413,
  ): Response;
}

export function registerReleaseEvidenceHttp(
  app: Hono,
  store: ControlledHarnessEvidenceStore,
  adapter: ControlledHarnessEvidenceHttpAdapter,
): void {
  registerReleaseProductTrialHttp(app, store, adapter);
  registerControlledHarnessEvidenceHttp(app, store, adapter);
}

export function registerControlledHarnessEvidenceHttp(
  app: Hono,
  store: ControlledHarnessEvidenceStore,
  adapter: ControlledHarnessEvidenceHttpAdapter,
): void {
  app.get("/api/threads/:threadId/controlled-harness-gate", async (context) => {
    const threadId = context.req.param("threadId");
    store.getThread(threadId);
    const casebookId = context.req.query("casebookId");
    if (!casebookId)
      return adapter.jsonError(
        context,
        "Release Product Casebook is required",
        400,
      );
    if (
      store.getEvaluationCasebook(casebookId).templateId !==
      RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID
    )
      return adapter.jsonError(
        context,
        "Controlled Harness evidence requires the fixed Release Product Casebook",
        409,
      );
    const gate = await loadGate(store, threadId, casebookId);
    setGateHeaders(context, gate);
    return context.json(gate);
  });

  app.post(
    "/api/threads/:threadId/controlled-harness-evidence",
    async (context) => {
      const threadId = context.req.param("threadId");
      store.getThread(threadId);
      let input: unknown;
      try {
        input = await adapter.readRequest(
          context.req.raw,
          "Controlled Harness evidence request",
        );
      } catch (error) {
        return adapter.jsonError(
          context,
          adapter.errorMessage(error),
          adapter.requestBodyTooLarge(error) ? 413 : 400,
        );
      }
      const request = parseRequest(input);
      if (!request)
        return adapter.jsonError(
          context,
          "Controlled Harness evidence request is invalid",
          400,
        );
      const casebook = store.getEvaluationCasebook(request.casebookId);
      if (casebook.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID)
        return adapter.jsonError(
          context,
          "Controlled Harness evidence requires the fixed Release Product Casebook",
          409,
        );
      const existing = await loadEvidence(store, threadId);
      if (
        existing.some(
          (evidence) =>
            evidence.contentSha256 === request.evidence.contentSha256,
        )
      ) {
        return adapter.jsonError(
          context,
          "This Controlled Harness evidence is already recorded",
          409,
        );
      }
      await store.appendEvent({
        threadId,
        runId: createId("runctl"),
        type: CONTROLLED_HARNESS_EVIDENCE_EVENT_TYPE,
        category: "evaluation",
        visibility: "user",
        payload: request.evidence as unknown as JsonObject,
      });
      const gate = projectControlledHarnessGate(
        casebook.id,
        [...existing, request.evidence],
        NAPIER_PRODUCT_VERSION,
      );
      const body = { evidence: request.evidence, gate };
      setGateHeaders(context, gate, body);
      context.header(
        "X-Napier-Controlled-Harness-Evidence",
        request.evidence.contentSha256,
      );
      return context.json(body, 201);
    },
  );
}

function parseRequest(
  input: unknown,
): { casebookId: string; evidence: ControlledHarnessEvidence } | undefined {
  if (!record(input)) return undefined;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "casebookId" ||
    keys[1] !== "evidence" ||
    typeof input["casebookId"] !== "string" ||
    input["casebookId"].length === 0
  ) {
    return undefined;
  }
  const evidence = parseControlledHarnessEvidence(input["evidence"]);
  return evidence ? { casebookId: input["casebookId"], evidence } : undefined;
}

async function loadGate(
  store: ControlledHarnessEvidenceStore,
  threadId: string,
  casebookId: string,
): Promise<ControlledHarnessGateProjection> {
  const casebook = store.getEvaluationCasebook(casebookId);
  return projectControlledHarnessGate(
    casebook.id,
    await loadEvidence(store, threadId),
    NAPIER_PRODUCT_VERSION,
  );
}

async function loadEvidence(
  store: ControlledHarnessEvidenceStore,
  threadId: string,
): Promise<ControlledHarnessEvidence[]> {
  return (await store.listEvents(threadId))
    .filter((event) => event.type === CONTROLLED_HARNESS_EVIDENCE_EVENT_TYPE)
    .flatMap((event) => {
      const evidence = parseControlledHarnessEvidence(event.payload);
      return evidence ? [evidence] : [];
    });
}

function setGateHeaders(
  context: Context,
  gate: ControlledHarnessGateProjection,
  body: unknown = gate,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "X-Napier-Controlled-Harness-Gate",
    gate.controlledTrackReady ? "passed" : "blocked",
  );
  setBodyContentSha256Header(context, body);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { createId } from "@napier/runtime/core";
import { previewWorkspaceDataArtifactProfile } from "@napier/runtime/workflow";
import { Hono } from "hono";

import {
  createLedgerEventReceiptProjection,
  errorMessage,
  jsonError,
  sha256Text,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  createPlanArtifactDataProfileVerificationEventPayload,
  parsePlanArtifactDataProfileVerificationRequest,
  verifyPlanArtifactDataProfileProjection,
} from "./plan-artifact-data-verification.js";
import {
  setPlanArtifactDataProfileHeaders,
  setPlanArtifactDataProfileVerificationHeaders,
} from "./plan-artifact-http-response.js";
import {
  getThreadPlan,
  type PlanArtifactHttpStore,
} from "./plan-artifact-http-store.js";

const MAX_PLAN_ARTIFACT_DATA_PROFILE_VERIFY_REQUEST_BYTES = 4 * 1024 * 1024;

export function registerPlanArtifactDataHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  registerPlanArtifactDataProfileHttp(app, store);
  registerPlanArtifactDataProfileVerificationHttp(app, store);
}

function registerPlanArtifactDataProfileHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/data",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact data profile is invalid", 404);
      }
      try {
        const profile = await previewWorkspaceDataArtifactProfile(
          store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-data-profile" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: profile.sha256,
          sizeBytes: profile.sizeBytes,
          format: profile.format,
          rowCount: profile.rowCount,
          columnCount: profile.columnCount,
          truncated: profile.truncated,
          columnSetSha256: profile.columnSetSha256,
          sampleSha256: profile.sampleSha256,
          columns: profile.columns,
          sampleRows: profile.sampleRows,
        };
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.data_profiled",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: profile.sha256,
            sizeBytes: profile.sizeBytes,
            format: profile.format,
            rowCount: profile.rowCount,
            columnCount: profile.columnCount,
            truncated: profile.truncated,
            columnSetSha256: profile.columnSetSha256,
            sampleSha256: profile.sampleSha256,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDataProfileHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerPlanArtifactDataProfileVerificationHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/data/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact data profile verification request is invalid",
          404,
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_PLAN_ARTIFACT_DATA_PROFILE_VERIFY_REQUEST_BYTES,
          "Plan artifact data profile verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact data profile verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const profile = parsePlanArtifactDataProfileVerificationRequest(input);
      if (!profile) {
        return jsonError(
          context,
          "Plan artifact data profile verification request is invalid",
          400,
        );
      }
      try {
        const observed = await previewWorkspaceDataArtifactProfile(
          store.workspaceRoot,
          artifact,
        );
        const verification = verifyPlanArtifactDataProfileProjection(
          plan,
          artifact,
          profile,
          observed,
        );
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.data_profile_verified",
          category: "artifact",
          visibility: "user",
          payload:
            createPlanArtifactDataProfileVerificationEventPayload(verification),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDataProfileVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

import {
  createId,
} from "@napier/runtime/core";
import {
  inspectWorkspaceArtifactDrift,
  previewWorkspaceTextArtifact,
} from "@napier/runtime/workflow";
import { Hono } from "hono";

import {
  createLedgerEventReceiptProjection,
  errorMessage,
  jsonError,
  sha256Text,
} from "./http-response-evidence.js";
import {
  setPlanArtifactDriftCheckHeaders,
  setPlanArtifactTextPreviewHeaders,
} from "./plan-artifact-http-response.js";
import {
  getThreadPlan,
  type PlanArtifactHttpStore,
} from "./plan-artifact-http-store.js";

export function registerPlanArtifactInspectionHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  registerPlanArtifactDriftCheckHttp(app, store);
  registerPlanArtifactTextPreviewHttp(app, store);
}

function registerPlanArtifactDriftCheckHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/drift-check",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact drift check is invalid", 404);
      }
      try {
        const inspection = await inspectWorkspaceArtifactDrift(
          store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-drift-check" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          expectedSha256: inspection.expectedSha256,
          result: inspection.result,
          ...(inspection.observedSha256
            ? { observedSha256: inspection.observedSha256 }
            : {}),
          ...(inspection.sizeBytes !== undefined
            ? { sizeBytes: inspection.sizeBytes }
            : {}),
        };
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.drift_checked",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            expectedSha256: inspection.expectedSha256,
            result: inspection.result,
            ...(inspection.observedSha256
              ? { observedSha256: inspection.observedSha256 }
              : {}),
            ...(inspection.sizeBytes !== undefined
              ? { sizeBytes: inspection.sizeBytes }
              : {}),
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDriftCheckHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerPlanArtifactTextPreviewHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/preview",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact preview is invalid", 404);
      }
      try {
        const preview = await previewWorkspaceTextArtifact(
          store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-text-preview" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: preview.sha256,
          sizeBytes: preview.sizeBytes,
          lineCount: preview.lineCount,
          textSha256: sha256Text(preview.text),
          text: preview.text,
        };
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.previewed",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: preview.sha256,
            sizeBytes: preview.sizeBytes,
            lineCount: preview.lineCount,
            textSha256: payload.textSha256,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactTextPreviewHeaders(context, plan, artifact, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

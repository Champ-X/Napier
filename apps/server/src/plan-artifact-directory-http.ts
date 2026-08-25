import {
  createId,
} from "@napier/runtime/core";
import {
  previewWorkspaceDirectoryArtifactManifest,
} from "@napier/runtime/workflow";
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
  createPlanArtifactDirectoryManifestVerificationEventPayload,
  parsePlanArtifactDirectoryManifestVerificationRequest,
  verifyPlanArtifactDirectoryManifestProjection,
} from "./plan-artifact-directory-verification.js";
import {
  setPlanArtifactDirectoryManifestHeaders,
  setPlanArtifactDirectoryManifestVerificationHeaders,
} from "./plan-artifact-http-response.js";
import {
  getThreadPlan,
  type PlanArtifactHttpStore,
} from "./plan-artifact-http-store.js";

const MAX_PLAN_ARTIFACT_DIRECTORY_MANIFEST_VERIFY_REQUEST_BYTES =
  4 * 1024 * 1024;

export function registerPlanArtifactDirectoryHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  registerPlanArtifactDirectoryManifestHttp(app, store);
  registerPlanArtifactDirectoryManifestVerificationHttp(app, store);
}

function registerPlanArtifactDirectoryManifestHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/manifest",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact manifest is invalid", 404);
      }
      try {
        const manifest = await previewWorkspaceDirectoryArtifactManifest(
          store.workspaceRoot,
          artifact,
        );
        const payload = {
          kind: "napier.plan-artifact-directory-manifest" as const,
          schemaVersion: 1 as const,
          planId: plan.id,
          artifactId: artifact.id,
          planRevision: plan.revision,
          status: artifact.status,
          artifactKind: artifact.kind,
          pathSha256: sha256Text(artifact.path),
          sha256: manifest.sha256,
          sizeBytes: manifest.sizeBytes,
          entryCount: manifest.entryCount,
          fileCount: manifest.fileCount,
          directoryCount: manifest.directoryCount,
          entries: manifest.entries,
        };
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.directory_manifested",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: payload.pathSha256,
            sha256: manifest.sha256,
            sizeBytes: manifest.sizeBytes,
            entryCount: manifest.entryCount,
            fileCount: manifest.fileCount,
            directoryCount: manifest.directoryCount,
          },
        });
        const response = {
          ...payload,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDirectoryManifestHeaders(
          context,
          plan,
          artifact,
          response,
        );
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerPlanArtifactDirectoryManifestVerificationHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/manifest/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact directory manifest verification request is invalid",
          404,
        );
      }
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_PLAN_ARTIFACT_DIRECTORY_MANIFEST_VERIFY_REQUEST_BYTES,
          "Plan artifact directory manifest verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact directory manifest verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      const manifest =
        parsePlanArtifactDirectoryManifestVerificationRequest(input);
      if (!manifest) {
        return jsonError(
          context,
          "Plan artifact directory manifest verification request is invalid",
          400,
        );
      }
      try {
        const observed = await previewWorkspaceDirectoryArtifactManifest(
          store.workspaceRoot,
          artifact,
        );
        const verification = verifyPlanArtifactDirectoryManifestProjection(
          plan,
          artifact,
          manifest,
          observed,
        );
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.directory_manifest_verified",
          category: "artifact",
          visibility: "user",
          payload:
            createPlanArtifactDirectoryManifestVerificationEventPayload(
              verification,
            ),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactDirectoryManifestVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

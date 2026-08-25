import type { ExecutionPlan } from "@napier/contracts";
import { createId } from "@napier/runtime/core";
import { exportWorkspaceFileArtifact } from "@napier/runtime/workflow";
import { Hono } from "hono";

import {
  createLedgerEventReceiptProjection,
  errorMessage,
  jsonError,
  sha256Bytes,
  sha256Json,
  sha256Text,
} from "./http-response-evidence.js";
import {
  readLimitedBytes,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  setPlanArtifactFileExportHeaders,
  setPlanArtifactFileVerificationHeaders,
} from "./plan-artifact-http-response.js";
import {
  getThreadPlan,
  type PlanArtifactHttpStore,
} from "./plan-artifact-http-store.js";

const MAX_PLAN_ARTIFACT_FILE_VERIFY_REQUEST_BYTES = 32 * 1024 * 1024;

export function registerPlanArtifactFileHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  registerPlanArtifactFileExportHttp(app, store);
  registerPlanArtifactFileVerificationHttp(app, store);
}

function registerPlanArtifactFileExportHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/file",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(context, "Plan artifact file is invalid", 404);
      }
      try {
        const exported = await exportWorkspaceFileArtifact(
          store.workspaceRoot,
          artifact,
        );
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.exported",
          category: "artifact",
          visibility: "user",
          payload: {
            planId: plan.id,
            artifactId: artifact.id,
            planRevision: plan.revision,
            status: artifact.status,
            kind: artifact.kind,
            pathSha256: sha256Text(artifact.path),
            sha256: exported.sha256,
            sizeBytes: exported.sizeBytes,
          },
        });
        setPlanArtifactFileExportHeaders(context, plan, artifact, {
          ...exported,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        });
        context.header("Content-Type", "application/octet-stream");
        const body = exported.contents.buffer.slice(
          exported.contents.byteOffset,
          exported.contents.byteOffset + exported.contents.byteLength,
        ) as ArrayBuffer;
        return context.body(body);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function registerPlanArtifactFileVerificationHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  app.post(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/file/verify",
    async (context) => {
      const threadId = context.req.param("threadId");
      const plan = getThreadPlan(store, context.req.param("planId"), threadId);
      const artifact = plan.artifacts.find(
        (candidate) => candidate.id === context.req.param("artifactId"),
      );
      if (!artifact) {
        return jsonError(
          context,
          "Plan artifact file verification request is invalid",
          404,
        );
      }
      if (
        context.req.header("content-type")?.split(";", 1)[0]?.trim() !==
        "application/octet-stream"
      ) {
        return jsonError(
          context,
          "Plan artifact file verification request must use application/octet-stream",
          400,
        );
      }
      let contents: Buffer;
      try {
        contents = await readLimitedBytes(
          context.req.raw,
          MAX_PLAN_ARTIFACT_FILE_VERIFY_REQUEST_BYTES,
          "Plan artifact file verification request",
        );
      } catch (error) {
        return jsonError(
          context,
          error instanceof RequestBodyTooLargeError
            ? error.message
            : "Plan artifact file verification request is invalid",
          error instanceof RequestBodyTooLargeError ? 413 : 400,
        );
      }
      try {
        const verification = verifyPlanArtifactFileProjection(plan, artifact, {
          sha256: sha256Bytes(contents),
          sizeBytes: contents.byteLength,
        });
        const ledgerEvent = await store.appendEvent({
          threadId,
          runId: createId("runctl"),
          type: "artifact.file_verified",
          category: "artifact",
          visibility: "user",
          payload: createPlanArtifactFileVerificationEventPayload(verification),
        });
        const response = {
          ...verification,
          ...createLedgerEventReceiptProjection(ledgerEvent),
        };
        setPlanArtifactFileVerificationHeaders(context, response);
        return context.json(response);
      } catch (error) {
        return jsonError(context, errorMessage(error), 400);
      }
    },
  );
}

function verifyPlanArtifactFileProjection(
  plan: ExecutionPlan,
  artifact: ExecutionPlan["artifacts"][number],
  observed: { sha256: string; sizeBytes: number },
) {
  if (
    artifact.kind !== "file" ||
    artifact.status !== "verified" ||
    !artifact.sha256 ||
    artifact.sizeBytes === undefined
  ) {
    throw new Error(
      "Only verified file artifacts with recorded digests can be verified",
    );
  }
  const diagnostics = [
    ...(observed.sha256 === artifact.sha256 ? [] : ["artifact_hash_mismatch"]),
    ...(observed.sizeBytes === artifact.sizeBytes ? [] : ["size_mismatch"]),
  ];
  return {
    kind: "napier.plan-artifact-file-verification" as const,
    schemaVersion: 1 as const,
    threadId: plan.threadId,
    planId: plan.id,
    artifactId: artifact.id,
    planRevision: plan.revision,
    status: artifact.status,
    artifactKind: artifact.kind,
    verificationStatus:
      diagnostics.length === 0 ? ("valid" as const) : ("drifted" as const),
    diagnostics,
    pathSha256: sha256Text(artifact.path),
    expectedSha256: artifact.sha256,
    observedSha256: observed.sha256,
    expectedSizeBytes: artifact.sizeBytes,
    observedSizeBytes: observed.sizeBytes,
  };
}

function createPlanArtifactFileVerificationEventPayload(
  verification: ReturnType<typeof verifyPlanArtifactFileProjection>,
) {
  return {
    planId: verification.planId,
    artifactId: verification.artifactId,
    planRevision: verification.planRevision,
    status: verification.status,
    kind: verification.artifactKind,
    pathSha256: verification.pathSha256,
    verificationStatus: verification.verificationStatus,
    diagnosticCount: verification.diagnostics.length,
    diagnosticsSha256: sha256Json(verification.diagnostics),
    expectedSha256: verification.expectedSha256,
    observedSha256: verification.observedSha256,
    expectedSizeBytes: verification.expectedSizeBytes,
    observedSizeBytes: verification.observedSizeBytes,
  };
}

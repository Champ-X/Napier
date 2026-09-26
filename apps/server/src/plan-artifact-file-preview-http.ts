import type { ExecutionPlan } from "@napier/contracts";
import {
  filePreviewContentType,
  MAX_WORKSPACE_FILE_PREVIEW_BYTES,
} from "@napier/contracts/file-preview";
import { createId } from "@napier/runtime/core";
import { exportWorkspaceFileArtifact } from "@napier/runtime/workflow";
import type { Context, Hono } from "hono";

import {
  createLedgerEventReceiptProjection,
  errorMessage,
  jsonError,
  sha256Text,
} from "./http-response-evidence.js";
import { setPlanArtifactFilePreviewHeaders } from "./plan-artifact-http-response.js";
import {
  getThreadPlan,
  type PlanArtifactHttpStore,
} from "./plan-artifact-http-store.js";

/** Keep binary previews bound to the same artifact identity and digest as text. */
export function registerPlanArtifactFilePreviewHttp(
  app: Hono,
  store: PlanArtifactHttpStore,
): void {
  const handler = (recordEvidence: boolean) => async (context: Context) => {
    const threadId = context.req.param("threadId");
    const planId = context.req.param("planId");
    if (!threadId || !planId) {
      return jsonError(context, "Plan artifact preview is invalid", 404);
    }
    let plan: ExecutionPlan;
    try {
      plan = getThreadPlan(store, planId, threadId);
    } catch {
      return jsonError(context, "Plan artifact preview is invalid", 404);
    }
    const artifact = plan.artifacts.find(
      (candidate) => candidate.id === context.req.param("artifactId"),
    );
    if (!artifact) {
      return jsonError(context, "Plan artifact preview is invalid", 404);
    }
    try {
      const preview = await exportWorkspaceFileArtifact(
        store.workspaceRoot,
        artifact,
        { maxBytes: MAX_WORKSPACE_FILE_PREVIEW_BYTES },
      );
      const contentType = filePreviewContentType(artifact.path);
      const event = recordEvidence
        ? await store.appendEvent({
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
              previewKind: "file",
              contentType,
              pathSha256: sha256Text(artifact.path),
              sha256: preview.sha256,
              sizeBytes: preview.sizeBytes,
            },
          })
        : undefined;
      setPlanArtifactFilePreviewHeaders(context, plan, artifact, {
        ...preview,
        ...(event ? createLedgerEventReceiptProjection(event) : {}),
      });
      if (!recordEvidence) context.header("X-Napier-Read-Mode", "peek");
      context.header("Content-Type", contentType);
      context.header("X-Content-Type-Options", "nosniff");
      context.header("Referrer-Policy", "no-referrer");
      if (
        contentType.startsWith("text/html") ||
        contentType.startsWith("image/svg+xml")
      ) {
        // Interactive HTML uses the separate directory-scoped sandbox URL.
        context.header(
          "Content-Security-Policy",
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        );
      }
      return context.body(new Uint8Array(preview.contents));
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RangeError ? 413 : 400,
      );
    }
  };
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/preview-file",
    handler(true),
  );
  app.get(
    "/api/threads/:threadId/plans/:planId/artifacts/:artifactId/preview-file/peek",
    handler(false),
  );
}

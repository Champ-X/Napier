import {
  compareRuns,
  createId,
  createOpenTelemetryTraceArtifact,
  createRunReplaySnapshot,
  exportThreadReplayBundle,
  type LocalStore,
  MAX_THREAD_REPLAY_BUNDLE_BYTES,
  openTelemetryTraceArtifactEventAnchorSetSha256,
  verifyOpenTelemetryTraceArtifact,
  verifyRunReplaySnapshot,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { Hono } from "hono";

import { errorMessage, jsonError } from "./http-response-evidence.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  parseExportOpenTelemetryTraceRequest,
  parseVerifyOpenTelemetryTraceArtifactRequest,
  parseVerifyRunReplaySnapshotRequest,
  parseVerifyThreadReplayBundleRequest,
} from "./thread-evidence-http-validation.js";
import {
  bindRunReplaySnapshotVerification,
  setRunComparisonHeaders,
  setRunReplaySnapshotHeaders,
  setRunReplaySnapshotVerificationHeaders,
  setThreadEventsProjectionHeaders,
  setThreadReplayBundleHeaders,
  setThreadReplayBundleVerificationHeaders,
} from "./thread-replay-http-response.js";
import {
  bindOpenTelemetryTraceArtifactVerification,
  setOpenTelemetryTraceArtifactHeaders,
  setOpenTelemetryTraceArtifactVerificationHeaders,
} from "./thread-trace-http-response.js";

const MAX_TRACE_EXPORT_REQUEST_BYTES = 8 * 1024;

type ThreadEvidenceHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getDetail"
  | "getThread"
  | "listAgentRevisions"
  | "listEvents"
  | "listRuns"
  | "listSubagentTasks"
>;

export interface ThreadEvidenceHttpServices {
  store: ThreadEvidenceHttpStore;
}

export function registerThreadEvidenceHttp(
  app: Hono,
  services: ThreadEvidenceHttpServices,
): void {
  app.get("/api/threads/:threadId/events", async (context) => {
    const after = Number.parseInt(context.req.query("after") ?? "0", 10);
    const afterSeq = Number.isFinite(after) ? after : 0;
    const threadId = context.req.param("threadId");
    const events = await services.store.listEvents(threadId, afterSeq);
    setThreadEventsProjectionHeaders(context, threadId, events, afterSeq);
    return context.json(events);
  });

  app.get("/api/threads/:threadId/fixture", async (context) => {
    const bundle = await exportThreadReplayBundle(
      services.store,
      context.req.param("threadId"),
    );
    const verification = verifyThreadReplayBundle(bundle);
    if (verification.status !== "valid") {
      throw new Error(
        `Exported thread replay bundle verification failed: ${verification.diagnostics.join(", ")}`,
      );
    }
    setThreadReplayBundleHeaders(context, bundle, verification);
    return context.json(bundle);
  });

  app.post("/api/threads/import/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
        "Thread replay bundle verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid thread replay verification request: ${error.message}`
          : "Invalid thread replay verification request",
        400,
      );
    }
    const request = parseVerifyThreadReplayBundleRequest(input);
    if (!request) {
      return jsonError(
        context,
        "Thread replay verification request is invalid",
        400,
      );
    }
    const verification = verifyThreadReplayBundle(request.bundle);
    setThreadReplayBundleVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.post("/api/threads/:threadId/trace/otlp", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_TRACE_EXPORT_REQUEST_BYTES,
        "OpenTelemetry trace export request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseExportOpenTelemetryTraceRequest(input);
    if (!body) {
      return jsonError(
        context,
        "OpenTelemetry trace export request is invalid",
        400,
      );
    }
    const threadId = context.req.param("threadId");
    const artifact = await createOpenTelemetryTraceArtifact(
      services.store,
      threadId,
      body.runId,
    );
    await services.store.appendEvent({
      threadId,
      runId: createId("runctl"),
      type: "trace.otlp.exported",
      category: "system",
      visibility: "user",
      payload: {
        scope: body.runId ? "run" : "thread",
        ...(body.runId ? { sourceRunId: body.runId } : {}),
        traceId: artifact.traceId,
        spanCount: artifact.spanCount,
        eventCount: artifact.eventRange.eventCount,
        eventStreamSha256: artifact.eventRange.eventStreamSha256,
        eventAnchorSetSha256:
          openTelemetryTraceArtifactEventAnchorSetSha256(artifact),
        contentSha256: artifact.contentSha256,
      },
    });
    setOpenTelemetryTraceArtifactHeaders(context, artifact);
    return context.json(artifact);
  });

  app.post("/api/threads/:threadId/trace/otlp/verify", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_THREAD_REPLAY_BUNDLE_BYTES,
        "OpenTelemetry trace verification request",
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError(context, error.message, 413);
      }
      return jsonError(
        context,
        error instanceof Error
          ? `Invalid OpenTelemetry trace verification request: ${error.message}`
          : "Invalid OpenTelemetry trace verification request",
        400,
      );
    }
    const request = parseVerifyOpenTelemetryTraceArtifactRequest(input);
    if (!request) {
      return jsonError(
        context,
        "OpenTelemetry trace verification request is invalid",
        400,
      );
    }
    const verification = bindOpenTelemetryTraceArtifactVerification(
      verifyOpenTelemetryTraceArtifact(request.artifact),
      context.req.param("threadId"),
    );
    setOpenTelemetryTraceArtifactVerificationHeaders(context, verification);
    return context.json(verification);
  });

  app.get("/api/threads/:threadId/runs/:runId/replay", async (context) => {
    const snapshot = await createRunReplaySnapshot(
      services.store,
      context.req.param("threadId"),
      context.req.param("runId"),
    );
    setRunReplaySnapshotHeaders(context, snapshot);
    return context.json(snapshot);
  });

  app.post(
    "/api/threads/:threadId/runs/:runId/replay/verify",
    async (context) => {
      let input: unknown;
      try {
        input = await readLimitedJson(
          context.req.raw,
          MAX_THREAD_REPLAY_BUNDLE_BYTES,
          "Run replay snapshot verification request",
        );
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return jsonError(context, error.message, 413);
        }
        return jsonError(
          context,
          error instanceof Error
            ? `Invalid Run replay snapshot verification request: ${error.message}`
            : "Invalid Run replay snapshot verification request",
          400,
        );
      }
      const request = parseVerifyRunReplaySnapshotRequest(input);
      if (!request) {
        return jsonError(
          context,
          "Run replay snapshot verification request is invalid",
          400,
        );
      }
      const verification = bindRunReplaySnapshotVerification(
        verifyRunReplaySnapshot(request.snapshot),
        context.req.param("threadId"),
        context.req.param("runId"),
      );
      setRunReplaySnapshotVerificationHeaders(context, verification);
      return context.json(verification);
    },
  );

  app.get("/api/threads/:threadId/runs/compare", async (context) => {
    const leftRunId = context.req.query("left")?.trim();
    const rightRunId = context.req.query("right")?.trim();
    if (!leftRunId || !rightRunId) {
      return jsonError(context, "left and right run IDs are required", 400);
    }
    const comparison = await compareRuns(
      services.store,
      context.req.param("threadId"),
      leftRunId,
      rightRunId,
    );
    setRunComparisonHeaders(context, comparison);
    return context.json(comparison);
  });
}

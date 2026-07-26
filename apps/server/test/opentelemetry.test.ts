import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
} from "@napier/contracts";
import { validateOpenTelemetryTraceArtifact } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function expectOpenTelemetryTraceHeaders(
  response: Response,
  artifact: OpenTelemetryTraceArtifact,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toContain("napier-otel-");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    artifact.contentSha256,
  );
  expect(response.headers.get("x-napier-trace-id")).toBe(artifact.traceId);
  expect(response.headers.get("x-napier-thread-id")).toBe(artifact.threadId);
  expect(response.headers.get("x-napier-run-id")).toBe(artifact.runId ?? null);
  expect(response.headers.get("x-napier-span-count")).toBe(
    String(artifact.spanCount),
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(artifact.eventRange.eventCount),
  );
  expect(response.headers.get("x-napier-first-event-seq")).toBe(
    String(artifact.eventRange.fromSeq),
  );
  expect(response.headers.get("x-napier-last-event-seq")).toBe(
    String(artifact.eventRange.toSeq),
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    artifact.eventRange.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-trace-redaction-mode")).toBe(
    artifact.redaction.mode,
  );
  expect(response.headers.get("x-napier-trace-content-capture")).toBe(
    String(artifact.redaction.contentCapture),
  );
  expect(response.headers.get("x-napier-trace-excluded-event-type-count")).toBe(
    String(artifact.redaction.excludedEventTypes.length),
  );
  expect(
    response.headers.get("x-napier-trace-excluded-payload-key-count"),
  ).toBe(String(artifact.redaction.excludedPayloadKeys.length));
}

function expectOpenTelemetryTraceVerificationHeaders(
  response: Response,
  verification: OpenTelemetryTraceArtifactVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  const diagnosticsSha256 = createHash("sha256")
    .update(JSON.stringify(verification.diagnostics))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-span-count")).toBe(
    String(verification.spanCount),
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(verification.eventCount),
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    diagnosticsSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    verification.threadId ?? null,
  );
  expect(response.headers.get("x-napier-run-id")).toBe(
    verification.runId ?? null,
  );
  expect(response.headers.get("x-napier-trace-id")).toBe(
    verification.traceId ?? null,
  );
  expect(response.headers.get("x-napier-trace-sha256")).toBe(
    verification.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    verification.eventStreamSha256 ?? null,
  );
}

describe("OpenTelemetry trace HTTP export", () => {
  it("exports stable OTLP JSON and records hash-only audit evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-otel-"));
    temporaryRoots.push(root);
    const services = await createNapierServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = services.store.listThreads()[0]!;
    const agent = services.store.getAgent(thread.agentId);
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "TOP_SECRET_HTTP_TRACE_PROMPT",
      },
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "model.response",
      category: "model",
      visibility: "debug",
      payload: {
        text: "TOP_SECRET_HTTP_TRACE_COMPLETION",
        reasoning: "TOP_SECRET_HTTP_TRACE_REASONING",
        model: "napier/demo",
        stopReason: "stop",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      },
    });
    await services.store.finishRun(run.id, "completed");

    const invalid = await app.request(`/api/threads/${thread.id}/trace/otlp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unsupported: true }),
    });
    expect(invalid.status).toBe(400);

    const firstResponse = await app.request(
      `/api/threads/${thread.id}/trace/otlp`,
      { method: "POST" },
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as OpenTelemetryTraceArtifact;
    expect(validateOpenTelemetryTraceArtifact(first)).toEqual(first);
    expectOpenTelemetryTraceHeaders(firstResponse, first);
    expect(JSON.stringify(first)).not.toContain("TOP_SECRET_HTTP_TRACE");

    const verifyResponse = await app.request(
      `/api/threads/${thread.id}/trace/otlp/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact: first }),
      },
    );
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as OpenTelemetryTraceArtifactVerification;
    expect(verification).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: thread.id,
      traceId: first.traceId,
      contentSha256: first.contentSha256,
      eventStreamSha256: first.eventRange.eventStreamSha256,
      spanCount: first.spanCount,
      eventCount: first.eventRange.eventCount,
    });
    expectOpenTelemetryTraceVerificationHeaders(verifyResponse, verification);

    const exportEvents = (await services.store.listEvents(thread.id)).filter(
      (event) => event.type === "trace.otlp.exported",
    );
    expect(exportEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          scope: "thread",
          traceId: first.traceId,
          spanCount: first.spanCount,
          eventCount: first.eventRange.eventCount,
          eventStreamSha256: first.eventRange.eventStreamSha256,
          contentSha256: first.contentSha256,
        }),
      }),
    ]);
    expect(JSON.stringify(exportEvents)).not.toContain("TOP_SECRET");

    const tampered = structuredClone(first);
    tampered.spanCount += 1;
    const tamperedResponse = await app.request(
      `/api/threads/${thread.id}/trace/otlp/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact: tampered }),
      },
    );
    expect(tamperedResponse.status).toBe(200);
    const tamperedVerification =
      (await tamperedResponse.json()) as OpenTelemetryTraceArtifactVerification;
    expect(tamperedVerification).toEqual({
      status: "invalid",
      diagnostics: ["span_count_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });
    expectOpenTelemetryTraceVerificationHeaders(
      tamperedResponse,
      tamperedVerification,
    );

    const mismatchThread = await services.store.createThread({
      title: "OTLP path mismatch",
      agentId: agent.id,
    });
    const mismatchResponse = await app.request(
      `/api/threads/${mismatchThread.id}/trace/otlp/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact: first }),
      },
    );
    expect(mismatchResponse.status).toBe(200);
    const mismatchVerification =
      (await mismatchResponse.json()) as OpenTelemetryTraceArtifactVerification;
    expect(mismatchVerification).toEqual({
      ...verification,
      status: "invalid",
      diagnostics: ["path_mismatch"],
    });
    expectOpenTelemetryTraceVerificationHeaders(
      mismatchResponse,
      mismatchVerification,
    );
    expect(
      (await services.store.listEvents(thread.id)).filter(
        (event) => event.type === "trace.otlp.exported",
      ),
    ).toHaveLength(1);

    const repeatedResponse = await app.request(
      `/api/threads/${thread.id}/trace/otlp`,
      { method: "POST" },
    );
    expect(repeatedResponse.status).toBe(200);
    const repeated =
      (await repeatedResponse.json()) as OpenTelemetryTraceArtifact;
    expectOpenTelemetryTraceHeaders(repeatedResponse, repeated);
    expect(repeated.contentSha256).toBe(first.contentSha256);

    const runResponse = await app.request(
      `/api/threads/${thread.id}/trace/otlp`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      },
    );
    expect(runResponse.status).toBe(200);
    const runArtifact =
      (await runResponse.json()) as OpenTelemetryTraceArtifact;
    expectOpenTelemetryTraceHeaders(runResponse, runArtifact);
    expect(runArtifact.runId).toBe(run.id);
    expect(runArtifact.spanCount).toBeLessThanOrEqual(first.spanCount);

    const missing = await app.request(`/api/threads/${thread.id}/trace/otlp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run_00000000000000000000" }),
    });
    expect(missing.status).toBe(404);
  });
});

import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AgentProfile,
  AgentProfileRevision,
  AgentProfileRollbackResult,
  AutomationSchedule,
  BootstrapResponse,
  CreatedInboundChannel,
  CredentialReference,
  ContextCheckpointCalibrationReport,
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintPortfolioCalibration,
  ExecutionPlanBlueprintRecommendationPolicyBacktest,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  ExecutionPlanBlueprintVerification,
  ExecutionPlanReplanDraftModelReview,
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  EvaluationCasebook,
  EvaluationCasebookArtifact,
  EvaluationCasebookCalibrationReport,
  EvaluationCasebookQualificationExecution,
  EvaluationCasebookQualificationReceipt,
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  ResolveEvaluationConsensusResult,
  EvaluationSuite,
  EvaluationSuiteExecution,
  EvaluationSuiteGateReceipt,
  ExtensionRecord,
  HealthResponse,
  InboundChannelAdapterDescriptor,
  InboundChannelAdapterPreview,
  InboundDeadLetterExport,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  InboundDeadLetterExportVerification,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundReceipt,
  MemoryFact,
  AgentMilestone,
  OperatorDecision,
  ReceiptTrustAnchor,
  RunComparison,
  RunControlMessage,
  RunEvaluationRecord,
  RunMetrics,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  SaveExecutionPlanBlueprintResult,
  StreamFrame,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
  ThreadDetail,
  ThreadReplayBundle,
  ThreadReplayBundleVerification,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
  UsagePriceTableCatalog,
  UsagePriceTableVerification,
} from "@napier/contracts";
import {
  createUsagePriceTableCatalog,
  createContextCheckpoint,
  createSubagentOutcome,
  LEDGER_SCHEMA_VERSION,
  McpExtensionManager,
  planContextProjection,
  validateEvaluationCasebookArtifact,
  validateEvaluationCasebookQualificationReceipt,
  validateEvaluationSuiteGateReceipt,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
  inferWorkspaceRoot,
} from "../src/app.js";

const POLICY_RETIREMENT_SIGNING_ENV =
  "NAPIER_TEST_POLICY_RETIREMENT_SIGNING_KEY";
const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

async function createServices(
  options: Parameters<typeof createNapierServices>[0],
) {
  const services = await createNapierServices(options);
  openServices.push(services);
  return services;
}

afterEach(async () => {
  delete process.env[POLICY_RETIREMENT_SIGNING_ENV];
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

describe("Napier HTTP goal flow", () => {
  it("infers the repository boundary when npm starts from the server workspace", () => {
    expect(inferWorkspaceRoot("/workspace/napier/apps/server")).toBe(
      path.resolve("/workspace/napier"),
    );
    expect(inferWorkspaceRoot("/workspace/operator-project")).toBe(
      path.resolve("/workspace/operator-project"),
    );
  });

  it("reports Ledger and runtime readiness through the public health API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    const health = (await response.json()) as HealthResponse;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      responseSha256(health),
    );
    expect(response.headers.get("x-napier-service")).toBe("napier");
    expect(response.headers.get("x-napier-health-status")).toBe("ok");
    expect(response.headers.get("x-napier-node-version")).toBe(
      process.versions.node,
    );
    expect(response.headers.get("x-napier-node-platform")).toBe(
      process.platform,
    );
    expect(response.headers.get("x-napier-node-arch")).toBe(process.arch);
    expect(response.headers.get("x-napier-runtime-component-count")).toBe("4");
    expect(response.headers.get("x-napier-runtime-components-sha256")).toBe(
      responseSha256(health.runtime.components),
    );
    expect(response.headers.get("x-napier-runtime-sqlite-version")).toBe(
      health.runtime.components.sqlite,
    );
    expect(response.headers.get("x-napier-runtime-openssl-version")).toBe(
      health.runtime.components.openssl,
    );
    expect(response.headers.get("x-napier-runtime-uv-version")).toBe(
      health.runtime.components.uv,
    );
    expect(response.headers.get("x-napier-runtime-v8-version")).toBe(
      health.runtime.components.v8,
    );
    expect(response.headers.get("x-napier-ledger-schema-version")).toBe(
      String(LEDGER_SCHEMA_VERSION),
    );
    expect(response.headers.get("x-napier-ledger-quick-check")).toBe("ok");
    expect(response.headers.get("x-napier-ledger-migration-count")).toBe(
      String(health.ledger.migrations.length),
    );
    expect(response.headers.get("x-napier-ledger-migrations-sha256")).toBe(
      responseSha256(health.ledger.migrations),
    );
    expect(
      response.headers.get("x-napier-ledger-latest-migration-version"),
    ).toBe(String(LEDGER_SCHEMA_VERSION));
    expect(response.headers.get("x-napier-ledger-latest-migration-name")).toBe(
      "schema_migration_history",
    );
    expect(health).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "napier",
        runtime: {
          node: {
            version: process.versions.node,
            platform: process.platform,
            arch: process.arch,
          },
          components: {
            sqlite: process.versions.sqlite ?? "unavailable",
            openssl: process.versions.openssl ?? "unavailable",
            uv: process.versions.uv ?? "unavailable",
            v8: process.versions.v8 ?? "unavailable",
          },
        },
        ledger: expect.objectContaining({
          schemaVersion: LEDGER_SCHEMA_VERSION,
          quickCheck: "ok",
          migrations: expect.arrayContaining([
            expect.objectContaining({
              version: LEDGER_SCHEMA_VERSION,
              name: "schema_migration_history",
            }),
          ]),
        }),
      }),
    );
  });

  it("hash-binds zero-mutation management GET projections", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    for (const path of [
      "/api/health",
      "/api/bootstrap",
      "/api/schedules",
      "/api/channels",
      "/api/channels/adapters",
      "/api/memories",
      "/api/credentials",
      "/api/extensions",
      "/api/extensions/publishers",
      "/api/receipt-trust/anchors",
    ]) {
      const response = await app.request(path);

      expect(response.status, path).toBe(200);
      await expectJsonContentHash(response, path);
    }
  });

  it("keeps no-store response header helpers content-hash bound", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const noStoreHelpers = extractFunctions(source).filter(({ body }) =>
      body.includes('"Cache-Control", "no-store"'),
    );
    const missingContentHash = noStoreHelpers
      .filter(({ body }) => !bodyCallsContentHashHelper(body))
      .map(({ line, name }) => `${name}:${line}`);

    expect(noStoreHelpers.map(({ name }) => name)).toContain(
      "setBootstrapProjectionHeaders",
    );
    expect(missingContentHash).toEqual([]);
  });

  it("keeps content hash mode projection centralized", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const functions = extractFunctions(source);
    const contentHashHeader = functions.find(
      ({ name }) => name === "setContentSha256Header",
    );
    const directHeaderWrites = functions.flatMap(({ body, line, name }) =>
      [...body.matchAll(/context\.header\(\s*"X-Napier-Content-SHA256"/g)]
        .filter(() => name !== "setContentSha256Header")
        .map(() => `${name}:${line}`),
    );

    expect(contentHashHeader?.body).toContain('"X-Napier-Content-SHA256-Mode"');
    expect(directHeaderWrites).toEqual([]);
  });

  it("keeps JSON route responses behind projection header helpers", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const missingProjectionHeaders = extractRouteHandlers(source).flatMap(
      (route) =>
        [...route.body.matchAll(/return\s+context\.json\s*\(/g)]
          .filter(({ index }) => {
            const prior = route.body.slice(0, index);
            return ![
              /set[A-Za-z0-9]+(?:Projection)?Headers\s*\(\s*context/,
              /set[A-Za-z0-9]+CountHeaders\s*\(\s*context/,
              /setEventBoundaryHeaders\s*\(\s*context/,
            ].some((pattern) => pattern.test(prior));
          })
          .map(
            ({ index }) =>
              `${route.method}:${route.line}:return:${lineNumberAt(source, route.bodyStart + (index ?? 0))}`,
          ),
    );

    expect(extractRouteHandlers(source).length).toBeGreaterThan(100);
    expect(missingProjectionHeaders).toEqual([]);
  });

  it("keeps Run SSE done frames behind the terminal status guard", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const directDoneRunStatusWrites = [
      ...source.matchAll(/type:\s*"done"[\s\S]{0,120}status:\s*run\.status/g),
    ];
    const guardedDoneFrameWrites = [
      ...source.matchAll(
        /streamRunDoneFrame\(\s*threadId,\s*run\.id,\s*run\.status,\s*snapshotFrame\.detailSha256,\s*snapshotFrame\.detail\.thread\.eventCount,\s*hashEventStream\(snapshotFrame\.detail\.events\),?\s*\)/g,
      ),
    ];

    expect(directDoneRunStatusWrites).toHaveLength(0);
    expect(guardedDoneFrameWrites).toHaveLength(3);
    expect(source).toContain("threadId,");
    expect(source).toContain("snapshotSha256,");
    expect(source).toContain("eventCount,");
    expect(source).toContain("eventStreamSha256,");
    expect(source).toMatch(
      /case "queued":[\s\S]*case "running":[\s\S]*throw new Error/,
    );
    expect(source).toContain(
      "Run stream cannot finish with non-terminal status",
    );
  });

  it("keeps Run SSE snapshot frames behind the detail hash guard", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const directSnapshotWrites = [
      ...source.matchAll(/type:\s*"snapshot"[\s\S]{0,120}detail:/g),
    ];
    const guardedSnapshotWrites = [
      ...source.matchAll(
        /const snapshotFrame = streamSnapshotFrame\(\s*await services\.store\.getDetail\(threadId\),\s*\)/g,
      ),
    ];

    expect(directSnapshotWrites).toHaveLength(0);
    expect(guardedSnapshotWrites).toHaveLength(3);
    expect(source).toContain(
      "detailSha256: sha256Text(JSON.stringify(detail))",
    );
  });

  it("keeps successful Run SSE streams snapshot-before-done", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const snapshotBeforeDoneWrites = [
      ...source.matchAll(
        /const snapshotFrame = streamSnapshotFrame\([\s\S]{0,160}const doneFrame = streamRunDoneFrame\(\s*threadId,\s*run\.id,\s*run\.status,\s*snapshotFrame\.detailSha256,\s*snapshotFrame\.detail\.thread\.eventCount,\s*hashEventStream\(snapshotFrame\.detail\.events\),?\s*\);[\s\S]{0,80}await writeFrame\(snapshotFrame\);[\s\S]{0,80}await writeFrame\(doneFrame\);/g,
      ),
    ];

    expect(snapshotBeforeDoneWrites).toHaveLength(3);
  });

  it("keeps Run SSE event frames behind the event hash guard", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const directEventWrites = [
      ...source.matchAll(
        /writeFrame\(\s*\{\s*type:\s*"event"[\s\S]{0,120}event/g,
      ),
    ];
    const guardedEventWrites = [
      ...source.matchAll(
        /writeFrame\(\s*streamEventFrame\(event\),\s*String\(event\.seq\)\s*\)/g,
      ),
    ];

    expect(directEventWrites).toHaveLength(0);
    expect(guardedEventWrites).toHaveLength(3);
    expect(source).toContain("eventSha256: sha256Text(JSON.stringify(event))");
  });

  it("keeps Run SSE error frames behind the thread diagnostic guard", async () => {
    const source = await readFile(new URL("../src/app.ts", import.meta.url), {
      encoding: "utf8",
    });
    const directErrorWrites = [
      ...source.matchAll(/writeFrame\(\s*\{\s*type:\s*"error"/g),
    ];
    const guardedErrorWrites = [
      ...source.matchAll(
        /writeFrame\(\s*streamRunErrorFrame\(threadId,\s*error\)\s*\)/g,
      ),
    ];

    expect(directErrorWrites).toHaveLength(0);
    expect(guardedErrorWrites).toHaveLength(3);
    expect(source).toContain("threadId,");
    expect(source).toContain(
      "diagnosticSha256: sha256Text(errorMessage(error))",
    );
  });

  it("returns hash-bound projections for management API errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    const response = await app.request("/api/threads/thread_missing0000");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("not found");
    expectJsonErrorProjectionHeaders(response, body, 404);

    const unknownRouteResponse = await app.request("/api/unknown/route");
    expect(unknownRouteResponse.status).toBe(404);
    const unknownRouteBody = (await unknownRouteResponse.json()) as {
      error: string;
    };
    expect(unknownRouteBody).toEqual({
      error: "API route not found: /api/unknown/route",
    });
    expectJsonErrorProjectionHeaders(
      unknownRouteResponse,
      unknownRouteBody,
      404,
    );
  });

  it("persists a fail-closed goal verdict through the public SSE API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    const createResponse = await app.request("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Goal API test" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(createResponse, created);
    expectThreadDetailProjectionHeaders(createResponse, created);

    const goalResponse = await app.request(
      `/api/threads/${created.thread.id}/goal`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Produce independently verified evidence",
          maxContinuations: 2,
        }),
      },
    );
    expect(goalResponse.status).toBe(200);
    const goalDetail = (await goalResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(goalResponse, goalDetail);
    expect(goalDetail.thread.goal?.objective).toBe(
      "Produce independently verified evidence",
    );

    const runResponse = await app.request(
      `/api/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Work toward the active goal." }),
      },
    );
    expect(runResponse.status).toBe(200);
    expectThreadPromptStreamHeaders(runResponse, created.thread.id);
    const frames = parseSseFrames(await runResponse.text());
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.type === "goal.evaluation.started",
      ),
    ).toBe(true);
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "goal.evaluated",
      ),
    ).toBe(true);
    expectFinalDoneMatchesSnapshot(frames);

    const detailResponse = await app.request(
      `/api/threads/${created.thread.id}`,
    );
    const detail = (await detailResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(detailResponse, detail);
    expect(detail.thread.goal?.status).toBe("blocked");
    expect(detail.thread.goal?.blocker).toBe("missing_evidence");
    expect(detail.runs.at(-1)?.status).toBe("completed");
    const eventsResponse = await app.request(
      `/api/threads/${created.thread.id}/events`,
    );
    expect(eventsResponse.status).toBe(200);
    const events = (await eventsResponse.json()) as ThreadDetail["events"];
    expect(events).toEqual(detail.events);
    expectThreadEventsProjectionHeaders(
      eventsResponse,
      created.thread.id,
      events,
      0,
    );

    const emptyEventsResponse = await app.request(
      `/api/threads/${created.thread.id}/events?after=${detail.events.at(-1)!.seq}`,
    );
    expect(emptyEventsResponse.status).toBe(200);
    const emptyEvents =
      (await emptyEventsResponse.json()) as ThreadDetail["events"];
    expect(emptyEvents).toEqual([]);
    expectThreadEventsProjectionHeaders(
      emptyEventsResponse,
      created.thread.id,
      emptyEvents,
      detail.events.at(-1)!.seq,
    );
  });

  it("manages a hash-bound durable Run control inbox", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Run control API",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-control", id: "faux-1" },
    });
    const endpointPath = `/api/threads/${thread.id}/runs/${run.id}/control-messages`;

    const invalidResponse = await app.request(endpointPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "steering",
        text: "Valid text.",
        unsupported: true,
      }),
    });
    expect(invalidResponse.status).toBe(400);

    const escapedBoundaryText = "\u0001".repeat(16 * 1024);
    const escapedBoundaryResponse = await app.request(endpointPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "steering",
        text: escapedBoundaryText,
      }),
    });
    expect(escapedBoundaryResponse.status).toBe(202);
    const escapedBoundary =
      (await escapedBoundaryResponse.json()) as RunControlMessage;
    expect(escapedBoundary).toEqual(
      expect.objectContaining({
        mode: "steering",
        status: "queued",
        textBytes: 16 * 1024,
      }),
    );
    const escapedBoundaryCancelResponse = await app.request(
      `${endpointPath}/${escapedBoundary.id}/cancel`,
      { method: "POST" },
    );
    expect(escapedBoundaryCancelResponse.status).toBe(200);
    const escapedBoundaryCancelled =
      (await escapedBoundaryCancelResponse.json()) as RunControlMessage;

    const queueResponse = await app.request(endpointPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "follow_up",
        text: "Summarize the verified Run evidence.",
      }),
    });
    expect(queueResponse.status).toBe(202);
    const queued = (await queueResponse.json()) as RunControlMessage;
    expect(queued).toEqual(
      expect.objectContaining({
        threadId: thread.id,
        runId: run.id,
        mode: "follow_up",
        status: "queued",
        textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(queued)).not.toContain("Summarize the verified");
    expectRunControlMessageHeaders(queueResponse, queued);

    const listResponse = await app.request(endpointPath);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as RunControlMessage[];
    expect(listed).toEqual([escapedBoundaryCancelled, queued]);
    expectRunControlMessageListHeaders(listResponse, thread.id, run.id, listed);

    const cancelResponse = await app.request(
      `${endpointPath}/${queued.id}/cancel`,
      {
        method: "POST",
      },
    );
    expect(cancelResponse.status).toBe(200);
    const cancelled = (await cancelResponse.json()) as RunControlMessage;
    expect(cancelled).toEqual(
      expect.objectContaining({
        id: queued.id,
        status: "cancelled",
        cancellationReason: "operator_cancelled",
      }),
    );
    expectRunControlMessageHeaders(cancelResponse, cancelled);

    await services.store.finishRun(run.id, "completed");
    const lateResponse = await app.request(endpointPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "steering",
        text: "This message is too late.",
      }),
    });
    expect(lateResponse.status).toBe(409);

    const missingResponse = await app.request(
      `/api/threads/${thread.id}/runs/run_missing0000/control-messages`,
    );
    expect(missingResponse.status).toBe(404);
  });

  it("lists durable Agent milestones with hash-bound public evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Agent milestone API",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-milestone-api", id: "faux-1" },
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "workspace.inspected",
      category: "artifact",
      visibility: "user",
      payload: { status: "completed" },
    });
    const milestone = (
      await services.store.recordAgentMilestone({
        threadId: thread.id,
        runId: run.id,
        phase: "verification",
        title: "Public projection verified",
        summary: "The management API exposes the durable milestone chain.",
        completedItems: ["Bind the management projection"],
        openLoops: ["Run the release gate"],
      })
    ).milestone;

    const response = await app.request(
      `/api/threads/${thread.id}/agent-milestones`,
    );
    expect(response.status).toBe(200);
    const milestones = (await response.json()) as AgentMilestone[];
    expect(milestones).toEqual([milestone]);
    expectAgentMilestoneListHeaders(response, thread.id, milestones);
  });

  it("answers and continues a durable operator decision through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Operator decision API",
      agentId: agent.id,
    });
    const originRun = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-decision-api", id: "faux-1" },
    });
    const requested = await services.store.requestOperatorDecision({
      threadId: thread.id,
      runId: originRun.id,
      header: "Scope",
      question: "Which delivery scope should continue?",
      options: [
        {
          label: "Runtime",
          description: "Continue with the runtime only.",
        },
        {
          label: "Full product",
          description: "Continue through APIs and the Workbench.",
        },
      ],
      multiSelect: false,
    });
    await services.store.finishRun(originRun.id, "completed", {
      waitForOperatorDecisionId: requested.decision.id,
    });
    const endpointPath = `/api/threads/${thread.id}/operator-decisions`;

    const listResponse = await app.request(endpointPath);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as OperatorDecision[];
    expect(listed).toEqual([requested.decision]);
    expectOperatorDecisionListHeaders(listResponse, thread.id, listed);

    const invalidAnswerResponse = await app.request(
      `${endpointPath}/${requested.decision.id}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedOptionIds: ["option_2"],
          unsupported: true,
        }),
      },
    );
    expect(invalidAnswerResponse.status).toBe(400);

    const answerResponse = await app.request(
      `${endpointPath}/${requested.decision.id}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedOptionIds: ["option_2"],
          customText: "Preserve every published API.",
        }),
      },
    );
    expect(answerResponse.status).toBe(202);
    const answered = (await answerResponse.json()) as OperatorDecision;
    expect(answered).toEqual(
      expect.objectContaining({
        status: "answered",
        selectedOptionIds: ["option_2"],
        customText: "Preserve every published API.",
      }),
    );
    expectOperatorDecisionHeaders(answerResponse, answered);

    const faux = fauxProvider({ provider: "faux-decision-api" });
    faux.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Full product");
        expect(messages).toContain("Preserve every published API.");
        return fauxAssistantMessage("Continued with the full product scope.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(faux.provider);
    const continueResponse = await app.request(
      `${endpointPath}/${requested.decision.id}/continue`,
      { method: "POST" },
    );
    expect(continueResponse.status).toBe(200);
    expect(continueResponse.headers.get("cache-control")).toBe("no-cache");
    expect(continueResponse.headers.get("x-napier-operator-decision-id")).toBe(
      requested.decision.id,
    );
    const frames = parseSseFrames(await continueResponse.text());
    expectFinalDoneMatchesSnapshot(frames);
    expect(faux.state.callCount).toBe(2);
    const continued = (
      await services.store.listOperatorDecisions(thread.id)
    )[0]!;
    expect(continued).toEqual(
      expect.objectContaining({
        status: "continued",
        continuationRunId: expect.stringMatching(/^run_/),
      }),
    );

    const cancellableRun = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-decision-api", id: "faux-1" },
    });
    const cancellable = await services.store.requestOperatorDecision({
      threadId: thread.id,
      runId: cancellableRun.id,
      header: "Retry",
      question: "Should another continuation run?",
      options: [
        { label: "Continue", description: "Start another continuation." },
        { label: "Stop", description: "Leave the work stopped." },
      ],
      multiSelect: false,
    });
    await services.store.finishRun(cancellableRun.id, "completed", {
      waitForOperatorDecisionId: cancellable.decision.id,
    });
    const cancelResponse = await app.request(
      `${endpointPath}/${cancellable.decision.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.json()).toEqual(
      expect.objectContaining({
        status: "cancelled",
        cancellationReason: "operator_cancelled",
      }),
    );
    expect(services.store.getThread(thread.id).status).toBe("idle");
  });

  it("redacts post-stream run errors into hash-only SSE diagnostics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    const response = await app.request("/api/threads/missing-thread/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Trigger a post-stream failure." }),
    });

    expect(response.status).toBe(200);
    expectThreadPromptStreamHeaders(response, "missing-thread");
    const source = await response.text();
    expect(source).toContain('"threadId":"missing-thread"');
    expect(source).not.toContain("Thread not found");
    const frames = parseSseFrames(source);
    expect(frames).toEqual([
      {
        type: "error",
        threadId: "missing-thread",
        message: "Run failed while streaming.",
        code: "run_failed",
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
  });

  it("serves and verifies usage price table refresh catalogs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);

    const catalogResponse = await app.request("/api/usage-price-tables");
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as UsagePriceTableCatalog;
    expectUsagePriceTableCatalogHeaders(catalogResponse, catalog);
    expect(catalog.tables.map((table) => table.provider)).toEqual([
      "anthropic",
      "deepseek",
      "google",
      "napier",
      "openai",
      "openrouter",
    ]);

    const verifyResponse = await app.request("/api/usage-price-tables/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        catalog,
        requiredProviders: ["openai", "google"],
      }),
    });
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as UsagePriceTableVerification;
    expectUsagePriceTableVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "valid",
        tableCount: 6,
        diagnostics: [],
      }),
    );

    const tampered = createUsagePriceTableCatalog({
      generatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    tampered.tables[0]!.inputUsdPerMillion += 1;
    const tamperedResponse = await app.request(
      "/api/usage-price-tables/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog: tampered }),
      },
    );
    expect(tamperedResponse.status).toBe(200);
    const tamperedVerification =
      (await tamperedResponse.json()) as UsagePriceTableVerification;
    expectUsagePriceTableVerificationHeaders(
      tamperedResponse,
      tamperedVerification,
    );
    expect(tamperedVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining(["catalog_hash_mismatch"]),
      }),
    );
  });

  it("strictly parses thread lifecycle and prompt request bodies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const threadCountBeforeInvalidCreate = services.store.listThreads().length;

    const invalidCreate = await app.request("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Bad wrapper", extra: true }),
    });
    expect(invalidCreate.status).toBe(400);
    expect(await invalidCreate.json()).toEqual(
      expect.objectContaining({
        error: "Thread creation request is invalid",
      }),
    );
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeInvalidCreate,
    );

    const createResponse = await app.request("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Strict body test" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as ThreadDetail;

    const invalidGoal = await app.request(
      `/api/threads/${created.thread.id}/goal`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Keep strict parsing.",
          maxContinuations: 99,
        }),
      },
    );
    expect(invalidGoal.status).toBe(400);
    expect(await invalidGoal.json()).toEqual(
      expect.objectContaining({ error: "Goal request is invalid" }),
    );

    const invalidPrompt = await app.request(
      `/api/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello", unexpected: true }),
      },
    );
    expect(invalidPrompt.status).toBe(400);
    expect(await invalidPrompt.json()).toEqual(
      expect.objectContaining({ error: "Prompt request is invalid" }),
    );

    const unconfiguredProvider = fauxProvider({
      provider: "faux-prompt-unconfigured",
    });
    services.models.registerProvider({
      ...unconfiguredProvider.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const unconfiguredPrompt = await app.request(
      `/api/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "This should fail before a Run starts.",
          model: { provider: "faux-prompt-unconfigured", id: "faux-1" },
        }),
      },
    );
    expect(unconfiguredPrompt.status).toBe(400);
    expect(await unconfiguredPrompt.json()).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-prompt-unconfigured",
      }),
    );
    expect(services.store.listRuns(created.thread.id)).toHaveLength(0);

    const invalidResume = await app.request(
      `/api/threads/${created.thread.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "runctl_invalid" }),
      },
    );
    expect(invalidResume.status).toBe(400);
    expect(await invalidResume.json()).toEqual(
      expect.objectContaining({ error: "Resume request is invalid" }),
    );
    expect(services.store.listRuns(created.thread.id)).toHaveLength(0);

    const unconfiguredResume = await app.request(
      `/api/threads/${created.thread.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-prompt-unconfigured", id: "faux-1" },
        }),
      },
    );
    expect(unconfiguredResume.status).toBe(400);
    expect(await unconfiguredResume.json()).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-prompt-unconfigured",
      }),
    );
    expect(services.store.listRuns(created.thread.id)).toHaveLength(0);

    const stopResponse = await app.request(
      `/api/threads/${created.thread.id}/stop`,
      { method: "POST" },
    );
    expect(stopResponse.status).toBe(409);
    const stopReceipt = (await stopResponse.json()) as { stopped: boolean };
    expectThreadStopHeaders(stopResponse, created.thread.id, stopReceipt);
    expect(stopReceipt).toEqual({ stopped: false });
  });

  it("serves hash-bound context checkpoint calibration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Checkpoint calibration API" }),
      })
    ).json()) as ThreadDetail;
    const run = await services.store.createRun({
      threadId: created.thread.id,
      agentId: created.agent.id,
    });
    for (let index = 1; index <= 30; index += 1) {
      const user = index % 2 === 1;
      await services.store.appendEvent({
        threadId: created.thread.id,
        runId: run.id,
        type: user ? "message.user" : "message.assistant",
        category: "message",
        visibility: "user",
        payload: {
          role: user ? "user" : "assistant",
          text: `Calibration turn ${String(index).padStart(2, "0")}.`,
        },
      });
    }
    const messageEvents = await services.store.listEvents(created.thread.id);
    const projection = planContextProjection(messageEvents, undefined, {
      maxHistoryCharacters: 100_000,
    });
    const checkpoint = createContextCheckpoint({
      checkpointId: "checkpoint-http-calibration",
      compactEvents: projection.compactEvents,
      retainedFromSeq: projection.recentEvents[0]!.seq,
      result: {
        summary: "The first twenty HTTP-seeded messages were compacted.",
        decisions: ["Expose checkpoint calibration via REST."],
        openLoops: [],
        artifacts: ["apps/server/src/app.ts"],
      },
    });
    await services.store.appendEvent({
      threadId: created.thread.id,
      runId: run.id,
      type: "context.compaction.completed",
      category: "model",
      visibility: "user",
      payload: JSON.parse(JSON.stringify(checkpoint)),
    });

    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.contextCheckpointCalibration).toEqual(
      expect.objectContaining({
        checkpointCount: 1,
        verifiedCheckpointCount: 1,
        coveredMessageCount: 20,
        latestValidCheckpointId: "checkpoint-http-calibration",
      }),
    );

    const response = await app.request(
      `/api/threads/${created.thread.id}/context-checkpoint-calibration`,
    );
    expect(response.status).toBe(200);
    const report =
      (await response.json()) as ContextCheckpointCalibrationReport;
    expectContextCheckpointCalibrationHeaders(response, report);
    expect(report.samples[0]).toEqual(
      expect.objectContaining({
        state: "verified",
        checkpointId: "checkpoint-http-calibration",
        sourceSha256: checkpoint.sourceSha256,
      }),
    );
  });

  it("audits memory proposal and approval through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Memory API test" }),
      })
    ).json()) as ThreadDetail;

    const invalidProposalResponse = await app.request("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "This invalid wrapper must not be stored.",
        category: "constraint",
        scope: "workspace",
        threadId: created.thread.id,
        unexpected: true,
      }),
    });
    expect(invalidProposalResponse.status).toBe(400);
    expect(await invalidProposalResponse.json()).toEqual(
      expect.objectContaining({
        error: "Memory proposal request is invalid",
      }),
    );
    expect(services.store.listMemories()).toHaveLength(0);

    const proposedResponse = await app.request("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "The project requires reversible migrations.",
        category: "constraint",
        scope: "workspace",
        threadId: created.thread.id,
      }),
    });
    expect(proposedResponse.status).toBe(201);
    const proposed = (await proposedResponse.json()) as MemoryFact;
    expectMemoryProjectionHeaders(proposedResponse, proposed);

    const invalidReviewResponse = await app.request(
      `/api/memories/${proposed.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidReviewResponse.status).toBe(400);
    expect(await invalidReviewResponse.json()).toEqual(
      expect.objectContaining({
        error: "Memory review request is invalid",
      }),
    );
    expect(
      services.store.listMemories().find((memory) => memory.id === proposed.id),
    ).toEqual(expect.objectContaining({ status: "proposed", revision: 1 }));

    const approvedResponse = await app.request(
      `/api/memories/${proposed.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
        }),
      },
    );
    expect(approvedResponse.status).toBe(200);
    const approved = (await approvedResponse.json()) as MemoryFact;
    expectMemoryProjectionHeaders(approvedResponse, approved);
    expect(approved).toEqual(expect.objectContaining({ status: "active" }));

    const memoryListResponse = await app.request("/api/memories");
    expect(memoryListResponse.status).toBe(200);
    const memories = (await memoryListResponse.json()) as MemoryFact[];
    expectMemoryListHeaders(memoryListResponse, memories);
    expect(memories).toEqual([
      expect.objectContaining({ id: proposed.id, status: "active" }),
    ]);

    const bootstrap = (await (await app.request("/api/bootstrap")).json()) as {
      memories: Array<{ id: string; status: string }>;
    };
    expect(bootstrap.memories).toEqual([
      expect.objectContaining({ id: proposed.id, status: "active" }),
    ]);
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["memory.proposed", "memory.approved"]),
    );
  });

  it("governs stale review and correction supersession through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Memory lifecycle API" }),
      })
    ).json()) as ThreadDetail;

    const originalResponse = await app.request("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Deployments happen on Monday.",
        category: "context",
        scope: "workspace",
        reviewIntervalDays: 30,
        threadId: created.thread.id,
      }),
    });
    expect(originalResponse.status).toBe(201);
    const original = (await originalResponse.json()) as MemoryFact;
    const approveOriginal = await app.request(
      `/api/memories/${original.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
        }),
      },
    );
    expect(approveOriginal.status).toBe(200);

    const staleResponse = await app.request(
      `/api/memories/${original.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "mark_stale",
          threadId: created.thread.id,
        }),
      },
    );
    expect((await staleResponse.json()) as MemoryFact).toEqual(
      expect.objectContaining({ status: "stale" }),
    );
    const refreshResponse = await app.request(
      `/api/memories/${original.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "refresh",
          threadId: created.thread.id,
        }),
      },
    );
    expect((await refreshResponse.json()) as MemoryFact).toEqual(
      expect.objectContaining({
        status: "active",
        reviewDueAt: expect.stringMatching(/Z$/),
      }),
    );

    const correctionResponse = await app.request("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Deployments happen on Tuesday.",
        category: "correction",
        scope: "workspace",
        reviewIntervalDays: 45,
        supersedesMemoryId: original.id,
        threadId: created.thread.id,
      }),
    });
    expect(correctionResponse.status).toBe(201);
    const correction = (await correctionResponse.json()) as MemoryFact;
    const approveCorrection = await app.request(
      `/api/memories/${correction.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
        }),
      },
    );
    expect((await approveCorrection.json()) as MemoryFact).toEqual(
      expect.objectContaining({
        id: correction.id,
        status: "active",
        supersedesMemoryId: original.id,
      }),
    );

    const bootstrap = (await (
      await app.request("/api/bootstrap")
    ).json()) as BootstrapResponse;
    expect(
      bootstrap.memories.find((memory) => memory.id === original.id),
    ).toEqual(
      expect.objectContaining({
        status: "archived",
        supersededByMemoryId: correction.id,
      }),
    );
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "memory.proposed",
        "memory.approved",
        "memory.stale",
        "memory.refreshed",
      ]),
    );
    expect(
      detail.events.find(
        (event) =>
          event.type === "memory.approved" &&
          event.payload["memoryId"] === correction.id,
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        supersedesMemoryId: original.id,
        supersededMemoryStatus: "archived",
        reviewIntervalDays: 45,
      }),
    );
  });

  it("atomically settles multi-source memory consolidation through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Memory consolidation API" }),
      })
    ).json()) as ThreadDetail;

    const sourceContents = [
      "Deployments happen on Tuesday.",
      "Deployments require a passed release review.",
    ];
    const sources: MemoryFact[] = [];
    for (const content of sourceContents) {
      const proposed = (await (
        await app.request("/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content,
            scope: "workspace",
            threadId: created.thread.id,
          }),
        })
      ).json()) as MemoryFact;
      const approved = (await (
        await app.request(`/api/memories/${proposed.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            threadId: created.thread.id,
          }),
        })
      ).json()) as MemoryFact;
      sources.push(approved);
    }

    const consolidationResponse = await app.request("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content:
          "Deployments happen on Tuesday after the release review passes.",
        category: "context",
        scope: "workspace",
        reviewIntervalDays: 45,
        consolidatesMemoryIds: sources.map((source) => source.id).reverse(),
        threadId: created.thread.id,
      }),
    });
    expect(consolidationResponse.status).toBe(201);
    const consolidation = (await consolidationResponse.json()) as MemoryFact;
    expect(consolidation).toEqual(
      expect.objectContaining({
        status: "proposed",
        consolidatesMemoryIds: sources.map((source) => source.id).sort(),
      }),
    );

    const approvalResponse = await app.request(
      `/api/memories/${consolidation.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
        }),
      },
    );
    expect(approvalResponse.status).toBe(200);
    expect((await approvalResponse.json()) as MemoryFact).toEqual(
      expect.objectContaining({
        status: "active",
        consolidatesMemoryIds: sources.map((source) => source.id).sort(),
      }),
    );

    const bootstrap = (await (
      await app.request("/api/bootstrap")
    ).json()) as BootstrapResponse;
    for (const source of sources) {
      expect(
        bootstrap.memories.find((memory) => memory.id === source.id),
      ).toEqual(
        expect.objectContaining({
          status: "archived",
          supersededByMemoryId: consolidation.id,
        }),
      );
    }
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(
      detail.events.find(
        (event) =>
          event.type === "memory.approved" &&
          event.payload["memoryId"] === consolidation.id,
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        consolidatesMemoryIds: sources.map((source) => source.id).sort(),
        consolidatedMemoryStatus: "archived",
      }),
    );
  });

  it("audits credential references and persistent Agent configuration without secret values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Secure configuration API" }),
      })
    ).json()) as ThreadDetail;

    const invalidCredentialResponse = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        label: "Bad environment",
        source: {
          type: "environment",
          variable: "NAPIER_SERVER_MISSING_KEY",
        },
        threadId: created.thread.id,
        unexpected: true,
      }),
    });
    expect(invalidCredentialResponse.status).toBe(400);
    expect(await invalidCredentialResponse.json()).toEqual(
      expect.objectContaining({
        error: "Credential reference request is invalid",
      }),
    );
    expect(services.store.listCredentialReferences()).toHaveLength(0);

    const credentialResponse = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        label: "Server environment",
        source: {
          type: "environment",
          variable: "NAPIER_SERVER_MISSING_KEY",
        },
        threadId: created.thread.id,
      }),
    });
    expect(credentialResponse.status).toBe(201);
    const credential = (await credentialResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(credentialResponse, credential);
    expect(credential).toEqual(
      expect.objectContaining({
        providerId: "openai",
        availability: "unknown",
        source: {
          type: "environment",
          variable: "NAPIER_SERVER_MISSING_KEY",
        },
      }),
    );
    expect(JSON.stringify(credential)).not.toContain('"key"');

    const credentialListResponse = await app.request("/api/credentials");
    expect(credentialListResponse.status).toBe(200);
    const credentials =
      (await credentialListResponse.json()) as CredentialReference[];
    expectCredentialReferenceListHeaders(credentialListResponse, credentials);
    expect(credentials).toEqual([credential]);

    const invalidCheckResponse = await app.request(
      `/api/credentials/${credential.id}/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidCheckResponse.status).toBe(400);
    expect(await invalidCheckResponse.json()).toEqual(
      expect.objectContaining({ error: "Credential check request is invalid" }),
    );
    expect(services.store.getCredentialReference(credential.id)).toEqual(
      expect.objectContaining({
        availability: "unknown",
        status: "active",
        revision: credential.revision,
      }),
    );

    const invalidStatusResponse = await app.request(
      `/api/credentials/${credential.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "paused",
          threadId: created.thread.id,
        }),
      },
    );
    expect(invalidStatusResponse.status).toBe(400);
    expect(await invalidStatusResponse.json()).toEqual(
      expect.objectContaining({
        error: "Credential status request is invalid",
      }),
    );
    expect(services.store.getCredentialReference(credential.id)).toEqual(
      expect.objectContaining({
        availability: "unknown",
        status: "active",
        revision: credential.revision,
      }),
    );

    const checkResponse = await app.request(
      `/api/credentials/${credential.id}/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(checkResponse.status).toBe(200);
    const checkedCredential =
      (await checkResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(checkResponse, checkedCredential);
    expect(checkedCredential).toEqual(
      expect.objectContaining({ availability: "missing" }),
    );

    const disableResponse = await app.request(
      `/api/credentials/${credential.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "disabled",
          threadId: created.thread.id,
        }),
      },
    );
    expect(disableResponse.status).toBe(200);
    const disabledCredential =
      (await disableResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(disableResponse, disabledCredential);
    expect(disabledCredential.status).toBe("disabled");

    const enableResponse = await app.request(
      `/api/credentials/${credential.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          threadId: created.thread.id,
        }),
      },
    );
    expect(enableResponse.status).toBe(200);
    const enabledCredential =
      (await enableResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(enableResponse, enabledCredential);
    expect(enabledCredential.status).toBe("active");

    const finalCheckResponse = await app.request(
      `/api/credentials/${credential.id}/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(finalCheckResponse.status).toBe(200);
    const finalCheckedCredential =
      (await finalCheckResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(
      finalCheckResponse,
      finalCheckedCredential,
    );
    expect(finalCheckedCredential).toEqual(
      expect.objectContaining({ availability: "missing" }),
    );

    const invalidAgentResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bad Agent update",
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidAgentResponse.status).toBe(400);
    expect(await invalidAgentResponse.json()).toEqual(
      expect.objectContaining({ error: "Agent profile request is invalid" }),
    );
    expect(services.store.getAgent(created.agent.id)).toEqual(
      expect.objectContaining({
        name: created.agent.name,
        revision: created.agent.revision,
      }),
    );

    const invalidPromptVariableResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptVariables: [
            {
              name: "release",
              type: "literal",
              value: "candidate",
              unexpected: true,
            },
          ],
          threadId: created.thread.id,
        }),
      },
    );
    expect(invalidPromptVariableResponse.status).toBe(400);
    expect(await invalidPromptVariableResponse.json()).toEqual(
      expect.objectContaining({ error: "Agent profile request is invalid" }),
    );

    const invalidToolLoopGuardResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolLoopGuard: {
            enabled: true,
            threshold: 1,
            exemptTools: [],
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(invalidToolLoopGuardResponse.status).toBe(400);
    expect(await invalidToolLoopGuardResponse.json()).toEqual(
      expect.objectContaining({ error: "Agent profile request is invalid" }),
    );

    const profileReviewProvider = fauxProvider({
      provider: "faux-agent-profile-review",
    });
    const unconfiguredProfileProvider = fauxProvider({
      provider: "faux-agent-profile-unconfigured",
    });
    services.models.registerProvider(profileReviewProvider.provider);
    services.models.registerProvider({
      ...unconfiguredProfileProvider.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const unconfiguredPrimaryModelResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: {
            provider: "faux-agent-profile-unconfigured",
            id: "faux-1",
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(unconfiguredPrimaryModelResponse.status).toBe(400);
    expect(await unconfiguredPrimaryModelResponse.json()).toEqual(
      expect.objectContaining({
        error:
          "Model provider is not configured: faux-agent-profile-unconfigured",
      }),
    );

    const demoAdvisorReviewModelResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-agent-profile-review", id: "faux-1" },
          modelAdvisor: {
            mode: "observe",
            enabledRules: [],
            maxCorrectionAttempts: 0,
            reviewModel: { provider: "napier", id: "demo" },
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(demoAdvisorReviewModelResponse.status).toBe(400);
    expect(await demoAdvisorReviewModelResponse.json()).toEqual(
      expect.objectContaining({
        error: "Model Advisor review model must use a live model",
      }),
    );

    const sameAdvisorReviewModelResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-agent-profile-review", id: "faux-1" },
          modelAdvisor: {
            mode: "enforce",
            enabledRules: [],
            maxCorrectionAttempts: 0,
            reviewModel: {
              provider: "faux-agent-profile-review",
              id: "faux-1",
            },
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(sameAdvisorReviewModelResponse.status).toBe(400);
    expect(await sameAdvisorReviewModelResponse.json()).toEqual(
      expect.objectContaining({
        error: "Model Advisor review model must differ from the primary model",
      }),
    );

    const missingAdvisorReviewModelResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelAdvisor: {
            mode: "observe",
            enabledRules: [],
            maxCorrectionAttempts: 0,
            reviewModel: { provider: "missing-reviewer", id: "missing-1" },
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(missingAdvisorReviewModelResponse.status).toBe(400);
    expect(await missingAdvisorReviewModelResponse.json()).toEqual(
      expect.objectContaining({
        error: "Model not found: missing-reviewer/missing-1",
      }),
    );

    const unconfiguredAdvisorReviewModelResponse = await app.request(
      `/api/agents/${created.agent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-agent-profile-review", id: "faux-1" },
          modelAdvisor: {
            mode: "observe",
            enabledRules: [],
            maxCorrectionAttempts: 0,
            reviewModel: {
              provider: "faux-agent-profile-unconfigured",
              id: "faux-1",
            },
          },
          threadId: created.thread.id,
        }),
      },
    );
    expect(unconfiguredAdvisorReviewModelResponse.status).toBe(400);
    expect(await unconfiguredAdvisorReviewModelResponse.json()).toEqual(
      expect.objectContaining({
        error:
          "Model provider is not configured: faux-agent-profile-unconfigured",
      }),
    );

    const agentResponse = await app.request(`/api/agents/${created.agent.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Napier Delivery",
        systemPrompt:
          "Preserve evidence.\nNever claim unverified side effects.",
        model: { provider: "napier", id: "demo" },
        thinkingLevel: "high",
        toolPolicy: "workspace",
        enabledTools: [
          "read_file",
          "search_files",
          "list_symbols",
          "inspect_data",
          "inspect_code",
          "apply_patch",
          "verify_workspace",
        ],
        enabledSkills: ["software-delivery", "artifact-studio"],
        enabledSubagents: ["reviewer"],
        subagentLimits: {
          maxConcurrent: 1,
          maxTotal: 3,
          maxTurns: 6,
          timeoutMs: 90_000,
        },
        runLimits: {
          maxTurns: 36,
          maxTotalTokens: 400_000,
          maxCostUsd: 12.5,
          timeoutMs: 1_200_000,
        },
        modelAdvisor: {
          mode: "enforce",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
          reviewModel: {
            provider: "faux-agent-profile-review",
            id: "faux-1",
          },
        },
        promptVariables: [
          { name: "skills", type: "skill_catalog" },
          { name: "release", type: "literal", value: "release-candidate" },
        ],
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["search_files", "read_file"],
        },
        threadId: created.thread.id,
      }),
    });
    expect(agentResponse.status).toBe(200);
    const agent = (await agentResponse.json()) as AgentProfile;
    const updatedRevision = services.store.getAgentRevision(
      created.agent.id,
      agent.revision,
    );
    expectAgentProfileHeaders(agentResponse, agent, updatedRevision);
    expect(agent).toEqual(
      expect.objectContaining({
        name: "Napier Delivery",
        revision: 2,
        toolPolicy: "workspace",
        enabledTools: [
          "apply_patch",
          "inspect_code",
          "inspect_data",
          "list_symbols",
          "read_file",
          "search_files",
          "verify_workspace",
        ],
        runLimits: {
          maxTurns: 36,
          maxTotalTokens: 400_000,
          maxCostUsd: 12.5,
          timeoutMs: 1_200_000,
        },
        modelAdvisor: {
          mode: "enforce",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
          reviewModel: {
            provider: "faux-agent-profile-review",
            id: "faux-1",
          },
        },
        promptVariables: [
          { name: "release", type: "literal", value: "release-candidate" },
          { name: "skills", type: "skill_catalog" },
        ],
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["read_file", "search_files"],
        },
      }),
    );
    const historyResponse = await app.request(
      `/api/agents/${created.agent.id}/revisions`,
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as AgentProfileRevision[];
    expectAgentRevisionListHeaders(historyResponse, created.agent.id, history);
    expect(history).toEqual([
      expect.objectContaining({
        revision: 2,
        source: "updated",
        changedFields: expect.arrayContaining([
          "name",
          "systemPrompt",
          "toolPolicy",
          "modelAdvisor",
          "promptVariables",
          "toolLoopGuard",
        ]),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        revision: 1,
        source: "created",
        profile: created.agent,
      }),
    ]);

    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as {
      agents: AgentProfile[];
      credentials: CredentialReference[];
      activeThread: ThreadDetail;
    };
    expect(bootstrap.credentials).toEqual([
      expect.objectContaining({
        id: credential.id,
        availability: "missing",
      }),
    ]);
    expect(bootstrap.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.agent.id,
          name: "Napier Delivery",
          revision: 2,
        }),
      ]),
    );
    expect(bootstrap.activeThread.agent.name).toBe("Napier Delivery");
    const detail = bootstrap.activeThread;
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "credential.reference.created",
        "credential.reference.checked",
        "agent.updated",
      ]),
    );
    const agentEvent = detail.events.find(
      (event) => event.type === "agent.updated",
    );
    expect(JSON.stringify(agentEvent?.payload)).toContain("systemPrompt");
    expect(JSON.stringify(agentEvent?.payload)).not.toContain(
      "Never claim unverified side effects",
    );
    expect(JSON.stringify(agentEvent?.payload)).not.toContain(
      "release-candidate",
    );
    expect(agentEvent?.payload).toEqual(
      expect.objectContaining({
        profileRevisionSha256: history[0]!.contentSha256,
      }),
    );

    const invalidRollbackResponse = await app.request(
      `/api/agents/${created.agent.id}/rollback`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: 1,
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidRollbackResponse.status).toBe(400);
    expect(await invalidRollbackResponse.json()).toEqual(
      expect.objectContaining({ error: "Agent rollback request is invalid" }),
    );
    expect(services.store.getAgent(created.agent.id)).toEqual(
      expect.objectContaining({
        name: "Napier Delivery",
        revision: 2,
      }),
    );

    const rollbackResponse = await app.request(
      `/api/agents/${created.agent.id}/rollback`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: 1,
          threadId: created.thread.id,
        }),
      },
    );
    expect(rollbackResponse.status).toBe(200);
    const rollback =
      (await rollbackResponse.json()) as AgentProfileRollbackResult;
    expectAgentRollbackHeaders(rollbackResponse, rollback, history[1]!);
    expect(rollback).toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({
          name: created.agent.name,
          systemPrompt: created.agent.systemPrompt,
          revision: 3,
        }),
        revision: expect.objectContaining({
          revision: 3,
          source: "rollback",
          restoredFromRevision: 1,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    const rollbackHistoryResponse = await app.request(
      `/api/agents/${created.agent.id}/revisions`,
    );
    expect(rollbackHistoryResponse.status).toBe(200);
    const rollbackHistory =
      (await rollbackHistoryResponse.json()) as AgentProfileRevision[];
    expectAgentRevisionListHeaders(
      rollbackHistoryResponse,
      created.agent.id,
      rollbackHistory,
    );
    expect(rollbackHistory.map((revision) => revision.revision)).toEqual([
      3, 2, 1,
    ]);
    const rollbackDetail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    const rollbackEvent = rollbackDetail.events.find(
      (event) => event.type === "agent.rolled_back",
    );
    expect(rollbackEvent?.payload).toEqual(
      expect.objectContaining({
        agentId: created.agent.id,
        revision: 3,
        restoredFromRevision: 1,
        profileRevisionSha256: rollback.revision.contentSha256,
        restoredSnapshotSha256: history[1]!.contentSha256,
      }),
    );
    expect(JSON.stringify(rollbackEvent?.payload)).not.toContain(
      created.agent.systemPrompt,
    );
  });

  it("writes macOS Keychain credentials without persisting secret values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const secret = "sk-server-keychain-never-persisted";
    const writes: Array<{
      service: string;
      account: string;
      secret: string;
      replaceExisting?: boolean;
    }> = [];
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
      keychain: {
        resolve: async () => secret,
        write: async (service, account, value, options) => {
          writes.push({
            service,
            account,
            secret: value,
            replaceExisting: options?.replaceExisting,
          });
        },
      },
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Keychain credential write API" }),
      })
    ).json()) as ThreadDetail;

    const invalidOldRoute = await app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "openai",
        label: "Secret on wrong route",
        source: {
          type: "macos_keychain",
          service: "dev.napier.openai",
          account: "workspace",
        },
        secret,
        threadId: created.thread.id,
      }),
    });
    expect(invalidOldRoute.status).toBe(400);
    expect(writes).toHaveLength(0);

    const keychainResponse = await app.request(
      "/api/credentials/macos-keychain",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "openai",
          label: "Server Keychain",
          service: "dev.napier.openai",
          account: "workspace",
          secret,
          replaceExisting: true,
          threadId: created.thread.id,
        }),
      },
    );
    expect(keychainResponse.status).toBe(201);
    const reference = (await keychainResponse.json()) as CredentialReference;
    expectCredentialReferenceHeaders(keychainResponse, reference);
    expect(reference).toEqual(
      expect.objectContaining({
        providerId: "openai",
        availability: "unknown",
        source: {
          type: "macos_keychain",
          service: "dev.napier.openai",
          account: "workspace",
        },
      }),
    );
    expect(writes).toEqual([
      {
        service: "dev.napier.openai",
        account: "workspace",
        secret,
        replaceExisting: true,
      },
    ]);

    const checked = await app.request(
      `/api/credentials/${reference.id}/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(checked.status).toBe(200);
    const checkedReference = (await checked.json()) as CredentialReference;
    expectCredentialReferenceHeaders(checked, checkedReference);
    expect(checkedReference).toEqual(
      expect.objectContaining({ availability: "available" }),
    );

    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as BootstrapResponse;
    const serialized = JSON.stringify(bootstrap);
    expect(serialized).toContain("dev.napier.openai");
    expect(serialized).not.toContain(secret);
    expect(bootstrap.activeThread?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "credential.reference.keychain_created",
        "credential.reference.checked",
      ]),
    );

    const persisted = await readFile(
      path.join(root, "data", "workspace.json"),
      "utf8",
    );
    expect(persisted).toContain("dev.napier.openai");
    expect(persisted).not.toContain(secret);
  });

  it("persists and executes schedules through leased Agent runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Scheduled API work" }),
      })
    ).json()) as ThreadDetail;

    const invalidCreateResponse = await app.request("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bad schedule",
        threadId: created.thread.id,
        prompt: "This should not be scheduled.",
        trigger: { type: "interval", everyMs: 60_000 },
        unexpected: true,
      }),
    });
    expect(invalidCreateResponse.status).toBe(400);
    expect(await invalidCreateResponse.json()).toEqual(
      expect.objectContaining({ error: "Schedule request is invalid" }),
    );
    expect(services.store.listSchedules(created.thread.id)).toHaveLength(0);

    const createResponse = await app.request("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Evidence review",
        threadId: created.thread.id,
        prompt: "Review durable evidence on schedule.",
        trigger: { type: "interval", everyMs: 60_000 },
      }),
    });
    expect(createResponse.status).toBe(201);
    const schedule = (await createResponse.json()) as AutomationSchedule;
    expectAutomationScheduleProjectionHeaders(createResponse, schedule);
    expect(schedule).toEqual(
      expect.objectContaining({
        threadId: created.thread.id,
        status: "active",
        overlapPolicy: "skip",
      }),
    );
    const scheduleListResponse = await app.request(
      `/api/schedules?thread=${created.thread.id}`,
    );
    expect(scheduleListResponse.status).toBe(200);
    const schedules =
      (await scheduleListResponse.json()) as AutomationSchedule[];
    expect(schedules).toEqual([schedule]);
    expectAutomationScheduleListHeaders(scheduleListResponse, schedules);

    const invalidUpdateResponse = await app.request(
      `/api/schedules/${schedule.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "paused", unexpected: true }),
      },
    );
    expect(invalidUpdateResponse.status).toBe(400);
    expect(await invalidUpdateResponse.json()).toEqual(
      expect.objectContaining({ error: "Schedule update request is invalid" }),
    );
    expect(services.store.getSchedule(schedule.id)).toEqual(
      expect.objectContaining({
        status: "active",
        revision: schedule.revision,
      }),
    );

    const tick = await services.automation.tick(new Date(schedule.nextRunAt));
    expect(tick).toEqual(
      expect.objectContaining({ claimed: 1, completed: 1, failed: 0 }),
    );
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.runs).toEqual([
      expect.objectContaining({
        source: "schedule",
        status: "completed",
        triggerId: expect.stringContaining(`schedule:${schedule.id}:`),
      }),
    ]);
    expect(detail.runs[0]?.lease).toBeUndefined();
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "schedule.created",
        "schedule.claimed",
        "schedule.completed",
      ]),
    );
    const createdEvent = detail.events.find(
      (event) => event.type === "schedule.created",
    );
    expect(JSON.stringify(createdEvent?.payload)).not.toContain(
      "Review durable evidence on schedule.",
    );

    const pauseResponse = await app.request(`/api/schedules/${schedule.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(pauseResponse.status).toBe(200);
    const pausedSchedule = (await pauseResponse.json()) as AutomationSchedule;
    expectAutomationScheduleProjectionHeaders(pauseResponse, pausedSchedule);
    expect(pausedSchedule).toEqual(
      expect.objectContaining({ status: "paused" }),
    );
    const pausedScheduleListResponse = await app.request(
      `/api/schedules?thread=${created.thread.id}`,
    );
    expect(pausedScheduleListResponse.status).toBe(200);
    const pausedSchedules =
      (await pausedScheduleListResponse.json()) as AutomationSchedule[];
    expect(pausedSchedules).toEqual([pausedSchedule]);
    expectAutomationScheduleListHeaders(
      pausedScheduleListResponse,
      pausedSchedules,
    );
    const bootstrapResponse = await app.request(
      `/api/bootstrap?thread=${created.thread.id}`,
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json()) as {
      schedules: AutomationSchedule[];
    };
    expect(bootstrap.schedules).toEqual([
      expect.objectContaining({ id: schedule.id, status: "paused" }),
    ]);
    expect(bootstrapResponse.headers.get("cache-control")).toBe("no-store");
    expect(bootstrapResponse.headers.get("x-napier-content-sha256")).toBe(
      responseSha256(bootstrap),
    );
    expect(bootstrapResponse.headers.get("x-napier-schedule-list-sha256")).toBe(
      createHash("sha256")
        .update(JSON.stringify(bootstrap.schedules))
        .digest("hex"),
    );
    expectAutomationScheduleCountHeaders(
      bootstrapResponse,
      bootstrap.schedules,
    );
  });

  it("applies inbound webhook policy templates through the public API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Webhook policy templates" }),
      })
    ).json()) as ThreadDetail;

    const invalidConflict = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Confused webhook",
        threadId: created.thread.id,
        policyTemplate: "signed_standard",
        retryPolicy: { maxAttempts: 4, baseDelayMs: 1_000 },
      }),
    });
    expect(invalidConflict.status).toBe(400);
    expect(await invalidConflict.json()).toEqual(
      expect.objectContaining({ error: "Inbound channel request is invalid" }),
    );
    expect(services.store.listInboundChannels()).toHaveLength(0);

    const invalidAdapterResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Unknown adapter webhook",
        threadId: created.thread.id,
        adapter: "slack_webhook",
        policyTemplate: "signed_standard",
      }),
    });
    expect(invalidAdapterResponse.status).toBe(400);
    expect(await invalidAdapterResponse.json()).toEqual(
      expect.objectContaining({ error: "Inbound channel request is invalid" }),
    );
    expect(services.store.listInboundChannels()).toHaveLength(0);

    const adapterCatalogResponse = await app.request("/api/channels/adapters");
    expect(adapterCatalogResponse.status).toBe(200);
    const adapterCatalog =
      (await adapterCatalogResponse.json()) as InboundChannelAdapterDescriptor[];
    expectInboundChannelAdapterCatalogHeaders(
      adapterCatalogResponse,
      adapterCatalog,
    );
    expect(adapterCatalog.map((adapter) => adapter.id)).toEqual([
      "napier_json",
      "github_webhook",
      "slack_event",
      "linear_webhook",
    ]);
    expect(adapterCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github_webhook",
          requiredHeaders: ["x-github-delivery", "x-github-event"],
          sampleHeaders: expect.objectContaining({
            "x-github-event": "pull_request",
          }),
          sampleBody: expect.stringContaining("pull_request"),
        }),
        expect.objectContaining({
          id: "linear_webhook",
          idempotencySource: expect.stringContaining("webhookId"),
          sampleBody: expect.stringContaining("Preview Linear webhook mapping"),
        }),
      ]),
    );

    const templateResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Strict webhook",
        threadId: created.thread.id,
        policyTemplate: "signed_strict",
      }),
    });
    expect(templateResponse.status).toBe(201);
    const templateChannel =
      (await templateResponse.json()) as CreatedInboundChannel;
    expect(templateChannel.channel).toEqual(
      expect.objectContaining({
        adapter: "napier_json",
        policyTemplate: "signed_strict",
        retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000 },
        signaturePolicy: expect.objectContaining({
          required: true,
          toleranceSeconds: 60,
        }),
      }),
    );
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(
      detail.events.find((event) => event.type === "channel.created")?.payload,
    ).toEqual(
      expect.objectContaining({
        channelId: templateChannel.channel.id,
        adapter: "napier_json",
        policyTemplate: "signed_strict",
        retryMaxAttempts: 2,
        signatureToleranceSeconds: 60,
      }),
    );
    const bootstrapResponse = await app.request(
      `/api/bootstrap?thread=${created.thread.id}`,
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = (await bootstrapResponse.json()) as BootstrapResponse;
    expect(bootstrap.inboundChannelAdapters).toEqual(adapterCatalog);
    expect(bootstrap.inboundChannelAdapterCatalogSha256).toBe(
      adapterCatalogResponse.headers.get("x-napier-content-sha256"),
    );
    expect(bootstrapResponse.headers.get("cache-control")).toBe("no-store");
    expect(bootstrapResponse.headers.get("x-napier-content-sha256")).toBe(
      responseSha256(bootstrap),
    );
    expectInboundChannelCountHeaders(bootstrapResponse, bootstrap.channels);
    expect(bootstrapResponse.headers.get("x-napier-channel-list-sha256")).toBe(
      createHash("sha256")
        .update(JSON.stringify(bootstrap.channels))
        .digest("hex"),
    );
    expect(
      bootstrapResponse.headers.get("x-napier-adapter-catalog-sha256"),
    ).toBe(bootstrap.inboundChannelAdapterCatalogSha256);
    expect(bootstrapResponse.headers.get("x-napier-adapter-count")).toBe(
      String(bootstrap.inboundChannelAdapters.length),
    );
    expect(bootstrapResponse.headers.get("x-napier-adapter-ids-sha256")).toBe(
      adapterIdsSha256(bootstrap.inboundChannelAdapters),
    );
    expect(JSON.stringify(templateChannel)).not.toContain("tokenSha256");
  });

  it("normalizes GitHub webhook deliveries through an inbound channel adapter", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "GitHub webhook adapter" }),
      })
    ).json()) as ThreadDetail;

    const channelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Repository events",
        threadId: created.thread.id,
        adapter: "github_webhook",
        policyTemplate: "signed_standard",
      }),
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as CreatedInboundChannel;
    expect(channel.channel).toEqual(
      expect.objectContaining({
        adapter: "github_webhook",
        policyTemplate: "signed_standard",
        signaturePolicy: expect.objectContaining({ required: true }),
      }),
    );

    const deliveryId = "70f6e0d0-3a2f-49f1-9c70-8e29e20fdb11";
    const githubBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "acme/widgets" },
      pull_request: {
        number: 42,
        title: "Add adapter receipts",
        html_url: "https://github.com/acme/widgets/pull/42",
      },
      sender: { login: "octocat" },
    });
    const invalidPreviewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: githubBody,
          headers: { "x-github-event": "pull_request" },
        }),
      },
    );
    expect(invalidPreviewResponse.status).toBe(400);
    expect(await invalidPreviewResponse.json()).toEqual(
      expect.objectContaining({ error: "GitHub delivery header is required" }),
    );
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );

    const previewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: githubBody,
          headers: {
            "x-github-delivery": deliveryId,
            "x-github-event": "pull_request",
          },
        }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview =
      (await previewResponse.json()) as InboundChannelAdapterPreview;
    expectInboundChannelAdapterPreviewHeaders(previewResponse, preview);
    expect(preview).toEqual(
      expect.objectContaining({
        channelId: channel.channel.id,
        adapter: "github_webhook",
        bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        messagePreview: expect.stringContaining(
          "GitHub pull_request webhook received.",
        ),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(previewResponse.headers.get("x-napier-content-sha256")).toBe(
      preview.contentSha256,
    );
    const { contentSha256: _previewContentSha256, ...previewContent } = preview;
    expect(preview.contentSha256).toBe(
      createHash("sha256").update(JSON.stringify(previewContent)).digest("hex"),
    );
    expect(JSON.stringify(preview)).not.toContain(deliveryId);
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );
    expect(services.store.listRuns(created.thread.id)).toEqual([]);

    const missingDeliveryTimestamp = new Date().toISOString();
    const missingDelivery = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": missingDeliveryTimestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            missingDeliveryTimestamp,
            githubBody,
          ),
          "x-github-event": "pull_request",
        },
        body: githubBody,
      },
    );
    expect(missingDelivery.status).toBe(400);
    expect(await missingDelivery.json()).toEqual(
      expect.objectContaining({ error: "GitHub delivery header is required" }),
    );

    const timestamp = new Date().toISOString();
    const acceptedResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            timestamp,
            githubBody,
          ),
          "x-github-delivery": deliveryId,
          "x-github-event": "pull_request",
        },
        body: githubBody,
      },
    );
    expect(acceptedResponse.status).toBe(202);
    const accepted = (await acceptedResponse.json()) as InboundReceipt;
    expect(accepted.delivery).toEqual(
      expect.objectContaining({
        idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        bodySha256: preview.bodySha256,
        adapterCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        maxAttempts: 3,
        retryBaseMs: 5_000,
      }),
    );
    await services.channels.drain();

    const replacementBody = JSON.stringify({
      action: "closed",
      repository: { full_name: "acme/widgets" },
    });
    const duplicateTimestamp = new Date().toISOString();
    const duplicateResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": duplicateTimestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            duplicateTimestamp,
            replacementBody,
          ),
          "x-github-delivery": deliveryId,
          "x-github-event": "pull_request",
        },
        body: replacementBody,
      },
    );
    expect(duplicateResponse.status).toBe(200);
    const duplicateReceipt = (await duplicateResponse.json()) as InboundReceipt;
    expect(duplicateReceipt).toEqual({
      delivery: expect.objectContaining({ id: accepted.delivery.id }),
      duplicate: true,
    });
    expect(duplicateReceipt.delivery.bodySha256).toBe(preview.bodySha256);
    expect(services.store.listRuns(created.thread.id)).toEqual([
      expect.objectContaining({
        source: "channel",
        triggerId: accepted.delivery.triggerId,
        status: "completed",
      }),
    ]);

    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as BootstrapResponse;
    expect(bootstrap.channels).toEqual([
      expect.objectContaining({
        id: channel.channel.id,
        adapter: "github_webhook",
      }),
    ]);
    expect(accepted.delivery.adapterCatalogSha256).toBe(
      bootstrap.inboundChannelAdapterCatalogSha256,
    );
    expect(
      bootstrap.activeThread!.events.find(
        (event) => event.type === "channel.delivery.accepted",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        adapter: "github_webhook",
        bodySha256: preview.bodySha256,
        adapterCatalogSha256: bootstrap.inboundChannelAdapterCatalogSha256,
      }),
    );
    const qualificationResponse = await app.request(
      `/api/channels/${channel.channel.id}/deliveries/${accepted.delivery.id}/qualification`,
    );
    expect(qualificationResponse.status).toBe(200);
    const qualification =
      (await qualificationResponse.json()) as InboundDeliveryQualification;
    expectInboundDeliveryQualificationHeaders(
      qualificationResponse,
      qualification,
    );
    expect(qualification).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: channel.channel.id,
        deliveryId: accepted.delivery.id,
        status: "qualified",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bodySha256: preview.bodySha256,
        adapterCatalogSha256: bootstrap.inboundChannelAdapterCatalogSha256,
        currentAdapterCatalogSha256:
          bootstrap.inboundChannelAdapterCatalogSha256,
        diagnostics: expect.arrayContaining([
          "Inbound delivery evidence is present and matches the current adapter catalog.",
        ]),
      }),
    );
    expect(JSON.stringify(bootstrap)).not.toContain(channel.token);
    expect(JSON.stringify(bootstrap.activeThread!.events)).not.toContain(
      deliveryId,
    );
    expect(JSON.stringify(bootstrap.activeThread!.events)).toContain(
      "github_webhook",
    );
  });

  it("normalizes Slack event deliveries through an inbound channel adapter", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Slack event adapter" }),
      })
    ).json()) as ThreadDetail;

    const channelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Slack events",
        threadId: created.thread.id,
        adapter: "slack_event",
        policyTemplate: "signed_standard",
      }),
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as CreatedInboundChannel;
    expect(channel.channel).toEqual(
      expect.objectContaining({
        adapter: "slack_event",
        policyTemplate: "signed_standard",
      }),
    );

    const eventId = "Ev0123456789";
    const slackBody = JSON.stringify({
      team_id: "T01234567",
      api_app_id: "A01234567",
      type: "event_callback",
      event_id: eventId,
      event_time: 1_785_000_000,
      event: {
        type: "message",
        channel: "C01234567",
        user: "U01234567",
        text: "Preview this Slack event without accepting it.",
        event_ts: "1785000000.000000",
      },
    });
    const invalidPreviewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: JSON.stringify({ type: "event_callback" }),
        }),
      },
    );
    expect(invalidPreviewResponse.status).toBe(400);
    expect(await invalidPreviewResponse.json()).toEqual(
      expect.objectContaining({ error: "Slack event_id is required" }),
    );
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );

    const previewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: slackBody }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview =
      (await previewResponse.json()) as InboundChannelAdapterPreview;
    expectInboundChannelAdapterPreviewHeaders(previewResponse, preview);
    expect(preview).toEqual(
      expect.objectContaining({
        channelId: channel.channel.id,
        adapter: "slack_event",
        idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        messagePreview: expect.stringContaining(
          "Slack message webhook received.",
        ),
      }),
    );
    expect(JSON.stringify(preview)).not.toContain(eventId);
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );
    expect(services.store.listRuns(created.thread.id)).toEqual([]);

    const timestamp = new Date().toISOString();
    const acceptedResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            timestamp,
            slackBody,
          ),
        },
        body: slackBody,
      },
    );
    expect(acceptedResponse.status).toBe(202);
    const accepted = (await acceptedResponse.json()) as InboundReceipt;
    await services.channels.drain();

    const duplicateTimestamp = new Date().toISOString();
    const duplicateResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": duplicateTimestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            duplicateTimestamp,
            slackBody,
          ),
        },
        body: slackBody,
      },
    );
    expect(duplicateResponse.status).toBe(200);
    expect((await duplicateResponse.json()) as InboundReceipt).toEqual({
      delivery: expect.objectContaining({ id: accepted.delivery.id }),
      duplicate: true,
    });

    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as BootstrapResponse;
    expect(bootstrap.channels).toEqual([
      expect.objectContaining({
        id: channel.channel.id,
        adapter: "slack_event",
      }),
    ]);
    expect(JSON.stringify(bootstrap)).not.toContain(channel.token);
    expect(JSON.stringify(bootstrap.activeThread!.events)).not.toContain(
      eventId,
    );
    expect(JSON.stringify(bootstrap.activeThread!.events)).toContain(
      "slack_event",
    );
  });

  it("normalizes Linear webhook deliveries through an inbound channel adapter", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Linear webhook adapter" }),
      })
    ).json()) as ThreadDetail;

    const channelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Linear events",
        threadId: created.thread.id,
        adapter: "linear_webhook",
        policyTemplate: "signed_standard",
      }),
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as CreatedInboundChannel;
    expect(channel.channel).toEqual(
      expect.objectContaining({
        adapter: "linear_webhook",
        policyTemplate: "signed_standard",
      }),
    );

    const webhookId = "wh_0123456789";
    const linearBody = JSON.stringify({
      action: "update",
      type: "Issue",
      webhookId,
      createdAt: "2026-07-25T21:00:00.000Z",
      organizationId: "org_0123456789",
      data: {
        id: "issue_0123456789",
        identifier: "NAP-42",
        title: "Preview Linear webhook mapping",
        url: "https://linear.app/acme/issue/NAP-42",
        state: { name: "In Progress" },
        assignee: { name: "Ada Lovelace" },
        team: { key: "NAP", name: "Napier" },
        project: { name: "Agent operations" },
      },
    });
    const invalidPreviewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: JSON.stringify({
            action: "update",
            type: "Issue",
            webhookId,
          }),
        }),
      },
    );
    expect(invalidPreviewResponse.status).toBe(400);
    expect(await invalidPreviewResponse.json()).toEqual(
      expect.objectContaining({
        error: "Linear webhook timestamp is required",
      }),
    );
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );

    const previewResponse = await app.request(
      `/api/channels/${channel.channel.id}/adapter-preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: linearBody }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview =
      (await previewResponse.json()) as InboundChannelAdapterPreview;
    expectInboundChannelAdapterPreviewHeaders(previewResponse, preview);
    expect(preview).toEqual(
      expect.objectContaining({
        channelId: channel.channel.id,
        adapter: "linear_webhook",
        idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{12}$/),
        messagePreview: expect.stringContaining(
          "Linear Issue update webhook received.",
        ),
      }),
    );
    expect(JSON.stringify(preview)).not.toContain(webhookId);
    expect(services.store.listInboundDeliveries(channel.channel.id)).toEqual(
      [],
    );
    expect(services.store.listRuns(created.thread.id)).toEqual([]);

    const timestamp = new Date().toISOString();
    const acceptedResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            timestamp,
            linearBody,
          ),
        },
        body: linearBody,
      },
    );
    expect(acceptedResponse.status).toBe(202);
    const accepted = (await acceptedResponse.json()) as InboundReceipt;
    await services.channels.drain();

    const duplicateTimestamp = new Date().toISOString();
    const duplicateResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
          "x-napier-channel-timestamp": duplicateTimestamp,
          "x-napier-channel-signature": inboundSignature(
            channel.token,
            duplicateTimestamp,
            linearBody,
          ),
        },
        body: linearBody,
      },
    );
    expect(duplicateResponse.status).toBe(200);
    expect((await duplicateResponse.json()) as InboundReceipt).toEqual({
      delivery: expect.objectContaining({ id: accepted.delivery.id }),
      duplicate: true,
    });

    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as BootstrapResponse;
    expect(bootstrap.channels).toEqual([
      expect.objectContaining({
        id: channel.channel.id,
        adapter: "linear_webhook",
      }),
    ]);
    expect(JSON.stringify(bootstrap)).not.toContain(channel.token);
    expect(JSON.stringify(bootstrap.activeThread!.events)).not.toContain(
      webhookId,
    );
    expect(JSON.stringify(bootstrap.activeThread!.events)).toContain(
      "linear_webhook",
    );
  });

  it("accepts authenticated webhook deliveries exactly once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Webhook API work" }),
      })
    ).json()) as ThreadDetail;

    const invalidChannelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bad webhook",
        threadId: created.thread.id,
        retryPolicy: {
          maxAttempts: 4,
          baseDelayMs: 1_000,
        },
        unexpected: true,
      }),
    });
    expect(invalidChannelResponse.status).toBe(400);
    expect(await invalidChannelResponse.json()).toEqual(
      expect.objectContaining({ error: "Inbound channel request is invalid" }),
    );
    expect(services.store.listInboundChannels()).toHaveLength(0);

    const channelResponse = await app.request("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "CI webhook",
        threadId: created.thread.id,
        retryPolicy: {
          maxAttempts: 4,
          baseDelayMs: 1_000,
        },
        signaturePolicy: {
          required: true,
          toleranceSeconds: 300,
        },
      }),
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as CreatedInboundChannel;
    expectInboundChannelProjectionHeaders(channelResponse, channel.channel);
    expect(channelResponse.headers.get("x-napier-content-sha256")).toBe(null);
    expect(channel.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(channel.channel.policyTemplate).toBe("custom");
    expect(channel.channel.retryPolicy).toEqual({
      maxAttempts: 4,
      baseDelayMs: 1_000,
    });
    expect(channel.channel.signaturePolicy).toEqual({
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    });
    const channelListResponse = await app.request("/api/channels");
    expect(channelListResponse.status).toBe(200);
    const listedChannels =
      (await channelListResponse.json()) as CreatedInboundChannel["channel"][];
    expect(listedChannels).toEqual([channel.channel]);
    expect(JSON.stringify(listedChannels)).not.toContain(channel.token);
    expectInboundChannelListHeaders(channelListResponse, listedChannels);

    const invalidStatusResponse = await app.request(
      `/api/channels/${channel.channel.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      },
    );
    expect(invalidStatusResponse.status).toBe(400);
    expect(await invalidStatusResponse.json()).toEqual(
      expect.objectContaining({
        error: "Inbound channel status request is invalid",
      }),
    );
    expect(services.store.getInboundChannel(channel.channel.id)).toEqual(
      expect.objectContaining({
        status: "active",
        revision: channel.channel.revision,
      }),
    );
    const disabledStatusResponse = await app.request(
      `/api/channels/${channel.channel.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    expect(disabledStatusResponse.status).toBe(200);
    const disabledChannel =
      (await disabledStatusResponse.json()) as CreatedInboundChannel["channel"];
    expectInboundChannelProjectionHeaders(
      disabledStatusResponse,
      disabledChannel,
      {
        includeContentSha256: true,
      },
    );
    expect(disabledChannel).toEqual(
      expect.objectContaining({
        status: "disabled",
        revision: channel.channel.revision + 1,
      }),
    );
    const disabledChannelListResponse = await app.request("/api/channels");
    expect(disabledChannelListResponse.status).toBe(200);
    const disabledListedChannels =
      (await disabledChannelListResponse.json()) as CreatedInboundChannel["channel"][];
    expect(disabledListedChannels).toEqual([disabledChannel]);
    expectInboundChannelListHeaders(
      disabledChannelListResponse,
      disabledListedChannels,
    );
    const activeStatusResponse = await app.request(
      `/api/channels/${channel.channel.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    expect(activeStatusResponse.status).toBe(200);
    const activeChannel =
      (await activeStatusResponse.json()) as CreatedInboundChannel["channel"];
    expectInboundChannelProjectionHeaders(activeStatusResponse, activeChannel, {
      includeContentSha256: true,
    });
    expect(activeChannel).toEqual(
      expect.objectContaining({
        status: "active",
        revision: disabledChannel.revision + 1,
      }),
    );
    const activeChannelListResponse = await app.request("/api/channels");
    expect(activeChannelListResponse.status).toBe(200);
    const activeListedChannels =
      (await activeChannelListResponse.json()) as CreatedInboundChannel["channel"][];
    expect(activeListedChannels).toEqual([activeChannel]);
    expectInboundChannelListHeaders(
      activeChannelListResponse,
      activeListedChannels,
    );

    const invalidPolicyResponse = await app.request(
      `/api/channels/${channel.channel.id}/retry-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          retryPolicy: { maxAttempts: 0, baseDelayMs: 100 },
        }),
      },
    );
    expect(invalidPolicyResponse.status).toBe(400);
    expect(await invalidPolicyResponse.json()).toEqual(
      expect.objectContaining({
        error: "Inbound retry policy request is invalid",
      }),
    );
    expect(services.store.getInboundChannel(channel.channel.id)).toEqual(
      expect.objectContaining({
        retryPolicy: { maxAttempts: 4, baseDelayMs: 1_000 },
        revision: activeChannel.revision,
      }),
    );

    const invalidPolicyWrapperResponse = await app.request(
      `/api/channels/${channel.channel.id}/retry-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          retryPolicy: { maxAttempts: 2, baseDelayMs: 250 },
          unexpected: true,
        }),
      },
    );
    expect(invalidPolicyWrapperResponse.status).toBe(400);
    expect(services.store.getInboundChannel(channel.channel.id)).toEqual(
      expect.objectContaining({
        retryPolicy: { maxAttempts: 4, baseDelayMs: 1_000 },
        revision: activeChannel.revision,
      }),
    );

    const policyResponse = await app.request(
      `/api/channels/${channel.channel.id}/retry-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          retryPolicy: { maxAttempts: 2, baseDelayMs: 250 },
        }),
      },
    );
    expect(policyResponse.status).toBe(200);
    const policyChannel =
      (await policyResponse.json()) as CreatedInboundChannel["channel"];
    expectInboundChannelProjectionHeaders(policyResponse, policyChannel, {
      includeContentSha256: true,
    });
    expect(policyChannel).toEqual(
      expect.objectContaining({
        retryPolicy: { maxAttempts: 2, baseDelayMs: 250 },
        revision: activeChannel.revision + 1,
      }),
    );

    const invalidSignaturePolicyResponse = await app.request(
      `/api/channels/${channel.channel.id}/signature-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signaturePolicy: { required: true, toleranceSeconds: 10 },
        }),
      },
    );
    expect(invalidSignaturePolicyResponse.status).toBe(400);
    expect(await invalidSignaturePolicyResponse.json()).toEqual(
      expect.objectContaining({
        error: "Inbound signature policy request is invalid",
      }),
    );
    expect(services.store.getInboundChannel(channel.channel.id)).toEqual(
      expect.objectContaining({
        signaturePolicy: expect.objectContaining({ toleranceSeconds: 300 }),
        revision: policyChannel.revision,
      }),
    );

    const invalidSignaturePolicyWrapperResponse = await app.request(
      `/api/channels/${channel.channel.id}/signature-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signaturePolicy: { required: true, toleranceSeconds: 30 },
          unexpected: true,
        }),
      },
    );
    expect(invalidSignaturePolicyWrapperResponse.status).toBe(400);
    expect(services.store.getInboundChannel(channel.channel.id)).toEqual(
      expect.objectContaining({
        signaturePolicy: expect.objectContaining({ toleranceSeconds: 300 }),
        revision: policyChannel.revision,
      }),
    );

    const signaturePolicyResponse = await app.request(
      `/api/channels/${channel.channel.id}/signature-policy`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signaturePolicy: { required: true, toleranceSeconds: 30 },
        }),
      },
    );
    expect(signaturePolicyResponse.status).toBe(200);
    const signaturePolicyChannel =
      (await signaturePolicyResponse.json()) as CreatedInboundChannel["channel"];
    expectInboundChannelProjectionHeaders(
      signaturePolicyResponse,
      signaturePolicyChannel,
      { includeContentSha256: true },
    );
    expect(signaturePolicyChannel).toEqual(
      expect.objectContaining({
        signaturePolicy: expect.objectContaining({
          required: true,
          toleranceSeconds: 30,
        }),
        revision: policyChannel.revision + 1,
      }),
    );

    const rotateResponse = await app.request(
      `/api/channels/${channel.channel.id}/token`,
      { method: "POST" },
    );
    expect(rotateResponse.status).toBe(200);
    const rotated = (await rotateResponse.json()) as CreatedInboundChannel;
    expectInboundChannelProjectionHeaders(rotateResponse, rotated.channel);
    expect(rotateResponse.headers.get("x-napier-content-sha256")).toBe(null);
    expect(rotated.channel).toEqual(
      expect.objectContaining({
        id: channel.channel.id,
        revision: signaturePolicyChannel.revision + 1,
      }),
    );
    expect(rotated.channel.tokenFingerprint).not.toBe(
      channel.channel.tokenFingerprint,
    );
    expect(rotated.token).not.toBe(channel.token);

    const body = JSON.stringify({
      idempotencyKey: "ci-delivery-2026-07-25-0001",
      message: "Review the inbound CI result.",
    });
    const unauthorized = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${channel.token}`,
        },
        body,
      },
    );
    expect(unauthorized.status).toBe(401);

    const unsigned = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`,
        },
        body,
      },
    );
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual(
      expect.objectContaining({
        error: "Inbound channel signature is invalid",
      }),
    );

    const expiredTimestamp = new Date(
      Date.now() - 10 * 60 * 1_000,
    ).toISOString();
    const expired = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`,
          "x-napier-channel-timestamp": expiredTimestamp,
          "x-napier-channel-signature": inboundSignature(
            rotated.token,
            expiredTimestamp,
            body,
          ),
        },
        body,
      },
    );
    expect(expired.status).toBe(401);

    const timestamp = new Date().toISOString();
    const acceptedResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rotated.token}`,
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": inboundSignature(
            rotated.token,
            timestamp,
            body,
          ),
        },
        body,
      },
    );
    expect(acceptedResponse.status).toBe(202);
    const accepted = (await acceptedResponse.json()) as InboundReceipt;
    expectInboundReceiptHeaders(acceptedResponse, accepted);
    expect(accepted.delivery).toEqual(
      expect.objectContaining({
        maxAttempts: 2,
        retryBaseMs: 250,
      }),
    );
    expect(accepted.delivery.triggerId).toBe(
      `channel:${channel.channel.id}:${accepted.delivery.id}`,
    );
    await services.channels.drain();
    const duplicateResponse = await app.request(
      `/api/channels/${channel.channel.id}/inbound`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-napier-channel-token": rotated.token,
          "x-napier-channel-timestamp": timestamp,
          "x-napier-channel-signature": inboundSignature(
            rotated.token,
            timestamp,
            body,
          ),
        },
        body,
      },
    );
    expect(duplicateResponse.status).toBe(200);
    const duplicateReceipt = (await duplicateResponse.json()) as InboundReceipt;
    expectInboundReceiptHeaders(duplicateResponse, duplicateReceipt);
    expect(duplicateReceipt).toEqual({
      delivery: expect.objectContaining({ id: accepted.delivery.id }),
      duplicate: true,
    });

    const deliveriesResponse = await app.request(
      `/api/channels/${channel.channel.id}/deliveries`,
    );
    expect(deliveriesResponse.status).toBe(200);
    const deliveries =
      (await deliveriesResponse.json()) as InboundReceipt["delivery"][];
    expectInboundDeliveryListHeaders(
      deliveriesResponse,
      channel.channel.id,
      deliveries,
    );
    expect(deliveries).toEqual([
      expect.objectContaining({
        id: accepted.delivery.id,
        status: "completed",
        attemptCount: 1,
      }),
    ]);
    const completedRetryResponse = await app.request(
      `/api/channels/${channel.channel.id}/deliveries/${accepted.delivery.id}/retry`,
      { method: "POST" },
    );
    expect(completedRetryResponse.status).toBe(409);

    const qualificationThread = await services.store.createThread({
      title: "Delivery qualification fixtures",
      agentId: services.store.listAgents()[0]!.id,
    });
    const qualificationChannel = await services.store.createInboundChannel({
      name: "Qualification fixtures",
      threadId: qualificationThread.id,
    });

    const missingEvidenceReceipt = await services.store.acceptInboundDelivery(
      qualificationChannel.channel.id,
      qualificationChannel.token,
      {
        idempotencyKey: "ci-delivery-2026-07-25-missing-evidence",
        message: "Preserve legacy delivery qualification semantics.",
      },
    );
    const missingEvidenceQualification = await app.request(
      `/api/channels/${qualificationChannel.channel.id}/deliveries/${missingEvidenceReceipt.delivery.id}/qualification`,
    );
    expect(missingEvidenceQualification.status).toBe(200);
    const missingEvidence =
      (await missingEvidenceQualification.json()) as InboundDeliveryQualification;
    expectInboundDeliveryQualificationHeaders(
      missingEvidenceQualification,
      missingEvidence,
    );
    expect(missingEvidence).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: qualificationChannel.channel.id,
        deliveryId: missingEvidenceReceipt.delivery.id,
        status: "evidence_missing",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        currentAdapterCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnostics: expect.arrayContaining([
          "Inbound body SHA-256 evidence is missing.",
          "Inbound adapter catalog SHA-256 evidence is missing.",
        ]),
      }),
    );

    const driftReceipt = await services.store.acceptInboundDelivery(
      qualificationChannel.channel.id,
      qualificationChannel.token,
      {
        idempotencyKey: "ci-delivery-2026-07-25-catalog-drift",
        message: "Detect parser catalog drift for this delivery.",
        bodySha256: "c".repeat(64),
        adapterCatalogSha256: "d".repeat(64),
      },
    );
    const driftQualification = await app.request(
      `/api/channels/${qualificationChannel.channel.id}/deliveries/${driftReceipt.delivery.id}/qualification`,
    );
    expect(driftQualification.status).toBe(200);
    const drift =
      (await driftQualification.json()) as InboundDeliveryQualification;
    expectInboundDeliveryQualificationHeaders(driftQualification, drift);
    expect(drift).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: qualificationChannel.channel.id,
        deliveryId: driftReceipt.delivery.id,
        status: "adapter_catalog_drift",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bodySha256: "c".repeat(64),
        adapterCatalogSha256: "d".repeat(64),
        currentAdapterCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnostics: expect.arrayContaining([
          "Inbound adapter catalog SHA-256 differs from the current server catalog.",
        ]),
      }),
    );
    const missingDeliveryQualification = await app.request(
      `/api/channels/${qualificationChannel.channel.id}/deliveries/missing-delivery/qualification`,
    );
    expect(missingDeliveryQualification.status).toBe(404);
    const missingDeliveryError =
      (await missingDeliveryQualification.json()) as { error: string };
    expect(missingDeliveryError).toEqual({
      error: "Inbound delivery not found",
    });
    expectJsonErrorProjectionHeaders(
      missingDeliveryQualification,
      missingDeliveryError,
      404,
    );
    await services.store.claimInboundDelivery(
      missingEvidenceReceipt.delivery.id,
    );
    await services.store.finishInboundDelivery(
      missingEvidenceReceipt.delivery.id,
      {
        status: "failed",
        error: "Fixture settled outside dispatcher.",
      },
    );
    await services.store.claimInboundDelivery(driftReceipt.delivery.id);
    await services.store.finishInboundDelivery(driftReceipt.delivery.id, {
      status: "failed",
      error: "Fixture settled outside dispatcher.",
    });
    const manualRetryResponse = await app.request(
      `/api/channels/${qualificationChannel.channel.id}/deliveries/${missingEvidenceReceipt.delivery.id}/retry`,
      { method: "POST" },
    );
    expect(manualRetryResponse.status).toBe(202);
    const manualRetry =
      (await manualRetryResponse.json()) as InboundReceipt["delivery"];
    expectInboundDeliveryProjectionHeaders(manualRetryResponse, manualRetry);
    expect(manualRetry).toEqual(
      expect.objectContaining({
        id: missingEvidenceReceipt.delivery.id,
        status: "retrying",
        attemptCount: 1,
        nextAttemptAt: expect.any(String),
      }),
    );
    await services.channels.drain();

    const failedReceipt = await services.store.acceptInboundDelivery(
      channel.channel.id,
      rotated.token,
      {
        idempotencyKey: "ci-delivery-2026-07-25-retry",
        message: "Retry this delivery only after operator review.",
        bodySha256: "e".repeat(64),
        adapterCatalogSha256: "f".repeat(64),
      },
    );
    await services.store.claimInboundDelivery(failedReceipt.delivery.id);
    await services.store.finishInboundDelivery(failedReceipt.delivery.id, {
      status: "failed",
      error: "Operator-visible delivery failure.",
    });
    const deadLetterResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/export`,
      { method: "POST" },
    );
    expect(deadLetterResponse.status).toBe(200);
    expect(deadLetterResponse.headers.get("cache-control")).toBe("no-store");
    expect(deadLetterResponse.headers.get("content-disposition")).toMatch(
      /^attachment; filename="napier-dead-letters-/,
    );
    const deadLetters =
      (await deadLetterResponse.json()) as InboundDeadLetterExport;
    expectInboundDeadLetterExportHeaders(deadLetterResponse, deadLetters);
    expect(deadLetterResponse.headers.get("x-napier-content-sha256")).toBe(
      deadLetters.contentSha256,
    );
    expect(deadLetterResponse.headers.get("x-napier-delivery-count")).toBe("1");
    expect(
      deadLetterResponse.headers.get("x-napier-current-adapter-catalog-sha256"),
    ).toBe(deadLetters.currentAdapterCatalogSha256);
    expect(deadLetterResponse.headers.get("x-napier-qualified-count")).toBe(
      "0",
    );
    expect(
      deadLetterResponse.headers.get("x-napier-evidence-missing-count"),
    ).toBe("0");
    expect(
      deadLetterResponse.headers.get("x-napier-adapter-catalog-drift-count"),
    ).toBe("1");
    expect(deadLetters).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        currentAdapterCatalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        qualifiedCount: 0,
        evidenceMissingCount: 0,
        adapterCatalogDriftCount: 1,
        deliveryCount: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        deliveries: [
          expect.objectContaining({
            deliveryId: failedReceipt.delivery.id,
            retryDisposition: "manual_retry_available",
            qualificationStatus: "adapter_catalog_drift",
            messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bodySha256: "e".repeat(64),
            adapterCatalogSha256: "f".repeat(64),
          }),
        ],
      }),
    );
    expect(JSON.stringify(deadLetters)).not.toContain(
      "Retry this delivery only after operator review.",
    );
    expect(JSON.stringify(deadLetters)).not.toContain(
      "ci-delivery-2026-07-25-retry",
    );
    const verifyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/verify`,
      {
        method: "POST",
        body: JSON.stringify({ artifact: deadLetters }),
      },
    );
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("cache-control")).toBe("no-store");
    const verification =
      (await verifyResponse.json()) as InboundDeadLetterExportVerification;
    expectInboundDeadLetterExportVerificationHeaders(
      verifyResponse,
      verification,
    );
    expect(verifyResponse.headers.get("x-napier-content-sha256")).toBe(
      verification.contentSha256,
    );
    expect(verifyResponse.headers.get("x-napier-verification-status")).toBe(
      "valid",
    );
    expect(verifyResponse.headers.get("x-napier-observed-delivery-count")).toBe(
      String(deadLetters.deliveryCount),
    );
    expect(
      verifyResponse.headers.get("x-napier-observed-qualified-count"),
    ).toBe(String(deadLetters.qualifiedCount));
    expect(
      verifyResponse.headers.get("x-napier-observed-evidence-missing-count"),
    ).toBe(String(deadLetters.evidenceMissingCount));
    expect(
      verifyResponse.headers.get(
        "x-napier-observed-adapter-catalog-drift-count",
      ),
    ).toBe(String(deadLetters.adapterCatalogDriftCount));
    expect(verification).toEqual(
      expect.objectContaining({
        status: "valid",
        channelId: channel.channel.id,
        expectedChannelId: channel.channel.id,
        declaredContentSha256: deadLetters.contentSha256,
        recomputedContentSha256: deadLetters.contentSha256,
        deliveryCount: deadLetters.deliveryCount,
        observedDeliveryCount: deadLetters.deliveryCount,
        qualifiedCount: deadLetters.qualifiedCount,
        observedQualifiedCount: deadLetters.qualifiedCount,
        evidenceMissingCount: deadLetters.evidenceMissingCount,
        observedEvidenceMissingCount: deadLetters.evidenceMissingCount,
        adapterCatalogDriftCount: deadLetters.adapterCatalogDriftCount,
        observedAdapterCatalogDriftCount: deadLetters.adapterCatalogDriftCount,
      }),
    );
    const tamperedVerifyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/verify`,
      {
        method: "POST",
        body: JSON.stringify({
          artifact: {
            ...deadLetters,
            adapterCatalogDriftCount: 0,
          },
        }),
      },
    );
    expect(tamperedVerifyResponse.status).toBe(200);
    expect(
      tamperedVerifyResponse.headers.get("x-napier-verification-status"),
    ).toBe("invalid");
    expect(
      tamperedVerifyResponse.headers.get("x-napier-observed-delivery-count"),
    ).toBe(String(deadLetters.deliveryCount));
    expect(
      tamperedVerifyResponse.headers.get("x-napier-observed-qualified-count"),
    ).toBe(String(deadLetters.qualifiedCount));
    expect(
      tamperedVerifyResponse.headers.get(
        "x-napier-observed-evidence-missing-count",
      ),
    ).toBe(String(deadLetters.evidenceMissingCount));
    expect(
      tamperedVerifyResponse.headers.get(
        "x-napier-observed-adapter-catalog-drift-count",
      ),
    ).toBe(String(deadLetters.adapterCatalogDriftCount));
    expect(await tamperedVerifyResponse.json()).toEqual(
      expect.objectContaining({
        status: "invalid",
        adapterCatalogDriftCount: 0,
        observedAdapterCatalogDriftCount: 1,
      }),
    );
    const retryPreviewResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-preview`,
      {
        method: "POST",
        body: JSON.stringify({ artifact: deadLetters }),
      },
    );
    expect(retryPreviewResponse.status).toBe(200);
    expect(retryPreviewResponse.headers.get("cache-control")).toBe("no-store");
    const retryPreview =
      (await retryPreviewResponse.json()) as InboundDeadLetterRetryPreview;
    expectInboundDeadLetterRetryPreviewHeaders(
      retryPreviewResponse,
      retryPreview,
    );
    expect(retryPreviewResponse.headers.get("x-napier-content-sha256")).toBe(
      retryPreview.contentSha256,
    );
    expect(
      retryPreviewResponse.headers.get("x-napier-verification-status"),
    ).toBe("valid");
    expect(retryPreviewResponse.headers.get("x-napier-artifact-sha256")).toBe(
      deadLetters.contentSha256,
    );
    expect(retryPreviewResponse.headers.get("x-napier-retryable-count")).toBe(
      "1",
    );
    expect(retryPreviewResponse.headers.get("x-napier-blocked-count")).toBe(
      "0",
    );
    expect(retryPreview).toEqual(
      expect.objectContaining({
        verificationStatus: "valid",
        artifactSha256: deadLetters.contentSha256,
        retryableCount: 1,
        blockedCount: 0,
        candidateSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retryableDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        blockedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        candidates: [
          expect.objectContaining({
            deliveryId: failedReceipt.delivery.id,
            status: "retryable",
            attemptCount: 1,
            maxAttempts: 2,
          }),
        ],
      }),
    );
    expect(
      retryPreviewResponse.headers.get("x-napier-candidate-set-sha256"),
    ).toBe(retryPreview.candidateSetSha256);
    expect(
      retryPreviewResponse.headers.get(
        "x-napier-retryable-delivery-ids-sha256",
      ),
    ).toBe(retryPreview.retryableDeliveryIdsSha256);
    expect(
      retryPreviewResponse.headers.get("x-napier-blocked-delivery-ids-sha256"),
    ).toBe(retryPreview.blockedDeliveryIdsSha256);
    const emptyRetryHistoryResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-history`,
    );
    expect(emptyRetryHistoryResponse.status).toBe(200);
    const emptyRetryHistory =
      (await emptyRetryHistoryResponse.json()) as InboundDeadLetterRetryHistory;
    expect(emptyRetryHistory).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: channel.channel.id,
        eventCount: 0,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        records: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectInboundDeadLetterRetryHistoryHeaders(
      emptyRetryHistoryResponse,
      emptyRetryHistory,
      channel.channel.threadId,
    );
    const unconfirmedApplyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-apply`,
      {
        method: "POST",
        body: JSON.stringify({
          artifact: deadLetters,
          expectedPreviewSha256: retryPreview.contentSha256,
          confirmReplay: false,
        }),
      },
    );
    expect(unconfirmedApplyResponse.status).toBe(409);
    const retryApplyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-apply`,
      {
        method: "POST",
        body: JSON.stringify({
          artifact: deadLetters,
          expectedPreviewSha256: retryPreview.contentSha256,
          confirmReplay: true,
        }),
      },
    );
    expect(retryApplyResponse.status).toBe(202);
    expect(retryApplyResponse.headers.get("cache-control")).toBe("no-store");
    const retryApply =
      (await retryApplyResponse.json()) as InboundDeadLetterRetryApplyResult;
    expectInboundDeadLetterRetryApplyResultHeaders(
      retryApplyResponse,
      retryApply,
    );
    expect(retryApplyResponse.headers.get("x-napier-content-sha256")).toBe(
      retryApply.contentSha256,
    );
    expect(retryApplyResponse.headers.get("x-napier-preview-sha256")).toBe(
      retryPreview.contentSha256,
    );
    expect(retryApplyResponse.headers.get("x-napier-artifact-sha256")).toBe(
      deadLetters.contentSha256,
    );
    expect(retryApplyResponse.headers.get("x-napier-retried-count")).toBe("1");
    expect(retryApplyResponse.headers.get("x-napier-skipped-count")).toBe("0");
    expect(retryApply).toEqual(
      expect.objectContaining({
        previewSha256: retryPreview.contentSha256,
        artifactSha256: deadLetters.contentSha256,
        previewCandidateSetSha256: retryPreview.candidateSetSha256,
        previewRetryableDeliveryIdsSha256:
          retryPreview.retryableDeliveryIdsSha256,
        previewBlockedDeliveryIdsSha256: retryPreview.blockedDeliveryIdsSha256,
        retriedCount: 1,
        skippedCount: 0,
        retriedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        skippedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        deliveries: [
          expect.objectContaining({
            id: failedReceipt.delivery.id,
            status: "retrying",
            attemptCount: 1,
            maxAttempts: 2,
            retryBaseMs: 250,
          }),
        ],
      }),
    );
    expect(
      retryApplyResponse.headers.get("x-napier-preview-candidate-set-sha256"),
    ).toBe(retryApply.previewCandidateSetSha256);
    expect(
      retryApplyResponse.headers.get(
        "x-napier-preview-retryable-delivery-ids-sha256",
      ),
    ).toBe(retryApply.previewRetryableDeliveryIdsSha256);
    expect(
      retryApplyResponse.headers.get(
        "x-napier-preview-blocked-delivery-ids-sha256",
      ),
    ).toBe(retryApply.previewBlockedDeliveryIdsSha256);
    expect(
      retryApplyResponse.headers.get("x-napier-retried-delivery-ids-sha256"),
    ).toBe(retryApply.retriedDeliveryIdsSha256);
    expect(
      retryApplyResponse.headers.get("x-napier-skipped-delivery-ids-sha256"),
    ).toBe(retryApply.skippedDeliveryIdsSha256);
    const retryHistoryResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-history`,
    );
    expect(retryHistoryResponse.status).toBe(200);
    expect(retryHistoryResponse.headers.get("cache-control")).toBe("no-store");
    expect(retryHistoryResponse.headers.get("content-disposition")).toMatch(
      /^attachment; filename="napier-dead-letter-retry-history-/,
    );
    const retryHistory =
      (await retryHistoryResponse.json()) as InboundDeadLetterRetryHistory;
    expectInboundDeadLetterRetryHistoryHeaders(
      retryHistoryResponse,
      retryHistory,
      channel.channel.threadId,
    );
    expect(retryHistoryResponse.headers.get("x-napier-content-sha256")).toBe(
      retryHistory.contentSha256,
    );
    expect(retryHistoryResponse.headers.get("x-napier-event-set-sha256")).toBe(
      retryHistory.eventSetSha256,
    );
    expect(retryHistoryResponse.headers.get("x-napier-event-count")).toBe(
      String(retryHistory.eventCount),
    );
    expect(retryHistory).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        channelId: channel.channel.id,
        eventCount: 1,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        records: [
          expect.objectContaining({
            channelId: channel.channel.id,
            applyResultSha256: retryApply.contentSha256,
            previewSha256: retryPreview.contentSha256,
            artifactSha256: deadLetters.contentSha256,
            previewCandidateSetSha256: retryPreview.candidateSetSha256,
            previewRetryableDeliveryIdsSha256:
              retryPreview.retryableDeliveryIdsSha256,
            previewBlockedDeliveryIdsSha256:
              retryPreview.blockedDeliveryIdsSha256,
            retriedCount: 1,
            skippedCount: 0,
            retriedDeliveryIdsSha256: retryApply.retriedDeliveryIdsSha256,
            skippedDeliveryIdsSha256: retryApply.skippedDeliveryIdsSha256,
          }),
        ],
      }),
    );
    const retryHistoryVerifyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-history/verify`,
      {
        method: "POST",
        body: JSON.stringify({ history: retryHistory }),
      },
    );
    expect(retryHistoryVerifyResponse.status).toBe(200);
    expect(retryHistoryVerifyResponse.headers.get("cache-control")).toBe(
      "no-store",
    );
    const retryHistoryVerification =
      (await retryHistoryVerifyResponse.json()) as InboundDeadLetterRetryHistoryVerification;
    expectInboundDeadLetterRetryHistoryVerificationHeaders(
      retryHistoryVerifyResponse,
      retryHistoryVerification,
    );
    expect(
      retryHistoryVerifyResponse.headers.get("x-napier-content-sha256"),
    ).toBe(retryHistoryVerification.contentSha256);
    expect(
      retryHistoryVerifyResponse.headers.get("x-napier-verification-status"),
    ).toBe("valid");
    expect(
      retryHistoryVerifyResponse.headers.get(
        "x-napier-observed-content-sha256",
      ),
    ).toBe(retryHistory.contentSha256);
    expect(
      retryHistoryVerifyResponse.headers.get(
        "x-napier-observed-event-set-sha256",
      ),
    ).toBe(retryHistory.eventSetSha256);
    expect(retryHistoryVerification).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        status: "valid",
        channelId: channel.channel.id,
        expectedChannelId: channel.channel.id,
        declaredContentSha256: retryHistory.contentSha256,
        recomputedContentSha256: retryHistory.contentSha256,
        observedContentSha256: retryHistory.contentSha256,
        declaredEventSetSha256: retryHistory.eventSetSha256,
        observedEventSetSha256: retryHistory.eventSetSha256,
        eventCount: retryHistory.eventCount,
        observedEventCount: retryHistory.eventCount,
      }),
    );
    const tamperedRetryHistoryVerifyResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-history/verify`,
      {
        method: "POST",
        body: JSON.stringify({
          history: {
            ...retryHistory,
            eventSetSha256: "0".repeat(64),
          },
        }),
      },
    );
    expect(tamperedRetryHistoryVerifyResponse.status).toBe(200);
    const tamperedRetryHistoryVerification =
      (await tamperedRetryHistoryVerifyResponse.json()) as InboundDeadLetterRetryHistoryVerification;
    expectInboundDeadLetterRetryHistoryVerificationHeaders(
      tamperedRetryHistoryVerifyResponse,
      tamperedRetryHistoryVerification,
    );
    expect(
      tamperedRetryHistoryVerifyResponse.headers.get(
        "x-napier-verification-status",
      ),
    ).toBe("invalid");
    expect(
      tamperedRetryHistoryVerifyResponse.headers.get(
        "x-napier-observed-content-sha256",
      ),
    ).toBe(retryHistory.contentSha256);
    expect(
      tamperedRetryHistoryVerifyResponse.headers.get(
        "x-napier-observed-event-set-sha256",
      ),
    ).toBe(retryHistory.eventSetSha256);
    expect(tamperedRetryHistoryVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        declaredEventSetSha256: "0".repeat(64),
        observedEventSetSha256: retryHistory.eventSetSha256,
      }),
    );
    const refreshedPreviewResponse = await app.request(
      `/api/channels/${channel.channel.id}/dead-letters/retry-preview`,
      {
        method: "POST",
        body: JSON.stringify({ artifact: deadLetters }),
      },
    );
    expect(refreshedPreviewResponse.status).toBe(200);
    const refreshedPreview =
      (await refreshedPreviewResponse.json()) as InboundDeadLetterRetryPreview;
    expectInboundDeadLetterRetryPreviewHeaders(
      refreshedPreviewResponse,
      refreshedPreview,
    );
    expect(refreshedPreview).toEqual(
      expect.objectContaining({
        retryableCount: 0,
        blockedCount: 1,
        retryableDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        blockedDeliveryIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        candidates: [
          expect.objectContaining({
            deliveryId: failedReceipt.delivery.id,
            status: "not_failed",
          }),
        ],
      }),
    );
    await services.channels.drain();
    expect(
      services.store
        .listInboundDeliveries(channel.channel.id)
        .find((delivery) => delivery.id === failedReceipt.delivery.id),
    ).toEqual(
      expect.objectContaining({
        status: "completed",
        attemptCount: 2,
        runId: expect.any(String),
      }),
    );
    const channelRuns = services.store
      .listRuns(created.thread.id)
      .filter((run) => run.source === "channel");
    expect(channelRuns).toHaveLength(2);
    expect(
      channelRuns.find((run) =>
        run.triggerId?.endsWith(`${failedReceipt.delivery.id}:attempt:2`),
      ),
    ).toEqual(expect.objectContaining({ status: "completed" }));
    const bootstrap = (await (
      await app.request(`/api/bootstrap?thread=${created.thread.id}`)
    ).json()) as BootstrapResponse;
    expect(bootstrap.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: channel.channel.id,
          tokenFingerprint: rotated.channel.tokenFingerprint,
          retryPolicy: { maxAttempts: 2, baseDelayMs: 250 },
        }),
      ]),
    );
    expect(JSON.stringify(bootstrap)).not.toContain(channel.token);
    expect(JSON.stringify(bootstrap)).not.toContain(rotated.token);
    const channelEvents = bootstrap.activeThread!.events.filter(
      (event) => event.category === "channel",
    );
    expect(channelEvents.map((event) => event.type)).toContain(
      "channel.token.rotated",
    );
    expect(channelEvents.map((event) => event.type)).toContain(
      "channel.delivery.retry.requested",
    );
    expect(channelEvents.map((event) => event.type)).toContain(
      "channel.retry_policy.updated",
    );
    expect(channelEvents.map((event) => event.type)).toContain(
      "channel.dead_letters.exported",
    );
    expect(channelEvents.map((event) => event.type)).toContain(
      "channel.dead_letters.retry_applied",
    );
    expect(
      channelEvents.find(
        (event) => event.type === "channel.dead_letters.exported",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        currentAdapterCatalogSha256: deadLetters.currentAdapterCatalogSha256,
        qualifiedCount: deadLetters.qualifiedCount,
        evidenceMissingCount: deadLetters.evidenceMissingCount,
        adapterCatalogDriftCount: deadLetters.adapterCatalogDriftCount,
      }),
    );
    expect(
      channelEvents.find(
        (event) => event.type === "channel.dead_letters.retry_applied",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        applyResultSha256: retryApply.contentSha256,
        previewSha256: retryPreview.contentSha256,
        artifactSha256: deadLetters.contentSha256,
        previewCandidateSetSha256: retryPreview.candidateSetSha256,
        previewRetryableDeliveryIdsSha256:
          retryPreview.retryableDeliveryIdsSha256,
        previewBlockedDeliveryIdsSha256: retryPreview.blockedDeliveryIdsSha256,
        retriedCount: 1,
        skippedCount: 0,
        retriedDeliveryIdsSha256: retryApply.retriedDeliveryIdsSha256,
        skippedDeliveryIdsSha256: retryApply.skippedDeliveryIdsSha256,
      }),
    );
    const retryAppliedEvent = channelEvents.find(
      (event) => event.type === "channel.dead_letters.retry_applied",
    );
    expect(retryHistory).toEqual(
      expect.objectContaining({
        fromSeq: retryAppliedEvent?.seq,
        toSeq: retryAppliedEvent?.seq,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(channelEvents)).not.toContain(
      "ci-delivery-2026-07-25-0001",
    );
    expect(JSON.stringify(retryHistory)).not.toContain(
      "ci-delivery-2026-07-25-retry",
    );
    expect(JSON.stringify(retryHistory)).not.toContain(
      "Retry this delivery only after operator review.",
    );
    expect(JSON.stringify(channelEvents)).not.toContain(channel.token);
    expect(JSON.stringify(channelEvents)).not.toContain(rotated.token);
  });

  it("persists plan, step, and artifact evidence through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await mkdir(services.store.workspaceRoot, { recursive: true });
    const reportContents = "# Verified report\n\nRuntime-observed evidence.\n";
    await writeFile(
      path.join(services.store.workspaceRoot, "report.md"),
      reportContents,
      "utf8",
    );
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Plan API test" }),
      })
    ).json()) as ThreadDetail;
    const run = await services.store.createRun({
      threadId: created.thread.id,
      agentId: created.agent.id,
    });

    const invalidCreateResponse = await app.request(
      `/api/threads/${created.thread.id}/plans`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Invalid plan.",
          steps: [],
          unexpected: true,
        }),
      },
    );
    expect(invalidCreateResponse.status).toBe(400);
    await expect(invalidCreateResponse.json()).resolves.toEqual({
      error: "Execution plan request is invalid",
    });

    const createResponse = await app.request(
      `/api/threads/${created.thread.id}/plans`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Produce a verified report.",
          steps: [
            {
              id: "produce",
              title: "Produce report",
              description: "Produce the report artifact.",
              verification: "The report digest is recorded.",
            },
          ],
          artifacts: [
            {
              id: "report",
              path: "report.md",
              description: "The verified report.",
            },
          ],
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    let plan = (await createResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(createResponse, plan);
    const invalidReplanResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/replan`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: plan.revision,
          strategy: "scope_change",
          reason: "Invalid replan.",
          evidence: "The request carries an unknown field.",
          unexpected: true,
        }),
      },
    );
    expect(invalidReplanResponse.status).toBe(400);
    await expect(invalidReplanResponse.json()).resolves.toEqual({
      error: "Plan replan request is invalid",
    });

    const replanResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/replan`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: plan.revision,
          strategy: "scope_change",
          reason: "The work now needs a lightweight audit step.",
          evidence: "The audit became a required acceptance signal.",
          addSteps: [
            {
              id: "audit",
              title: "Audit report",
              description: "Audit the produced report.",
              verification: "The audit note is recorded.",
              dependsOn: ["produce"],
            },
          ],
          addArtifacts: [
            {
              id: "audit-note",
              path: "audit.md",
              description: "The audit note for the report.",
            },
          ],
        }),
      },
    );
    expect(replanResponse.status).toBe(200);
    plan = (await replanResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(replanResponse, plan);
    expect(plan.replans).toEqual([
      expect.objectContaining({
        strategy: "scope_change",
        addedStepIds: ["audit"],
        addedArtifactIds: ["audit-note"],
        fromRevision: 1,
        toRevision: 2,
        replanSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);

    const invalidStepResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/produce`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance" }),
      },
    );
    expect(invalidStepResponse.status).toBe(400);
    await expect(invalidStepResponse.json()).resolves.toEqual({
      error: "Plan step transition request is invalid",
    });

    const startResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/produce`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", runId: run.id }),
      },
    );
    expect(startResponse.status).toBe(200);
    const startedPlan = (await startResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(startResponse, startedPlan);
    expect(startedPlan.steps.find((step) => step.id === "produce")).toEqual(
      expect.objectContaining({ status: "running", runId: run.id }),
    );
    const completeResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/produce`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          evidence: "The report was produced and inspected.",
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    const completedPlan = (await completeResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(completeResponse, completedPlan);
    expect(completedPlan).toEqual(
      expect.objectContaining({ status: "active" }),
    );

    const invalidArtifactResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/artifacts/report`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          sha256: "not-a-sha",
          evidence: "Invalid digest.",
        }),
      },
    );
    expect(invalidArtifactResponse.status).toBe(400);
    await expect(invalidArtifactResponse.json()).resolves.toEqual({
      error: "Plan artifact request is invalid",
    });
    const invalidObservedArtifactResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/artifacts/report`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          observeWorkspace: true,
          sha256: "a".repeat(64),
          evidence: "Observed verification must not accept self-reported hash.",
        }),
      },
    );
    expect(invalidObservedArtifactResponse.status).toBe(400);
    await expect(invalidObservedArtifactResponse.json()).resolves.toEqual({
      error: "Plan artifact request is invalid",
    });
    expect(
      services.store
        .getPlan(plan.id)
        .artifacts.find((artifact) => artifact.id === "report"),
    ).toEqual(expect.objectContaining({ status: "expected" }));

    const producedArtifactResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/artifacts/report`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "produced",
          sourceRunId: run.id,
          evidence: "The report file was produced.",
        }),
      },
    );
    expect(producedArtifactResponse.status).toBe(200);
    const producedArtifactPlan =
      (await producedArtifactResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(producedArtifactResponse, producedArtifactPlan);
    const artifactResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/artifacts/report`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          observeWorkspace: true,
          sourceRunId: run.id,
          evidence: "The server verified the report bytes from the workspace.",
        }),
      },
    );
    const artifactResponseText = await artifactResponse.text();
    expect(artifactResponse.status, artifactResponseText).toBe(200);
    const artifactPlan = JSON.parse(artifactResponseText) as ExecutionPlan;
    expectExecutionPlanHeaders(artifactResponse, artifactPlan);
    const expectedReportSha256 = createHash("sha256")
      .update(reportContents)
      .digest("hex");
    expect(artifactPlan).toEqual(
      expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            id: "report",
            status: "verified",
            sha256: expectedReportSha256,
            sizeBytes: Buffer.byteLength(reportContents),
          }),
        ]),
      }),
    );
    await services.store.finishRun(run.id, "completed");

    const listResponse = await app.request(
      `/api/threads/${created.thread.id}/plans`,
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as ExecutionPlan[];
    expectExecutionPlanListHeaders(listResponse, created.thread.id, listed);
    expect(listed).toHaveLength(1);
    const archiveResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/archive`,
    );
    expect(archiveResponse.status).toBe(200);
    const archive = (await archiveResponse.json()) as ExecutionPlanArchive;
    expectExecutionPlanArchiveHeaders(archiveResponse, archive);
    expect(archive).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-archive",
        threadId: created.thread.id,
        plan: expect.objectContaining({
          id: plan.id,
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              id: "report",
              status: "verified",
              sha256: expectedReportSha256,
            }),
          ]),
        }),
        events: expect.arrayContaining([
          expect.objectContaining({ type: "plan.created" }),
          expect.objectContaining({ type: "plan.replanned" }),
          expect.objectContaining({ type: "plan.artifact.verified" }),
        ]),
      }),
    );

    const verifyArchiveResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/archive/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive }),
      },
    );
    expect(verifyArchiveResponse.status).toBe(200);
    const archiveVerification =
      (await verifyArchiveResponse.json()) as ExecutionPlanArchiveVerification;
    expect(archiveVerification.status).toBe("valid");
    expectExecutionPlanArchiveVerificationHeaders(
      verifyArchiveResponse,
      archiveVerification,
    );

    const invalidArchiveRequest = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/archive/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive, unexpected: true }),
      },
    );
    expect(invalidArchiveRequest.status).toBe(400);
    await expect(invalidArchiveRequest.json()).resolves.toEqual({
      error: "Execution plan archive verification request is invalid",
    });

    const otherThread = await services.store.createThread({
      title: "Other plan archive",
      agentId: created.agent.id,
    });
    const otherPlan = await services.store.createPlan(otherThread.id, {
      objective: "Export another plan archive.",
      steps: [
        {
          id: "other",
          title: "Other",
          description: "Other plan.",
          verification: "Other plan verifies.",
        },
      ],
    });
    const otherArchiveResponse = await app.request(
      `/api/threads/${otherThread.id}/plans/${otherPlan.id}/archive`,
    );
    expect(otherArchiveResponse.status).toBe(200);
    const otherArchive =
      (await otherArchiveResponse.json()) as ExecutionPlanArchive;
    const mismatchResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/archive/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: otherArchive }),
      },
    );
    expect(mismatchResponse.status).toBe(200);
    const mismatch =
      (await mismatchResponse.json()) as ExecutionPlanArchiveVerification;
    expect(mismatch).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["path_mismatch"],
        threadId: otherThread.id,
        planId: otherPlan.id,
      }),
    );
    expectExecutionPlanArchiveVerificationHeaders(mismatchResponse, mismatch);

    const blueprintResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/blueprint`,
    );
    expect(blueprintResponse.status).toBe(200);
    const blueprint =
      (await blueprintResponse.json()) as ExecutionPlanBlueprint;
    expectExecutionPlanBlueprintHeaders(blueprintResponse, blueprint);
    expect(blueprint).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint",
        objective: expect.stringContaining("Produce a verified report"),
        source: expect.objectContaining({
          threadId: created.thread.id,
          planId: plan.id,
          planArchiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "produce" }),
          expect.objectContaining({ id: "audit" }),
        ]),
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            id: "report",
            path: "report.md",
          }),
          expect.objectContaining({
            id: "audit-note",
            path: "audit.md",
          }),
        ]),
      }),
    );

    const verifyBlueprintResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/blueprints/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint }),
      },
    );
    expect(verifyBlueprintResponse.status).toBe(200);
    const blueprintVerification =
      (await verifyBlueprintResponse.json()) as ExecutionPlanBlueprintVerification;
    expect(blueprintVerification.status).toBe("valid");
    expectExecutionPlanBlueprintVerificationHeaders(
      verifyBlueprintResponse,
      blueprintVerification,
    );

    const invalidBlueprintRequest = await app.request(
      `/api/threads/${created.thread.id}/plans/blueprints/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint, unexpected: true }),
      },
    );
    expect(invalidBlueprintRequest.status).toBe(400);
    await expect(invalidBlueprintRequest.json()).resolves.toEqual({
      error: "Execution plan blueprint verification request is invalid",
    });

    const blueprintThread = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blueprint target" }),
      })
    ).json()) as ThreadDetail;
    const createFromBlueprintResponse = await app.request(
      `/api/threads/${blueprintThread.thread.id}/plans/from-blueprint`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blueprint,
          objective: "Reuse the verified report workflow.",
        }),
      },
    );
    expect(createFromBlueprintResponse.status).toBe(201);
    const blueprintPlan =
      (await createFromBlueprintResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(createFromBlueprintResponse, blueprintPlan);
    expectExecutionPlanBlueprintSourceHeaders(
      createFromBlueprintResponse,
      blueprint,
    );
    expect(blueprintPlan).toEqual(
      expect.objectContaining({
        threadId: blueprintThread.thread.id,
        objective: "Reuse the verified report workflow.",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "produce" }),
          expect.objectContaining({ id: "audit", dependsOn: ["produce"] }),
        ]),
      }),
    );
    expect(
      (await services.store.listEvents(blueprintThread.thread.id)).map(
        (event) => event.payload,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blueprintSha256: blueprint.contentSha256,
          blueprintSourcePlanId: plan.id,
          blueprintSourceArchiveSha256: blueprint.source.planArchiveSha256,
        }),
      ]),
    );

    const saveBlueprintResponse = await app.request(
      `/api/threads/${created.thread.id}/plan-blueprints`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blueprint,
          name: "Verified report workflow",
          description: "Reusable report workflow for future ledgers.",
        }),
      },
    );
    expect(saveBlueprintResponse.status).toBe(201);
    const savedBlueprint =
      (await saveBlueprintResponse.json()) as SaveExecutionPlanBlueprintResult;
    expect(savedBlueprint.created).toBe(true);
    expectExecutionPlanBlueprintSaveResultHeaders(
      saveBlueprintResponse,
      savedBlueprint,
    );

    const duplicateBlueprintResponse = await app.request(
      `/api/threads/${created.thread.id}/plan-blueprints`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint, name: "Duplicate ignored" }),
      },
    );
    expect(duplicateBlueprintResponse.status).toBe(200);
    const duplicateBlueprint =
      (await duplicateBlueprintResponse.json()) as SaveExecutionPlanBlueprintResult;
    expect(duplicateBlueprint).toEqual({
      created: false,
      record: savedBlueprint.record,
    });

    const blueprintListResponse = await app.request("/api/plan-blueprints");
    expect(blueprintListResponse.status).toBe(200);
    const blueprintList =
      (await blueprintListResponse.json()) as ExecutionPlanBlueprintRecord[];
    expectExecutionPlanBlueprintRecordListHeaders(
      blueprintListResponse,
      blueprintList,
    );
    expect(blueprintList).toEqual([savedBlueprint.record]);

    const blueprintQualificationResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/qualification`,
    );
    expect(blueprintQualificationResponse.status).toBe(200);
    const blueprintQualification =
      (await blueprintQualificationResponse.json()) as ExecutionPlanBlueprintRecordQualification;
    expect(blueprintQualification).toEqual(
      expect.objectContaining({
        status: "qualified",
        diagnostics: [],
        recordId: savedBlueprint.record.id,
        blueprintSha256: savedBlueprint.record.blueprintSha256,
        expectedPlanArchiveSha256:
          savedBlueprint.record.sourcePlanArchiveSha256,
        expectedEventStreamSha256:
          savedBlueprint.record.sourceEventStreamSha256,
        actualPlanArchiveSha256: savedBlueprint.record.sourcePlanArchiveSha256,
        actualEventStreamSha256: savedBlueprint.record.sourceEventStreamSha256,
      }),
    );
    expectExecutionPlanBlueprintRecordQualificationHeaders(
      blueprintQualificationResponse,
      blueprintQualification,
    );

    const archivedBlueprintResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      },
    );
    expect(archivedBlueprintResponse.status).toBe(200);
    const archivedBlueprint =
      (await archivedBlueprintResponse.json()) as ExecutionPlanBlueprintRecord;
    expectExecutionPlanBlueprintRecordHeaders(
      archivedBlueprintResponse,
      archivedBlueprint,
    );
    expect(archivedBlueprint.status).toBe("archived");

    const archivedBlueprintQualificationResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/qualification`,
    );
    expect(archivedBlueprintQualificationResponse.status).toBe(200);
    const archivedBlueprintQualification =
      (await archivedBlueprintQualificationResponse.json()) as ExecutionPlanBlueprintRecordQualification;
    expect(archivedBlueprintQualification).toEqual(
      expect.objectContaining({
        status: "archived",
        diagnostics: ["record_archived"],
        recordId: savedBlueprint.record.id,
      }),
    );
    expectExecutionPlanBlueprintRecordQualificationHeaders(
      archivedBlueprintQualificationResponse,
      archivedBlueprintQualification,
    );

    const restoredBlueprintResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    expect(restoredBlueprintResponse.status).toBe(200);
    const restoredBlueprint =
      (await restoredBlueprintResponse.json()) as ExecutionPlanBlueprintRecord;
    expect(restoredBlueprint.status).toBe("active");
    expect(restoredBlueprint.archivedAt).toBeUndefined();

    const recordThread = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blueprint record target" }),
      })
    ).json()) as ThreadDetail;
    const previewFromRecordResponse = await app.request(
      `/api/threads/${recordThread.thread.id}/plans/from-blueprint-record/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId: savedBlueprint.record.id }),
      },
    );
    expect(previewFromRecordResponse.status).toBe(200);
    const previewFromRecord =
      (await previewFromRecordResponse.json()) as ExecutionPlanBlueprintRecordPreview;
    expect(previewFromRecord).toEqual(
      expect.objectContaining({
        status: "ready",
        diagnostics: [],
        threadId: recordThread.thread.id,
        recordId: savedBlueprint.record.id,
        hasOpenPlan: false,
        plan: expect.objectContaining({
          threadId: recordThread.thread.id,
          objective: blueprint.objective,
        }),
      }),
    );
    expectExecutionPlanBlueprintRecordPreviewHeaders(
      previewFromRecordResponse,
      previewFromRecord,
    );

    const stalePreviewCreateResponse = await app.request(
      `/api/threads/${recordThread.thread.id}/plans/from-blueprint-record`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordId: savedBlueprint.record.id,
          expectedPreviewSha256: "0".repeat(64),
        }),
      },
    );
    expect(stalePreviewCreateResponse.status).toBe(409);
    const stalePreview =
      (await stalePreviewCreateResponse.json()) as ExecutionPlanBlueprintRecordPreview;
    expect(stalePreview.previewSha256).toBe(previewFromRecord.previewSha256);
    expectExecutionPlanBlueprintRecordPreviewHeaders(
      stalePreviewCreateResponse,
      stalePreview,
    );

    const createFromRecordResponse = await app.request(
      `/api/threads/${recordThread.thread.id}/plans/from-blueprint-record`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordId: savedBlueprint.record.id,
          expectedPreviewSha256: previewFromRecord.previewSha256,
        }),
      },
    );
    expect(createFromRecordResponse.status).toBe(201);
    const recordPlan = (await createFromRecordResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(createFromRecordResponse, recordPlan);
    expectExecutionPlanBlueprintRecordMetadataHeaders(
      createFromRecordResponse,
      savedBlueprint.record,
    );
    expect(
      createFromRecordResponse.headers.get("x-napier-qualification-status"),
    ).toBe("qualified");
    expect(
      createFromRecordResponse.headers.get(
        "x-napier-blueprint-qualification-sha256",
      ),
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createFromRecordResponse.headers.get("x-napier-blueprint-preview-sha256"),
    ).toBe(previewFromRecord.previewSha256);
    const recordThreadEvents = await services.store.listEvents(
      recordThread.thread.id,
    );
    const recordCreatedEvent = recordThreadEvents.find((event) => {
      const payload = event.payload;
      return (
        event.type === "plan.created" &&
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        payload["blueprintRecordId"] === savedBlueprint.record.id
      );
    });
    expect(recordCreatedEvent).toBeDefined();
    if (!recordCreatedEvent) {
      throw new Error("Expected blueprint replay plan.created event");
    }
    expect(
      createFromRecordResponse.headers.get(
        "x-napier-blueprint-replay-event-id",
      ),
    ).toBe(recordCreatedEvent.id);
    expect(
      createFromRecordResponse.headers.get(
        "x-napier-blueprint-replay-event-seq",
      ),
    ).toBe(String(recordCreatedEvent.seq));
    expect(
      createFromRecordResponse.headers.get(
        "x-napier-blueprint-replay-event-sha256",
      ),
    ).toBe(responseSha256(recordCreatedEvent));
    const replayEventVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/events/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: recordThread.thread.id,
          eventId: recordCreatedEvent.id,
          seq: recordCreatedEvent.seq,
          eventSha256: responseSha256(recordCreatedEvent),
        }),
      },
    );
    expect(replayEventVerifyResponse.status).toBe(200);
    const replayEventVerification =
      (await replayEventVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayEventVerification;
    expect(replayEventVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        expectedRecordId: savedBlueprint.record.id,
        threadId: recordThread.thread.id,
        eventId: recordCreatedEvent.id,
        seq: recordCreatedEvent.seq,
        declaredEventSha256: responseSha256(recordCreatedEvent),
        observedEventSha256: responseSha256(recordCreatedEvent),
        observedReplay: expect.objectContaining({
          eventId: recordCreatedEvent.id,
          threadId: recordThread.thread.id,
          recordId: savedBlueprint.record.id,
          planId: recordPlan.id,
          previewSha256: previewFromRecord.previewSha256,
        }),
      }),
    );
    expectExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
      replayEventVerifyResponse,
      replayEventVerification,
    );

    const tamperedReplayEventVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/events/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: recordThread.thread.id,
          eventId: recordCreatedEvent.id,
          seq: recordCreatedEvent.seq,
          eventSha256: "0".repeat(64),
        }),
      },
    );
    expect(tamperedReplayEventVerifyResponse.status).toBe(200);
    const tamperedReplayEventVerification =
      (await tamperedReplayEventVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayEventVerification;
    expect(tamperedReplayEventVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["event_hash_mismatch"],
        expectedRecordId: savedBlueprint.record.id,
        declaredEventSha256: "0".repeat(64),
        observedEventSha256: responseSha256(recordCreatedEvent),
      }),
    );
    expectExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
      tamperedReplayEventVerifyResponse,
      tamperedReplayEventVerification,
    );
    expect(recordPlan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "produce" }),
        expect.objectContaining({ id: "audit", dependsOn: ["produce"] }),
      ]),
    );
    expect(recordThreadEvents.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blueprintQualificationStatus: "qualified",
          blueprintQualificationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          blueprintQualificationDiagnosticsSha256:
            expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );

    const replayHistoryResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays`,
    );
    expect(replayHistoryResponse.status).toBe(200);
    const replayHistory =
      (await replayHistoryResponse.json()) as ExecutionPlanBlueprintRecordReplayHistory;
    expect(replayHistory).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-replay-history",
        schemaVersion: 1,
        recordId: savedBlueprint.record.id,
        replayCount: 1,
        threadCount: 1,
        planCount: 1,
        firstSeq: 1,
        lastSeq: 1,
        eventSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        replays: [
          expect.objectContaining({
            threadId: recordThread.thread.id,
            planId: recordPlan.id,
            recordId: savedBlueprint.record.id,
            objectiveSha256: createHash("sha256")
              .update(recordPlan.objective)
              .digest("hex"),
            blueprintSha256: savedBlueprint.record.blueprintSha256,
            sourcePlanArchiveSha256:
              savedBlueprint.record.sourcePlanArchiveSha256,
            qualificationStatus: "qualified",
            previewSha256: previewFromRecord.previewSha256,
          }),
        ],
      }),
    );
    expect(JSON.stringify(replayHistory)).not.toContain(recordPlan.objective);
    expectExecutionPlanBlueprintRecordReplayHistoryHeaders(
      replayHistoryResponse,
      replayHistory,
    );

    const replayHistoryVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: replayHistory }),
      },
    );
    expect(replayHistoryVerifyResponse.status).toBe(200);
    const replayHistoryVerification =
      (await replayHistoryVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayHistoryVerification;
    expect(replayHistoryVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        recordId: savedBlueprint.record.id,
        expectedRecordId: savedBlueprint.record.id,
        declaredContentSha256: replayHistory.contentSha256,
        recomputedContentSha256: replayHistory.contentSha256,
        observedContentSha256: replayHistory.contentSha256,
        declaredEventSetSha256: replayHistory.eventSetSha256,
        observedEventSetSha256: replayHistory.eventSetSha256,
      }),
    );
    expectExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
      replayHistoryVerifyResponse,
      replayHistoryVerification,
    );

    const tamperedReplayHistoryVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          history: { ...replayHistory, eventSetSha256: "0".repeat(64) },
        }),
      },
    );
    expect(tamperedReplayHistoryVerifyResponse.status).toBe(200);
    const tamperedReplayHistoryVerification =
      (await tamperedReplayHistoryVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayHistoryVerification;
    expect(tamperedReplayHistoryVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "event_set_mismatch",
        ]),
        declaredEventSetSha256: "0".repeat(64),
        observedEventSetSha256: replayHistory.eventSetSha256,
      }),
    );
    expectExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
      tamperedReplayHistoryVerifyResponse,
      tamperedReplayHistoryVerification,
    );

    const replayOutcomesResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes`,
    );
    expect(replayOutcomesResponse.status).toBe(200);
    const replayOutcomes =
      (await replayOutcomesResponse.json()) as ExecutionPlanBlueprintRecordReplayOutcomes;
    expect(replayOutcomes).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-replay-outcomes",
        schemaVersion: 1,
        recordId: savedBlueprint.record.id,
        replayHistorySha256: replayHistory.contentSha256,
        replayCount: 1,
        activeCount: 1,
        completedCount: 0,
        blockedCount: 0,
        cancelledCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
        outcomeSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(replayOutcomes.outcomes).toEqual([
      expect.objectContaining({
        replayEventId: recordCreatedEvent.id,
        replayEventSeq: recordCreatedEvent.seq,
        threadId: recordThread.thread.id,
        planId: recordPlan.id,
        status: "active",
        planRevision: recordPlan.revision,
        planProjectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        outcomeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(JSON.stringify(replayOutcomes)).not.toContain(recordPlan.objective);
    expectExecutionPlanBlueprintRecordReplayOutcomesHeaders(
      replayOutcomesResponse,
      replayOutcomes,
    );

    const replayOutcomesVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcomes: replayOutcomes }),
      },
    );
    expect(replayOutcomesVerifyResponse.status).toBe(200);
    const replayOutcomesVerification =
      (await replayOutcomesVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayOutcomesVerification;
    expect(replayOutcomesVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        recordId: savedBlueprint.record.id,
        expectedRecordId: savedBlueprint.record.id,
        declaredContentSha256: replayOutcomes.contentSha256,
        recomputedContentSha256: replayOutcomes.contentSha256,
        observedContentSha256: replayOutcomes.contentSha256,
        declaredReplayHistorySha256: replayHistory.contentSha256,
        observedReplayHistorySha256: replayHistory.contentSha256,
        declaredOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        observedOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        observedReplayCount: 1,
        completedCount: 0,
        observedCompletedCount: 0,
      }),
    );
    expectExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
      replayOutcomesVerifyResponse,
      replayOutcomesVerification,
    );

    const tamperedReplayOutcomesVerifyResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: { ...replayOutcomes, outcomeSetSha256: "0".repeat(64) },
        }),
      },
    );
    expect(tamperedReplayOutcomesVerifyResponse.status).toBe(200);
    const tamperedReplayOutcomesVerification =
      (await tamperedReplayOutcomesVerifyResponse.json()) as ExecutionPlanBlueprintRecordReplayOutcomesVerification;
    expect(tamperedReplayOutcomesVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "outcome_set_mismatch",
        ]),
        declaredOutcomeSetSha256: "0".repeat(64),
        observedOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
      }),
    );
    expectExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
      tamperedReplayOutcomesVerifyResponse,
      tamperedReplayOutcomesVerification,
    );

    const invalidReplayOutcomesRequest = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          unexpected: true,
        }),
      },
    );
    expect(invalidReplayOutcomesRequest.status).toBe(400);
    expect(await invalidReplayOutcomesRequest.json()).toEqual({
      error:
        "Execution plan blueprint replay outcomes verification request is invalid",
    });

    const emptyOutcomeBaselinesResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
    );
    expect(emptyOutcomeBaselinesResponse.status).toBe(200);
    const emptyOutcomeBaselines =
      (await emptyOutcomeBaselinesResponse.json()) as ExecutionPlanBlueprintRecordOutcomeBaseline[];
    expect(emptyOutcomeBaselines).toEqual([]);
    expectExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
      emptyOutcomeBaselinesResponse,
      emptyOutcomeBaselines,
    );

    const missingOutcomeQualificationResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/qualification`,
    );
    expect(missingOutcomeQualificationResponse.status).toBe(200);
    const missingOutcomeQualification =
      (await missingOutcomeQualificationResponse.json()) as ExecutionPlanBlueprintRecordOutcomeQualification;
    expect(missingOutcomeQualification).toEqual(
      expect.objectContaining({
        status: "missing_baseline",
        diagnostics: ["baseline_missing"],
        recordId: savedBlueprint.record.id,
        currentOutcomesSha256: replayOutcomes.contentSha256,
        currentReplayHistorySha256: replayOutcomes.replayHistorySha256,
        currentOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 0,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
      }),
    );
    expectExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
      missingOutcomeQualificationResponse,
      missingOutcomeQualification,
    );

    const outcomeBaselineResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          policy: {
            minCompletionRateBps: 0,
          },
        }),
      },
    );
    expect(outcomeBaselineResponse.status).toBe(201);
    const outcomeBaselineResult =
      (await outcomeBaselineResponse.json()) as PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult;
    expect(outcomeBaselineResult).toEqual({
      created: true,
      baseline: expect.objectContaining({
        id: expect.stringMatching(/^outcome_base_[a-f0-9]{20}$/),
        recordId: savedBlueprint.record.id,
        replayOutcomesSha256: replayOutcomes.contentSha256,
        replayHistorySha256: replayOutcomes.replayHistorySha256,
        outcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 0,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
        policy: {
          minReplayCount: 1,
          minCompletionRateBps: 0,
          maxBlockedCount: 0,
          maxInvalidCount: 0,
        },
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expectExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
      outcomeBaselineResponse,
      outcomeBaselineResult,
    );

    const duplicateOutcomeBaselineResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          policy: {
            minCompletionRateBps: 0,
          },
        }),
      },
    );
    expect(duplicateOutcomeBaselineResponse.status).toBe(200);
    const duplicateOutcomeBaselineResult =
      (await duplicateOutcomeBaselineResponse.json()) as PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult;
    expect(duplicateOutcomeBaselineResult).toEqual({
      created: false,
      baseline: outcomeBaselineResult.baseline,
    });
    expectExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
      duplicateOutcomeBaselineResponse,
      duplicateOutcomeBaselineResult,
    );

    const outcomeBaselinesResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
    );
    expect(outcomeBaselinesResponse.status).toBe(200);
    const outcomeBaselines =
      (await outcomeBaselinesResponse.json()) as ExecutionPlanBlueprintRecordOutcomeBaseline[];
    expect(outcomeBaselines).toEqual([outcomeBaselineResult.baseline]);
    expectExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
      outcomeBaselinesResponse,
      outcomeBaselines,
    );

    const outcomeQualificationResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/qualification`,
    );
    expect(outcomeQualificationResponse.status).toBe(200);
    const outcomeQualification =
      (await outcomeQualificationResponse.json()) as ExecutionPlanBlueprintRecordOutcomeQualification;
    expect(outcomeQualification).toEqual(
      expect.objectContaining({
        status: "qualified",
        diagnostics: [],
        recordId: savedBlueprint.record.id,
        baselineId: outcomeBaselineResult.baseline.id,
        baselineSha256: outcomeBaselineResult.baseline.contentSha256,
        baselineOutcomesSha256: replayOutcomes.contentSha256,
        currentOutcomesSha256: replayOutcomes.contentSha256,
        replayCount: 1,
        completedCount: 0,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
      }),
    );
    expectExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
      outcomeQualificationResponse,
      outcomeQualification,
    );

    const outcomeReviewResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "napier", id: "demo" },
        }),
      },
    );
    expect(outcomeReviewResponse.status).toBe(200);
    const outcomeReview =
      (await outcomeReviewResponse.json()) as ExecutionPlanBlueprintRecordOutcomeReview;
    expect(outcomeReview).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-outcome-review",
        schemaVersion: 1,
        policyId: "napier.blueprint-outcome-review.v1",
        recordId: savedBlueprint.record.id,
        blueprintSha256: savedBlueprint.record.blueprintSha256,
        model: { provider: "napier", id: "demo" },
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        concerns: ["live_model_required"],
        sourceQualificationStatus: "qualified",
        outcomeQualificationStatus: "qualified",
        replayOutcomesSha256: replayOutcomes.contentSha256,
        replayHistorySha256: replayOutcomes.replayHistorySha256,
        outcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        completedCount: 0,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
        baselineId: outcomeBaselineResult.baseline.id,
        baselineSha256: outcomeBaselineResult.baseline.contentSha256,
        baselineOutcomesSha256:
          outcomeBaselineResult.baseline.replayOutcomesSha256,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSchemaSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(outcomeReview).not.toHaveProperty("modelContextEnvelope");
    expect(JSON.stringify(outcomeReview)).not.toContain(recordPlan.objective);
    expectExecutionPlanBlueprintRecordOutcomeReviewHeaders(
      outcomeReviewResponse,
      outcomeReview,
    );

    const invalidOutcomeReviewResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "napier", id: "demo" },
          unexpected: true,
        }),
      },
    );
    expect(invalidOutcomeReviewResponse.status).toBe(400);
    expect(await invalidOutcomeReviewResponse.json()).toEqual({
      error: "Execution plan blueprint outcome review request is invalid",
    });

    const selectionThread = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blueprint selection target" }),
      })
    ).json()) as ThreadDetail;
    const selectionResponse = await app.request(
      `/api/threads/${selectionThread.thread.id}/plan-blueprints/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Select a reusable report workflow.",
          policyTemplate: "portfolio_first",
        }),
      },
    );
    const selectionResponseText = await selectionResponse.text();
    expect(selectionResponse.status, selectionResponseText).toBe(200);
    const selection = JSON.parse(
      selectionResponseText,
    ) as ExecutionPlanBlueprintRecordSelection;
    expect(selection).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-selection",
        schemaVersion: 1,
        threadId: selectionThread.thread.id,
        objectiveSha256: createHash("sha256")
          .update("Select a reusable report workflow.")
          .digest("hex"),
        candidateCount: 1,
        qualifiedCandidateCount: 1,
        rejectedCandidateCount: 0,
        selectedRecordId: savedBlueprint.record.id,
        selectedBaselineId: outcomeBaselineResult.baseline.id,
        selectedBaselineSha256: outcomeBaselineResult.baseline.contentSha256,
        selectedScoreBps: 0,
        selectedFamilySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectedFamilyCompletionRateBps: 0,
        selectedRecommendationScoreBps: 100,
        selectedRecommendationPolicyTemplate: "portfolio_first",
        selectedRecommendationPolicySha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        selectedRecommendationPolicySource: "request",
        recommendationPolicy: {
          templateId: "portfolio_first",
          weights: {
            outcomeCompletionBps: 3_500,
            familyCompletionBps: 3_500,
            reviewedBaselineBps: 2_000,
            replayEvidenceBps: 1_000,
          },
        },
        recommendationPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        familyPolicyOverrideCount: 0,
        familyPolicyOverrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        portfolioSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(selection.candidates).toEqual([
      expect.objectContaining({
        recordId: savedBlueprint.record.id,
        selectionStatus: "selected",
        sourceQualificationStatus: "qualified",
        outcomeQualificationStatus: "qualified",
        familySha256: selection.selectedFamilySha256,
        familyRecordCount: 1,
        familyOutcomeQualifiedCount: 1,
        familyReviewedBaselineCount: 0,
        familyCompletionRateBps: 0,
        previewStatus: "ready",
        baselineId: outcomeBaselineResult.baseline.id,
        scoreBps: 0,
        recommendationScoreBps: 100,
        recommendationPolicyTemplate: "portfolio_first",
        recommendationPolicySha256:
          selection.selectedRecommendationPolicySha256,
        recommendationPolicySource: "request",
        replayCount: 1,
        completionRateBps: 0,
      }),
    ]);
    expect(JSON.stringify(selection)).not.toContain(
      "Select a reusable report workflow.",
    );
    expectExecutionPlanBlueprintRecordSelectionHeaders(
      selectionResponse,
      selection,
    );

    const invalidSelectionRequest = await app.request(
      `/api/threads/${selectionThread.thread.id}/plan-blueprints/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Select a reusable report workflow.",
          unexpected: true,
        }),
      },
    );
    expect(invalidSelectionRequest.status).toBe(400);
    expect(await invalidSelectionRequest.json()).toEqual({
      error: "Execution plan blueprint selection request is invalid",
    });

    const invalidSelectionPolicyRequest = await app.request(
      `/api/threads/${selectionThread.thread.id}/plan-blueprints/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Select a reusable report workflow.",
          policyTemplate: "fastest",
        }),
      },
    );
    expect(invalidSelectionPolicyRequest.status).toBe(400);
    expect(await invalidSelectionPolicyRequest.json()).toEqual({
      error: "Execution plan blueprint selection request is invalid",
    });

    const reviewedProvider = fauxProvider({
      provider: "faux-blueprint-review-api",
    });
    reviewedProvider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "promote",
          score: 94,
          risk: "low",
          reason:
            "The current replay outcomes are stable, qualified, and audit-ready.",
          concerns: [],
          scores: ["completion", "stability", "auditability", "reuse_risk"].map(
            (criterionId) => ({
              criterionId,
              score: 94,
              reason: "The criterion is satisfied by hash-bound outcomes.",
            }),
          ),
        }),
      ),
    ]);
    services.models.registerProvider(reviewedProvider.provider);
    const promotedOutcomeReviewResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-blueprint-review-api", id: "faux-1" },
        }),
      },
    );
    expect(promotedOutcomeReviewResponse.status).toBe(200);
    const promotedOutcomeReview =
      (await promotedOutcomeReviewResponse.json()) as ExecutionPlanBlueprintRecordOutcomeReview;
    expect(promotedOutcomeReview).toEqual(
      expect.objectContaining({
        verdict: "promote",
        score: 94,
        risk: "low",
        recordId: savedBlueprint.record.id,
        outcomeQualificationStatus: "qualified",
        baselineId: outcomeBaselineResult.baseline.id,
        baselineSha256: outcomeBaselineResult.baseline.contentSha256,
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(promotedOutcomeReview)).not.toContain(
      recordPlan.objective,
    );
    expect(
      promotedOutcomeReviewResponse.headers.get(
        "x-napier-blueprint-outcome-review-model-context-envelope-sha256",
      ),
    ).toBe(promotedOutcomeReview.modelContextEnvelope?.contentSha256);
    expectExecutionPlanBlueprintRecordOutcomeReviewHeaders(
      promotedOutcomeReviewResponse,
      promotedOutcomeReview,
    );

    const reviewedOutcomeBaselineResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          policy: {
            minCompletionRateBps: 0,
          },
          review: promotedOutcomeReview,
        }),
      },
    );
    expect(reviewedOutcomeBaselineResponse.status).toBe(201);
    const reviewedOutcomeBaselineResult =
      (await reviewedOutcomeBaselineResponse.json()) as PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult;
    expect(reviewedOutcomeBaselineResult).toEqual({
      created: true,
      baseline: expect.objectContaining({
        id: expect.stringMatching(/^outcome_base_[a-f0-9]{20}$/),
        recordId: savedBlueprint.record.id,
        replayOutcomesSha256: replayOutcomes.contentSha256,
        policy: {
          minReplayCount: 1,
          minCompletionRateBps: 0,
          maxBlockedCount: 0,
          maxInvalidCount: 0,
        },
        reviewGate: {
          minScore: 80,
          maxRisk: "medium",
        },
        reviewSha256: promotedOutcomeReview.reviewSha256,
        reviewInputSha256: promotedOutcomeReview.inputSha256,
        reviewResponseSha256: promotedOutcomeReview.responseSha256,
        reviewVerdict: "promote",
        reviewScore: 94,
        reviewRisk: "low",
        reviewModel: { provider: "faux-blueprint-review-api", id: "faux-1" },
        supersedesBaselineId: outcomeBaselineResult.baseline.id,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expectExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
      reviewedOutcomeBaselineResponse,
      reviewedOutcomeBaselineResult,
    );

    const reviewedOutcomeBaselinesResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
    );
    expect(reviewedOutcomeBaselinesResponse.status).toBe(200);
    const reviewedOutcomeBaselines =
      (await reviewedOutcomeBaselinesResponse.json()) as ExecutionPlanBlueprintRecordOutcomeBaseline[];
    expect(reviewedOutcomeBaselines).toEqual([
      outcomeBaselineResult.baseline,
      reviewedOutcomeBaselineResult.baseline,
    ]);
    expectExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
      reviewedOutcomeBaselinesResponse,
      reviewedOutcomeBaselines,
    );

    const missingReviewForGateResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          reviewGate: { minScore: 80 },
        }),
      },
    );
    expect(missingReviewForGateResponse.status).toBe(400);
    expect(await missingReviewForGateResponse.json()).toEqual({
      error: "Execution plan blueprint outcome baseline request is invalid",
    });

    const inconclusiveReviewPromotionResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          policy: {
            minCompletionRateBps: 0,
          },
          review: outcomeReview,
          reviewGate: { minScore: 0 },
        }),
      },
    );
    expect(inconclusiveReviewPromotionResponse.status).toBe(409);
    expect(await inconclusiveReviewPromotionResponse.json()).toEqual({
      error:
        "Execution plan blueprint outcome baseline review failed: review_not_promote,review_risk_above_max",
    });

    const portfolioCalibrationResponse = await app.request(
      "/api/plan-blueprints/portfolio/calibration",
    );
    expect(portfolioCalibrationResponse.status).toBe(200);
    const portfolioCalibration =
      (await portfolioCalibrationResponse.json()) as ExecutionPlanBlueprintPortfolioCalibration;
    expect(portfolioCalibration).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-portfolio-calibration",
        schemaVersion: 1,
        recordCount: 1,
        activeCount: 1,
        archivedCount: 0,
        familyCount: 1,
        sourceQualifiedCount: 1,
        outcomeQualifiedCount: 1,
        reviewedBaselineCount: 1,
        missingBaselineCount: 0,
        policyFailedCount: 0,
        portfolioSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(portfolioCalibration.families).toEqual([
      expect.objectContaining({
        familySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        recordCount: 1,
        activeCount: 1,
        archivedCount: 0,
        sourceQualifiedCount: 1,
        outcomeQualifiedCount: 1,
        reviewedBaselineCount: 1,
        replayCount: 1,
        completedCount: 0,
        blockedCount: 0,
        invalidCount: 0,
        completionRateBps: 0,
        topRecordId: savedBlueprint.record.id,
        topRecordScoreBps: 0,
        latestBaselineSha256:
          reviewedOutcomeBaselineResult.baseline.contentSha256,
      }),
    ]);
    expect(JSON.stringify(portfolioCalibration)).not.toContain(
      recordPlan.objective,
    );
    expectExecutionPlanBlueprintPortfolioCalibrationHeaders(
      portfolioCalibrationResponse,
      portfolioCalibration,
    );

    const policyBacktestResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-backtest",
    );
    expect(policyBacktestResponse.status).toBe(200);
    const policyBacktest =
      (await policyBacktestResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyBacktest;
    expect(policyBacktest).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-backtest",
        schemaVersion: 1,
        recordCount: 1,
        activeCount: 1,
        policyCount: 3,
        divergentSelectionCount: 0,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        policySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      policyBacktest.results.map(
        (result) => result.recommendationPolicy.templateId,
      ),
    ).toEqual(["balanced", "delivery_first", "portfolio_first"]);
    expect(
      policyBacktest.results.map(
        (result) => result.selectedRecommendationScoreBps,
      ),
    ).toEqual([1_600, 1_100, 2_100]);
    for (const result of policyBacktest.results) {
      expect(result).toEqual(
        expect.objectContaining({
          candidateCount: 1,
          qualifiedCandidateCount: 1,
          rejectedCandidateCount: 0,
          selectedRecordId: savedBlueprint.record.id,
          selectedFamilySha256: portfolioCalibration.families[0]?.familySha256,
          recommendationPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(result.candidates).toEqual([
        expect.objectContaining({
          recordId: savedBlueprint.record.id,
          selectionStatus: "selected",
          diagnostics: [],
          familySha256: portfolioCalibration.families[0]?.familySha256,
          sourceQualificationStatus: "qualified",
          outcomeQualificationStatus: "qualified",
          reviewedBaselineCoverageBps: 10_000,
          replayEvidenceBps: 1_000,
          replayCount: 1,
          completionRateBps: 0,
        }),
      ]);
    }
    expect(JSON.stringify(policyBacktest)).not.toContain(recordPlan.objective);
    expectExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(
      policyBacktestResponse,
      policyBacktest,
    );

    const policyOverrideResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familySha256: portfolioCalibration.families[0]?.familySha256,
          policyTemplate: "portfolio_first",
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        }),
      },
    );
    expect(policyOverrideResponse.status).toBe(200);
    const policyOverride =
      (await policyOverrideResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverride;
    expect(policyOverride).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override",
        schemaVersion: 1,
        familySha256: portfolioCalibration.families[0]?.familySha256,
        recommendationPolicy: {
          templateId: "portfolio_first",
          weights: {
            outcomeCompletionBps: 3_500,
            familyCompletionBps: 3_500,
            reviewedBaselineBps: 2_000,
            replayEvidenceBps: 1_000,
          },
        },
        recommendationPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        familyRecordCount: 1,
        familyOutcomeQualifiedCount: 1,
        familyCompletionRateBps: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(
      policyOverrideResponse,
      policyOverride,
    );

    const policyOverrideListResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    );
    expect(policyOverrideListResponse.status).toBe(200);
    const policyOverrideList =
      (await policyOverrideListResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideList;
    expect(policyOverrideList).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-overrides",
        schemaVersion: 1,
        overrideCount: 1,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        overrides: [policyOverride],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(
      policyOverrideListResponse,
      policyOverrideList,
    );

    const policyOverrideDriftReviewResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review",
    );
    expect(policyOverrideDriftReviewResponse.status).toBe(200);
    const policyOverrideDriftReview =
      (await policyOverrideDriftReviewResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview;
    expect(policyOverrideDriftReview).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review",
        schemaVersion: 1,
        overrideCount: 1,
        alignedCount: 1,
        retireRecommendedCount: 0,
        missingFamilyCount: 0,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: policyOverrideList.overrideSetSha256,
        reviewSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviews: [
          expect.objectContaining({
            familySha256: portfolioCalibration.families[0]?.familySha256,
            overrideSha256: policyOverride.contentSha256,
            status: "aligned",
            recommendation: "keep",
            diagnostics: [],
            overridePolicyTemplate: "portfolio_first",
            overridePolicySha256: policyOverride.recommendationPolicySha256,
            overrideSelectedRecordId: savedBlueprint.record.id,
            overrideSelectedRecommendationScoreBps: 2_100,
            bestPolicyTemplate: "portfolio_first",
            bestPolicySha256: policyOverride.recommendationPolicySha256,
            bestSelectedRecordId: savedBlueprint.record.id,
            bestSelectedRecommendationScoreBps: 2_100,
            familyRecordCount: 1,
            familyOutcomeQualifiedCount: 1,
            familyCompletionRateBps: 0,
            reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(
      policyOverrideDriftReviewResponse,
      policyOverrideDriftReview,
    );

    const overrideSelectionThread = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blueprint override selection target" }),
      })
    ).json()) as ThreadDetail;
    const overrideSelectionResponse = await app.request(
      `/api/threads/${overrideSelectionThread.thread.id}/plan-blueprints/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Select with family override.",
        }),
      },
    );
    expect(overrideSelectionResponse.status).toBe(200);
    const overrideSelection =
      (await overrideSelectionResponse.json()) as ExecutionPlanBlueprintRecordSelection;
    expect(overrideSelection).toEqual(
      expect.objectContaining({
        selectedRecordId: savedBlueprint.record.id,
        selectedRecommendationScoreBps: 2_100,
        selectedRecommendationPolicyTemplate: "portfolio_first",
        selectedRecommendationPolicySha256:
          policyOverride.recommendationPolicySha256,
        selectedRecommendationPolicySource: "family_override",
        selectedFamilyPolicyOverrideSha256: policyOverride.contentSha256,
        familyPolicyOverrideCount: 1,
        familyPolicyOverrideSetSha256: policyOverrideList.overrideSetSha256,
      }),
    );
    expectExecutionPlanBlueprintRecordSelectionHeaders(
      overrideSelectionResponse,
      overrideSelection,
    );

    const alignedRetirementResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familySha256: portfolioCalibration.families[0]?.familySha256,
          expectedOverrideSha256: policyOverride.contentSha256,
          expectedOverrideSetSha256: policyOverrideList.overrideSetSha256,
          expectedDriftReviewSetSha256:
            policyOverrideDriftReview.reviewSetSha256,
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        }),
      },
    );
    expect(alignedRetirementResponse.status).toBe(409);
    expect(await alignedRetirementResponse.json()).toEqual({
      error:
        "Execution plan blueprint recommendation policy override retirement is not retire recommended",
    });

    const driftedPolicyOverrideResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familySha256: portfolioCalibration.families[0]?.familySha256,
          policyTemplate: "balanced",
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        }),
      },
    );
    expect(driftedPolicyOverrideResponse.status).toBe(200);
    const driftedPolicyOverride =
      (await driftedPolicyOverrideResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverride;
    const driftedPolicyOverrideListResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    );
    expect(driftedPolicyOverrideListResponse.status).toBe(200);
    const driftedPolicyOverrideList =
      (await driftedPolicyOverrideListResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideList;
    const driftedPolicyOverrideReviewResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review",
    );
    expect(driftedPolicyOverrideReviewResponse.status).toBe(200);
    const driftedPolicyOverrideReview =
      (await driftedPolicyOverrideReviewResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview;
    expect(driftedPolicyOverrideReview).toEqual(
      expect.objectContaining({
        overrideCount: 1,
        alignedCount: 0,
        retireRecommendedCount: 1,
        reviews: [
          expect.objectContaining({
            familySha256: portfolioCalibration.families[0]?.familySha256,
            overrideSha256: driftedPolicyOverride.contentSha256,
            status: "retire_recommended",
            recommendation: "retire",
            diagnostics: ["override_policy_not_best"],
            overridePolicyTemplate: "balanced",
            bestPolicyTemplate: "portfolio_first",
          }),
        ],
      }),
    );
    const policyOverrideRetirementResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familySha256: portfolioCalibration.families[0]?.familySha256,
          expectedOverrideSha256: driftedPolicyOverride.contentSha256,
          expectedOverrideSetSha256:
            driftedPolicyOverrideList.overrideSetSha256,
          expectedDriftReviewSetSha256:
            driftedPolicyOverrideReview.reviewSetSha256,
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        }),
      },
    );
    expect(policyOverrideRetirementResponse.status).toBe(200);
    const policyOverrideRetirement =
      (await policyOverrideRetirementResponse.json()) as RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult;
    expect(policyOverrideRetirement).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement",
        schemaVersion: 1,
        familySha256: portfolioCalibration.families[0]?.familySha256,
        retiredOverrideSha256: driftedPolicyOverride.contentSha256,
        retiredRecommendationPolicyTemplate: "balanced",
        retiredRecommendationPolicySha256:
          driftedPolicyOverride.recommendationPolicySha256,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: driftedPolicyOverrideList.overrideSetSha256,
        driftReviewSetSha256: driftedPolicyOverrideReview.reviewSetSha256,
        remainingOverrideSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retiredAt: expect.any(String),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(
      policyOverrideRetirementResponse,
      policyOverrideRetirement,
    );
    const retiredPolicyOverrideListResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    );
    expect(retiredPolicyOverrideListResponse.status).toBe(200);
    const retiredPolicyOverrideList =
      (await retiredPolicyOverrideListResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideList;
    expect(retiredPolicyOverrideList).toEqual(
      expect.objectContaining({
        overrideCount: 0,
        overrides: [],
        overrideSetSha256: policyOverrideRetirement.remainingOverrideSetSha256,
      }),
    );
    const policyOverrideRetirementHistoryResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements",
    );
    expect(policyOverrideRetirementHistoryResponse.status).toBe(200);
    const policyOverrideRetirementHistory =
      (await policyOverrideRetirementHistoryResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory;
    expect(policyOverrideRetirementHistory).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history",
        schemaVersion: 1,
        retirementCount: 1,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        currentOverrideSetSha256:
          policyOverrideRetirement.remainingOverrideSetSha256,
        retirementSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        latestRetiredAt: policyOverrideRetirement.retiredAt,
        retirements: [policyOverrideRetirement],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(
      policyOverrideRetirementHistoryResponse,
      policyOverrideRetirementHistory,
    );
    const policyOverrideRetirementHistoryVerificationResponse =
      await app.request(
        "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            history: policyOverrideRetirementHistory,
          }),
        },
      );
    expect(policyOverrideRetirementHistoryVerificationResponse.status).toBe(
      200,
    );
    const policyOverrideRetirementHistoryVerification =
      (await policyOverrideRetirementHistoryVerificationResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification;
    expect(policyOverrideRetirementHistoryVerification).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification",
        schemaVersion: 1,
        status: "valid",
        diagnostics: [],
        declaredContentSha256: policyOverrideRetirementHistory.contentSha256,
        recomputedContentSha256: policyOverrideRetirementHistory.contentSha256,
        observedContentSha256: policyOverrideRetirementHistory.contentSha256,
        declaredPortfolioSetSha256:
          policyOverrideRetirementHistory.portfolioSetSha256,
        observedPortfolioSetSha256:
          policyOverrideRetirementHistory.portfolioSetSha256,
        declaredCurrentOverrideSetSha256:
          policyOverrideRetirementHistory.currentOverrideSetSha256,
        observedCurrentOverrideSetSha256:
          policyOverrideRetirementHistory.currentOverrideSetSha256,
        declaredRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        recomputedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        observedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        retirementCount: 1,
        observedRetirementCount: 1,
        latestRetiredAt: policyOverrideRetirement.retiredAt,
        observedLatestRetiredAt: policyOverrideRetirement.retiredAt,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(
      policyOverrideRetirementHistoryVerificationResponse,
      policyOverrideRetirementHistoryVerification,
    );
    const tamperedPolicyOverrideRetirementHistoryVerificationResponse =
      await app.request(
        "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            history: {
              ...policyOverrideRetirementHistory,
              retirementSetSha256: "0".repeat(64),
            },
          }),
        },
      );
    expect(
      tamperedPolicyOverrideRetirementHistoryVerificationResponse.status,
    ).toBe(200);
    const tamperedPolicyOverrideRetirementHistoryVerification =
      (await tamperedPolicyOverrideRetirementHistoryVerificationResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification;
    expect(tamperedPolicyOverrideRetirementHistoryVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "retirement_set_hash_mismatch",
          "retirement_set_mismatch",
        ]),
        declaredRetirementSetSha256: "0".repeat(64),
        recomputedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
        observedRetirementSetSha256:
          policyOverrideRetirementHistory.retirementSetSha256,
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(
      tamperedPolicyOverrideRetirementHistoryVerificationResponse,
      tamperedPolicyOverrideRetirementHistoryVerification,
    );
    const policyOverrideRetirementHistoryProofBundleResponse =
      await app.request(
        "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            histories: [
              policyOverrideRetirementHistory,
              policyOverrideRetirementHistory,
            ],
          }),
        },
      );
    expect(policyOverrideRetirementHistoryProofBundleResponse.status).toBe(200);
    const policyOverrideRetirementHistoryProofBundle =
      (await policyOverrideRetirementHistoryProofBundleResponse.json()) as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle;
    expect(policyOverrideRetirementHistoryProofBundle).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle",
        schemaVersion: 1,
        status: "aligned",
        diagnostics: [],
        historyCount: 2,
        validHistoryCount: 2,
        invalidHistoryCount: 0,
        distinctHistoryCount: 1,
        distinctPortfolioSetCount: 1,
        distinctCurrentOverrideSetCount: 1,
        distinctRetirementSetCount: 1,
        historySetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        portfolioSetBundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        currentOverrideSetBundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        retirementSetBundleSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        histories: [
          expect.objectContaining({
            index: 0,
            status: "valid",
            diagnostics: [],
            declaredContentSha256:
              policyOverrideRetirementHistory.contentSha256,
            recomputedContentSha256:
              policyOverrideRetirementHistory.contentSha256,
            declaredRetirementSetSha256:
              policyOverrideRetirementHistory.retirementSetSha256,
            recomputedRetirementSetSha256:
              policyOverrideRetirementHistory.retirementSetSha256,
            retirementCount: 1,
            recomputedRetirementCount: 1,
            latestRetiredAt: policyOverrideRetirement.retiredAt,
            recomputedLatestRetiredAt: policyOverrideRetirement.retiredAt,
            itemSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
          expect.objectContaining({
            index: 1,
            status: "valid",
            diagnostics: [],
            declaredContentSha256:
              policyOverrideRetirementHistory.contentSha256,
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(
      policyOverrideRetirementHistoryProofBundleResponse,
      policyOverrideRetirementHistoryProofBundle,
    );

    const { privateKey: policyRetirementPrivateKey } =
      generateKeyPairSync("ed25519");
    process.env[POLICY_RETIREMENT_SIGNING_ENV] = policyRetirementPrivateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const policyRetirementAnchorResponse = await app.request(
      "/api/receipt-trust/anchors",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: selectionThread.thread.id,
          label: "Policy retirement bundle signer",
          source: {
            type: "environment",
            variable: POLICY_RETIREMENT_SIGNING_ENV,
          },
        }),
      },
    );
    expect(policyRetirementAnchorResponse.status).toBe(201);
    const policyRetirementAnchor =
      (await policyRetirementAnchorResponse.json()) as ReceiptTrustAnchor;
    expect(policyRetirementAnchor).toEqual(
      expect.objectContaining({
        algorithm: "Ed25519",
        status: "trusted",
        signingSource: {
          type: "environment",
          variable: POLICY_RETIREMENT_SIGNING_ENV,
        },
      }),
    );
    expect(JSON.stringify(policyRetirementAnchor)).not.toContain(
      "BEGIN PRIVATE KEY",
    );

    const invalidPolicyOverrideRetirementHistoryProofBundleSignResponse =
      await app.request(
        "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            histories: [policyOverrideRetirementHistory],
            threadId: selectionThread.thread.id,
            trustAnchorId: policyRetirementAnchor.id,
          }),
        },
      );
    expect(
      invalidPolicyOverrideRetirementHistoryProofBundleSignResponse.status,
    ).toBe(409);
    expect(
      await invalidPolicyOverrideRetirementHistoryProofBundleSignResponse.json(),
    ).toEqual({
      error:
        "Execution plan blueprint recommendation policy override retirement history proof bundle is invalid",
    });

    const signedPolicyOverrideRetirementHistoryProofBundleResponse =
      await app.request(
        "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            histories: [
              policyOverrideRetirementHistory,
              policyOverrideRetirementHistory,
            ],
            threadId: selectionThread.thread.id,
            trustAnchorId: policyRetirementAnchor.id,
          }),
        },
      );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.status,
    ).toBe(201);
    const signedPolicyOverrideRetirementHistoryProofBundle =
      (await signedPolicyOverrideRetirementHistoryProofBundleResponse.json()) as TrustedReceiptEnvelope<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle>;
    expect(signedPolicyOverrideRetirementHistoryProofBundle).toEqual(
      expect.objectContaining({
        kind: "napier.trusted-receipt-envelope",
        receiptKind: "policy_retirement_proof_bundle",
        receipt: expect.objectContaining({
          kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle",
          status: "aligned",
          contentSha256:
            policyOverrideRetirementHistoryProofBundle.contentSha256,
        }),
        signature: expect.objectContaining({
          keyId: policyRetirementAnchor.keyId,
          receiptArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "cache-control",
      ),
    ).toBe("no-store");
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "content-disposition",
      ),
    ).toBe(
      `attachment; filename="napier-signed-policy-retirement-proof-bundle-${signedPolicyOverrideRetirementHistoryProofBundle.contentSha256.slice(0, 12)}.json"`,
    );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "x-napier-content-sha256",
      ),
    ).toBe(signedPolicyOverrideRetirementHistoryProofBundle.contentSha256);
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "x-napier-content-sha256-mode",
      ),
    ).toBe("stable");
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "x-napier-receipt-sha256",
      ),
    ).toBe(policyOverrideRetirementHistoryProofBundle.contentSha256);
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "x-napier-receipt-artifact-sha256",
      ),
    ).toBe(
      signedPolicyOverrideRetirementHistoryProofBundle.signature
        .receiptArtifactSha256,
    );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleResponse.headers.get(
        "x-napier-signature-key-id",
      ),
    ).toBe(policyRetirementAnchor.keyId);

    const signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse =
      await app.request("/api/receipt-trust/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: signedPolicyOverrideRetirementHistoryProofBundle,
        }),
      });
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.status,
    ).toBe(200);
    const signedPolicyOverrideRetirementHistoryProofBundleVerification =
      (await signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.json()) as TrustedReceiptVerification;
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerification,
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        receiptKind: "policy_retirement_proof_bundle",
        receiptContentSha256:
          policyOverrideRetirementHistoryProofBundle.contentSha256,
        receiptArtifactSha256:
          signedPolicyOverrideRetirementHistoryProofBundle.signature
            .receiptArtifactSha256,
        keyId: policyRetirementAnchor.keyId,
        envelopeSha256:
          signedPolicyOverrideRetirementHistoryProofBundle.contentSha256,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "cache-control",
      ),
    ).toBe("no-store");
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "x-napier-content-sha256",
      ),
    ).toBe(
      responseSha256(
        signedPolicyOverrideRetirementHistoryProofBundleVerification,
      ),
    );
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "x-napier-receipt-verification-status",
      ),
    ).toBe("trusted");
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "x-napier-receipt-kind",
      ),
    ).toBe("policy_retirement_proof_bundle");
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "x-napier-receipt-sha256",
      ),
    ).toBe(policyOverrideRetirementHistoryProofBundle.contentSha256);
    expect(
      signedPolicyOverrideRetirementHistoryProofBundleVerificationResponse.headers.get(
        "x-napier-envelope-sha256",
      ),
    ).toBe(signedPolicyOverrideRetirementHistoryProofBundle.contentSha256);
    expect(
      (await services.store.listEvents(selectionThread.thread.id)).filter(
        (event) => event.type === "receipt.signed",
      ),
    ).toEqual([
      expect.objectContaining({
        type: "receipt.signed",
        payload: expect.objectContaining({
          receiptKind: "policy_retirement_proof_bundle",
          receiptSha256:
            policyOverrideRetirementHistoryProofBundle.contentSha256,
          keyId: policyRetirementAnchor.keyId,
          envelopeSha256:
            signedPolicyOverrideRetirementHistoryProofBundle.contentSha256,
        }),
      }),
    ]);

    const stalePolicyOverrideResponse = await app.request(
      "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familySha256: portfolioCalibration.families[0]?.familySha256,
          policyTemplate: "balanced",
          expectedPortfolioSetSha256: "0".repeat(64),
        }),
      },
    );
    expect(stalePolicyOverrideResponse.status).toBe(409);
    expect(await stalePolicyOverrideResponse.json()).toEqual({
      error:
        "Execution plan blueprint recommendation policy override portfolio set changed",
    });

    const invalidOutcomeBaselineResponse = await app.request(
      `/api/plan-blueprints/${savedBlueprint.record.id}/replays/outcomes/baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcomes: replayOutcomes,
          policy: {
            unknown: true,
          },
        }),
      },
    );
    expect(invalidOutcomeBaselineResponse.status).toBe(400);
    expect(await invalidOutcomeBaselineResponse.json()).toEqual({
      error: "Execution plan blueprint outcome baseline request is invalid",
    });

    await services.store.appendEvent({
      threadId: created.thread.id,
      runId: "runctl_blueprint_drift",
      type: "plan.audit",
      category: "plan",
      visibility: "debug",
      payload: {
        planId: plan.id,
        blueprintSha256: savedBlueprint.record.blueprintSha256,
      },
    });
    const driftThread = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Blueprint drift target" }),
      })
    ).json()) as ThreadDetail;
    const driftPreviewResponse = await app.request(
      `/api/threads/${driftThread.thread.id}/plans/from-blueprint-record/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId: savedBlueprint.record.id }),
      },
    );
    expect(driftPreviewResponse.status).toBe(200);
    const driftPreview =
      (await driftPreviewResponse.json()) as ExecutionPlanBlueprintRecordPreview;
    expect(driftPreview).toEqual(
      expect.objectContaining({
        status: "not_qualified",
        diagnostics: ["source_drift"],
        threadId: driftThread.thread.id,
        recordId: savedBlueprint.record.id,
        hasOpenPlan: false,
      }),
    );
    expectExecutionPlanBlueprintRecordPreviewHeaders(
      driftPreviewResponse,
      driftPreview,
    );

    const driftCreateResponse = await app.request(
      `/api/threads/${driftThread.thread.id}/plans/from-blueprint-record`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId: savedBlueprint.record.id }),
      },
    );
    expect(driftCreateResponse.status).toBe(409);
    const driftCreatePreview =
      (await driftCreateResponse.json()) as ExecutionPlanBlueprintRecordPreview;
    expect(driftCreatePreview).toEqual(
      expect.objectContaining({
        status: "not_qualified",
        diagnostics: ["source_drift"],
        recordId: savedBlueprint.record.id,
      }),
    );
    expectExecutionPlanBlueprintRecordPreviewHeaders(
      driftCreateResponse,
      driftCreatePreview,
    );

    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.plans).toEqual(listed);
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "plan.created",
        "plan.replanned",
        "plan.step.started",
        "plan.step.completed",
        "plan.artifact.produced",
        "plan.artifact.verified",
      ]),
    );
  });

  it("reviews active replan drafts through a hash-bound public API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const provider = fauxProvider({ provider: "faux-replan-review-api" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "approve",
          score: 88,
          risk: "low",
          reason:
            "The replacement draft restores the blocked path and preserves verification.",
          concerns: ["Confirm the replacement keeps release evidence current."],
        }),
      ),
    ]);
    services.models.registerProvider(provider.provider);
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Replan review API test" }),
      })
    ).json()) as ThreadDetail;
    const run = await services.store.createRun({
      threadId: created.thread.id,
      agentId: created.agent.id,
    });
    const createResponse = await app.request(
      `/api/threads/${created.thread.id}/plans`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Recover a blocked release implementation.",
          steps: [
            {
              id: "inspect",
              title: "Inspect",
              description: "Inspect the current state.",
              verification: "Inspection evidence is recorded.",
            },
            {
              id: "implement",
              title: "Implement",
              description: "Implement the release path.",
              verification: "The implementation builds.",
              dependsOn: ["inspect"],
            },
            {
              id: "verify",
              title: "Verify",
              description: "Verify the release path.",
              verification: "All checks pass.",
              dependsOn: ["implement"],
            },
          ],
        }),
      },
    );
    const plan = (await createResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(createResponse, plan);
    await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/inspect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", runId: run.id }),
      },
    );
    await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/inspect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          evidence: "Inspection completed.",
        }),
      },
    );
    const blockedResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/steps/implement`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "block",
          blocker: "The original implementation path is blocked.",
          evidence: "The blocker is reproducible.",
        }),
      },
    );
    const blocked = (await blockedResponse.json()) as ExecutionPlan;
    expectExecutionPlanHeaders(blockedResponse, blocked);
    expect(blocked.replanRecommendation).toEqual(
      expect.objectContaining({
        strategy: "recover_blocked",
        recommendationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const invalidReview = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/replan-draft-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unexpected: true }),
      },
    );
    expect(invalidReview.status).toBe(400);

    const reviewResponse = await app.request(
      `/api/threads/${created.thread.id}/plans/${plan.id}/replan-draft-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: "faux-replan-review-api", id: "faux-1" },
        }),
      },
    );
    expect(reviewResponse.status).toBe(200);
    const review =
      (await reviewResponse.json()) as ExecutionPlanReplanDraftModelReview;
    expectExecutionPlanReplanDraftReviewHeaders(reviewResponse, review);
    expect(review).toEqual(
      expect.objectContaining({
        planId: plan.id,
        threadId: created.thread.id,
        recommendationSha256:
          blocked.replanRecommendation!.recommendationSha256,
        draftSha256: blocked.replanRecommendation!.draft.draftSha256,
        deterministicEvaluationSha256:
          blocked.replanRecommendation!.draft.evaluation.evaluationSha256,
        model: { provider: "faux-replan-review-api", id: "faux-1" },
        verdict: "approve",
        score: 88,
        risk: "low",
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      reviewResponse.headers.get(
        "x-napier-replan-review-model-context-envelope-sha256",
      ),
    ).toBe(review.modelContextEnvelope?.contentSha256);
    expect(services.store.getPlan(plan.id).revision).toBe(blocked.revision);
    expect(
      (await services.store.listEvents(created.thread.id)).map(
        (event) => event.type,
      ),
    ).not.toContain("plan.replan_draft.reviewed");
  });

  it("streams and returns the durable delegation ledger through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/public-api.ts"),
      "export const durable = true;\nexport const inspectable = true;\n",
      "utf8",
    );
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    const faux = fauxProvider({ provider: "faux-server-delegation" });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "delegate_task",
          {
            role: "reviewer",
            description: "Review public API evidence",
            task: "Inspect the public API boundary and return concise evidence.",
          },
          { id: "server-delegate-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        JSON.stringify({
          summary: "The delegation result is durable and inspectable.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Durable API projection",
              detail:
                "The thread detail returns the persisted delegation ledger.",
              evidence: [
                {
                  path: "src/public-api.ts",
                  lineStart: 1,
                  lineEnd: 2,
                },
              ],
            },
          ],
          unknowns: [],
        }),
      ),
      fauxAssistantMessage("The reviewer evidence is attached to this run."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(faux.provider);
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Delegation API test" }),
      })
    ).json()) as ThreadDetail;

    const runResponse = await app.request(
      `/api/threads/${created.thread.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Delegate the API review.",
          model: { provider: "faux-server-delegation", id: "faux-1" },
        }),
      },
    );
    expect(runResponse.status).toBe(200);
    expectThreadPromptStreamHeaders(runResponse, created.thread.id, {
      provider: "faux-server-delegation",
      id: "faux-1",
    });
    const frames = parseSseFrames(await runResponse.text());
    expectFinalDoneMatchesSnapshot(frames);
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "subagent.queued",
      ),
    ).toBe(true);
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" &&
          frame.event.type === "subagent.outcome.accepted",
      ),
    ).toBe(true);
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "subagent.completed",
      ),
    ).toBe(true);
    const snapshot = frames.find(
      (frame): frame is Extract<StreamFrame, { type: "snapshot" }> =>
        frame.type === "snapshot",
    );
    expect(snapshot?.detail.subagents).toEqual([
      expect.objectContaining({
        role: "reviewer",
        status: "completed",
        result: expect.stringContaining(
          "The delegation result is durable and inspectable.",
        ),
        outcome: expect.objectContaining({
          kind: "napier.subagent-outcome",
          itemCount: 1,
          unknownCount: 0,
          evidenceCount: 1,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ]);

    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.subagents).toEqual(snapshot?.detail.subagents);

    const task = detail.subagents[0]!;
    const eventCount = detail.events.length;
    const verificationResponse = await app.request(
      `/api/threads/${created.thread.id}/subagents/${task.id}/outcome/verify`,
      { method: "POST" },
    );
    expect(verificationResponse.status).toBe(200);
    const verification =
      (await verificationResponse.json()) as SubagentOutcomeEvidenceVerification;
    expect(verification).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-evidence-verification",
        status: "aligned",
        taskId: task.id,
        outcomeSha256: task.outcome?.contentSha256,
        evidenceCount: 1,
        alignedCount: 1,
        divergentCount: 0,
        missingCount: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(verificationResponse.headers.get("cache-control")).toBe("no-store");
    expect(
      verificationResponse.headers.get("x-napier-content-sha256-mode"),
    ).toBe("stable");
    expect(verificationResponse.headers.get("x-napier-content-sha256")).toBe(
      verification.contentSha256,
    );
    expect(
      verificationResponse.headers.get("x-napier-evidence-verification-status"),
    ).toBe("aligned");
    expect(verificationResponse.headers.get("x-napier-subagent-task-id")).toBe(
      task.id,
    );
    expect(
      verificationResponse.headers.get("x-napier-evidence-aligned-count"),
    ).toBe("1");

    await writeFile(
      path.join(workspaceRoot, "src/public-api.ts"),
      "export const durable = false;\nexport const inspectable = true;\n",
      "utf8",
    );
    const driftResponse = await app.request(
      `/api/threads/${created.thread.id}/subagents/${task.id}/outcome/verify`,
      { method: "POST" },
    );
    const drift =
      (await driftResponse.json()) as SubagentOutcomeEvidenceVerification;
    expect(drift).toEqual(
      expect.objectContaining({
        status: "divergent",
        alignedCount: 0,
        divergentCount: 1,
        missingCount: 0,
      }),
    );
    expect(
      driftResponse.headers.get("x-napier-evidence-verification-status"),
    ).toBe("divergent");
    expect(await services.store.listEvents(created.thread.id)).toHaveLength(
      eventCount,
    );

    const missingTaskResponse = await app.request(
      `/api/threads/${created.thread.id}/subagents/task_missing/outcome/verify`,
      { method: "POST" },
    );
    expect(missingTaskResponse.status).toBe(404);
    expect(missingTaskResponse.headers.get("cache-control")).toBe("no-store");
    expect(faux.state.callCount).toBe(4);
  });

  it("reviews a stored Subagent outcome with an independent no-store model", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const worker = fauxProvider({ provider: "faux-subagent-worker" });
    const reviewer = fauxProvider({ provider: "faux-subagent-reviewer" });
    reviewer.setResponses([
      (context) => {
        expect(context.tools).toEqual([]);
        expect(context.systemPrompt).toContain("independent passive reviewer");
        return fauxAssistantMessage(
          JSON.stringify({
            verdict: "accept",
            score: 94,
            risk: "low",
            reason: "The outcome is scoped and evidence-aware.",
            concerns: [],
          }),
        );
      },
    ]);
    services.models.registerProvider(worker.provider);
    services.models.registerProvider(reviewer.provider);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Subagent outcome review API",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const task = await services.store.createSubagentTask({
      threadId: thread.id,
      runId: run.id,
      role: "reviewer",
      description: "Review the API boundary.",
      prompt: "Inspect the API boundary and report unsupported claims.",
      model: { provider: worker.provider.id, id: "faux-1" },
    });
    await services.store.startSubagentTask(task.id);
    const outcome = createSubagentOutcome({
      taskId: task.id,
      role: task.role,
      model: task.model,
      prompt: task.prompt,
      resultText: JSON.stringify({
        summary: "The API boundary is explicit.",
        items: [],
        unknowns: ["External transport was not exercised."],
      }),
    });
    await services.store.finishSubagentTask(task.id, {
      status: "completed",
      stopReason: "completed",
      result: outcome.summary,
      outcome,
    });
    const eventCount = (await services.store.listEvents(thread.id)).length;
    const app = createApp(services);

    const response = await app.request(
      `/api/threads/${thread.id}/subagents/${task.id}/outcome/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: { provider: reviewer.provider.id, id: "faux-1" },
        }),
      },
    );

    expect(response.status).toBe(200);
    const review = (await response.json()) as SubagentOutcomeReview;
    expect(review).toEqual(
      expect.objectContaining({
        kind: "napier.subagent-outcome-review",
        taskId: task.id,
        outcomeSha256: outcome.contentSha256,
        workerModel: task.model,
        reviewerModel: { provider: reviewer.provider.id, id: "faux-1" },
        verdict: "accept",
        score: 94,
        risk: "low",
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
    expect(response.headers.get("x-napier-content-sha256")).toBe(
      review.reviewSha256,
    );
    expect(response.headers.get("x-napier-subagent-review-verdict")).toBe(
      "accept",
    );
    expect(response.headers.get("x-napier-subagent-review-score")).toBe("94");
    expect(response.headers.get("x-napier-subagent-review-risk")).toBe("low");
    expect(
      response.headers.get(
        "x-napier-subagent-review-model-context-envelope-sha256",
      ),
    ).toBe(review.modelContextEnvelope?.contentSha256);
    expect(await services.store.listEvents(thread.id)).toHaveLength(eventCount);
    expect(reviewer.state.callCount).toBe(1);
    expect(worker.state.callCount).toBe(0);

    const sameModel = await app.request(
      `/api/threads/${thread.id}/subagents/${task.id}/outcome/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: task.model }),
      },
    );
    expect(sameModel.status).toBe(400);
    await expect(sameModel.json()).resolves.toEqual({
      error:
        "Subagent outcome reviewer model must differ from the worker model",
    });
  });

  it("audits MCP trust, discovery, tool review, and agent enablement", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    services.extensions = new McpExtensionManager({
      store: services.store,
      createClient: async () => ({
        initialize: async () => undefined,
        listTools: async () => ({
          tools: [
            {
              name: "search",
              description: "Search approved records",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        }),
        callTool: async () => ({
          contentText: "Reviewed result",
          isError: false,
        }),
        close: async () => undefined,
      }),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Extension audit test" }),
      })
    ).json()) as ThreadDetail;
    const agent = services.store.listAgents()[0]!;

    const invalidCreateResponse = await app.request("/api/extensions/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Records",
        transport: {
          type: "streamable_http",
          url: "https://example.com/mcp",
        },
        requestedCapabilities: ["external.read"],
        threadId: created.thread.id,
        unexpected: true,
      }),
    });
    expect(invalidCreateResponse.status).toBe(400);
    expect(await invalidCreateResponse.json()).toEqual(
      expect.objectContaining({ error: "MCP extension request is invalid" }),
    );
    expect(services.store.listExtensions()).toHaveLength(0);

    const createExtensionResponse = await app.request("/api/extensions/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Records",
        transport: {
          type: "streamable_http",
          url: "https://example.com/mcp",
        },
        requestedCapabilities: ["external.read"],
        threadId: created.thread.id,
      }),
    });
    expect(createExtensionResponse.status).toBe(201);
    const proposed = (await createExtensionResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(createExtensionResponse, proposed);
    expect(proposed.trustStatus).toBe("pending");

    const invalidReviewResponse = await app.request(
      `/api/extensions/${proposed.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidReviewResponse.status).toBe(400);
    expect(await invalidReviewResponse.json()).toEqual(
      expect.objectContaining({ error: "Extension review request is invalid" }),
    );
    expect(services.store.getExtension(proposed.id)).toEqual(
      expect.objectContaining({
        trustStatus: "pending",
        revision: proposed.revision,
      }),
    );

    const approveResponse = await app.request(
      `/api/extensions/${proposed.id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          threadId: created.thread.id,
        }),
      },
    );
    expect(approveResponse.status).toBe(200);
    const approved = (await approveResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(approveResponse, approved);
    expect(approved.approvedCapabilities).toEqual([
      "external.read",
      "network.connect",
    ]);

    const invalidConnectResponse = await app.request(
      `/api/extensions/${proposed.id}/connect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidConnectResponse.status).toBe(400);
    expect(await invalidConnectResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension connect request is invalid",
      }),
    );
    expect(services.store.getExtension(proposed.id)).toEqual(
      expect.objectContaining({
        connection: expect.objectContaining({ status: "untested" }),
      }),
    );

    const connectResponse = await app.request(
      `/api/extensions/${proposed.id}/connect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(connectResponse.status).toBe(200);
    const connected = (await connectResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(connectResponse, connected);
    expect(connected.connection.status).toBe("ready");
    expect(connected.tools[0]?.reviewStatus).toBe("pending");

    const invalidToolReviewResponse = await app.request(
      `/api/extensions/${proposed.id}/tools/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "search",
          action: "approve",
          effect: "read",
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidToolReviewResponse.status).toBe(400);
    expect(await invalidToolReviewResponse.json()).toEqual(
      expect.objectContaining({ error: "MCP tool review request is invalid" }),
    );
    expect(services.store.getExtension(proposed.id).tools[0]).toEqual(
      expect.objectContaining({
        reviewStatus: "pending",
        effect: "unknown",
      }),
    );

    const toolReviewResponse = await app.request(
      `/api/extensions/${proposed.id}/tools/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "search",
          action: "approve",
          effect: "read",
          threadId: created.thread.id,
        }),
      },
    );
    expect(toolReviewResponse.status).toBe(200);
    const reviewed = (await toolReviewResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(toolReviewResponse, reviewed);
    expect(reviewed.tools[0]).toEqual(
      expect.objectContaining({
        directName: "mcp__records__search",
        reviewStatus: "approved",
        effect: "read",
      }),
    );

    const invalidEnabledResponse = await app.request(
      `/api/extensions/${proposed.id}/enabled`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          enabled: true,
          threadId: created.thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidEnabledResponse.status).toBe(400);
    expect(await invalidEnabledResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension enablement request is invalid",
      }),
    );
    expect(services.store.getExtension(proposed.id).enabledAgentIds).toEqual(
      [],
    );

    const enableResponse = await app.request(
      `/api/extensions/${proposed.id}/enabled`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          enabled: true,
          threadId: created.thread.id,
        }),
      },
    );
    expect(enableResponse.status).toBe(200);
    const enabled = (await enableResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(enableResponse, enabled);
    expect(enabled.enabledAgentIds).toContain(agent.id);

    const listResponse = await app.request(`/api/extensions?agent=${agent.id}`);
    expect(listResponse.status).toBe(200);
    const extensions = (await listResponse.json()) as ExtensionRecord[];
    expectExtensionListHeaders(listResponse, extensions, agent.id);
    expect(extensions).toEqual([enabled]);

    const bootstrap = (await (await app.request("/api/bootstrap")).json()) as {
      extensions: ExtensionRecord[];
    };
    expect(bootstrap.extensions).toEqual([
      expect.objectContaining({
        id: proposed.id,
        trustStatus: "approved",
        enabledAgentIds: [agent.id],
      }),
    ]);

    const disconnectResponse = await app.request(
      `/api/extensions/${proposed.id}/disconnect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(disconnectResponse.status).toBe(200);
    const disconnected = (await disconnectResponse.json()) as ExtensionRecord;
    expectExtensionRecordHeaders(disconnectResponse, disconnected);
    expect(disconnected.connection.status).toBe("disconnected");

    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "extension.proposed",
        "extension.approved",
        "extension.connected",
        "extension.tool.approved",
        "extension.enabled",
        "extension.disconnected",
      ]),
    );
  });

  it("normalizes sandboxed stdio MCP proposals without launching a process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Stdio proposal audit" }),
      })
    ).json()) as ThreadDetail;

    const response = await app.request("/api/extensions/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Local records",
        transport: {
          type: "stdio",
          command: "/usr/local/bin/records-mcp",
          args: ["--stdio"],
          cwd: "services/records",
          env: { MCP_TOKEN: "RECORDS_SOURCE_TOKEN" },
        },
        requestedCapabilities: [
          "workspace.write",
          "external.write",
          "network.connect",
        ],
        threadId: created.thread.id,
      }),
    });
    expect(response.status).toBe(201);
    const proposed = (await response.json()) as ExtensionRecord;
    expect(proposed).toEqual(
      expect.objectContaining({
        trustStatus: "pending",
        transport: {
          type: "stdio",
          command: "/usr/local/bin/records-mcp",
          args: ["--stdio"],
          cwd: "services/records",
          env: { MCP_TOKEN: "RECORDS_SOURCE_TOKEN" },
        },
        requestedCapabilities: [
          "external.write",
          "network.connect",
          "process.spawn",
          "secrets.env",
          "workspace.read",
          "workspace.write",
        ],
      }),
    );
    expect(proposed.connection.status).toBe("untested");

    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    const event = detail.events.find(
      (candidate) => candidate.type === "extension.proposed",
    );
    expect(event).toBeDefined();
    expect(JSON.stringify(event?.payload)).not.toContain(
      "/usr/local/bin/records-mcp",
    );
    expect(JSON.stringify(event?.payload)).not.toContain(
      "RECORDS_SOURCE_TOKEN",
    );
  });

  it("streams explicit recovery of a restart-interrupted run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const firstServices = await createServices(options);
    const agent = firstServices.store.listAgents()[0]!;
    const thread = await firstServices.store.createThread({
      title: "Recovery API test",
      agentId: agent.id,
    });
    const interrupted = await firstServices.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await firstServices.store.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Resume this work safely." },
    });

    const services = await createServices(options);
    const faux = fauxProvider({ provider: "faux-server-recovery" });
    faux.setResponses([
      fauxAssistantMessage(
        "Recovered after inspecting durable evidence and current state.",
      ),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(faux.provider);
    const app = createApp(services);

    const response = await app.request(`/api/threads/${thread.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: interrupted.id,
        model: { provider: "faux-server-recovery", id: "faux-1" },
      }),
    });
    expect(response.status).toBe(200);
    expectThreadResumeStreamHeaders(response, thread.id, interrupted.id, {
      provider: "faux-server-recovery",
      id: "faux-1",
    });
    const frames = parseSseFrames(await response.text());
    const done = expectFinalDoneMatchesSnapshot(frames);
    expect(
      frames.some(
        (frame) =>
          frame.type === "event" && frame.event.type === "run.recovery.started",
      ),
    ).toBe(true);
    const snapshot = frames.find(
      (frame): frame is Extract<StreamFrame, { type: "snapshot" }> =>
        frame.type === "snapshot",
    );
    expect(snapshot?.detail.thread.status).toBe("idle");
    expect(snapshot?.detail.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: interrupted.id,
          status: "interrupted",
        }),
        expect.objectContaining({
          status: "completed",
          parentRunId: interrupted.id,
        }),
      ]),
    );
    expect(done).toEqual(
      expect.objectContaining({ type: "done", status: "completed" }),
    );
    expect(faux.state.callCount).toBe(2);
  });

  it("exposes hash-only automatic recovery evidence after a safe restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const options = {
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    };
    const firstServices = await createServices(options);
    const sourceAgent = await firstServices.store.updateAgent(
      firstServices.store.listAgents()[0]!.id,
      {
        model: { provider: "faux-server-auto", id: "faux-1" },
        automaticRecovery: {
          mode: "safe_read_only",
          maxAttempts: 2,
          backoffMs: 1_000,
        },
      },
    );
    const thread = await firstServices.store.createThread({
      title: "Automatic recovery API test",
      agentId: sourceAgent.id,
    });
    const interrupted = await firstServices.store.createRun({
      threadId: thread.id,
      agentId: sourceAgent.id,
    });
    await firstServices.store.appendEvent({
      threadId: thread.id,
      runId: interrupted.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "Sensitive recovery prompt must stay out of control events.",
      },
    });
    firstServices.store.close();

    const services = await createServices(options);
    const faux = fauxProvider({ provider: "faux-server-auto" });
    faux.setResponses([
      fauxAssistantMessage("Recovered from the frozen read-only snapshot."),
    ]);
    services.models.registerProvider(faux.provider);
    const app = createApp(services);
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const sweep = await services.recovery.sweep();
    expect(sweep.completed).toBe(1);

    const response = await app.request(`/api/threads/${thread.id}/recovery`);
    expect(response.status).toBe(200);
    const recovery = (await response.json()) as {
      assessments: Array<{
        eligible: boolean;
        contentSha256: string;
      }>;
      attempts: Array<{
        status: string;
        interruptedRunId: string;
        recoveryRunId?: string;
      }>;
    };
    expectAutomaticRecoveryProjectionHeaders(response, recovery);
    expect(recovery.assessments).toEqual([
      expect.objectContaining({
        eligible: true,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(recovery.attempts).toEqual([
      expect.objectContaining({
        status: "completed",
        interruptedRunId: interrupted.id,
        recoveryRunId: expect.stringMatching(/^run_/),
      }),
    ]);
    expect(JSON.stringify(recovery)).not.toContain("Sensitive recovery prompt");
  });

  it("creates and executes revisioned evaluation quality gates through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Evaluation suite API",
      agentId: agent.id,
    });
    const runIds: string[] = [];
    for (const text of ["Baseline", "Candidate A", "Candidate B"]) {
      const run = await services.store.createRun({
        threadId: thread.id,
        agentId: agent.id,
      });
      await services.store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: { role: "assistant", text },
      });
      await services.store.finishRun(run.id, "completed");
      runIds.push(run.id);
    }
    const provider = fauxProvider({ provider: "faux-suite-api" });
    provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "right_better",
          reason: "Candidate A has stronger evidence.",
          evidence: "Recorded candidate evidence.",
          scores: ["correctness", "evidence", "safety", "efficiency"].map(
            (criterionId) => ({
              criterionId,
              leftScore: 3,
              rightScore: 4,
              reason: "Candidate improves the criterion.",
            }),
          ),
        }),
      ),
      fauxAssistantMessage(
        JSON.stringify({
          verdict: "tie",
          reason: "Candidate B is equivalent.",
          evidence: "Equivalent recorded evidence.",
          scores: ["correctness", "evidence", "safety", "efficiency"].map(
            (criterionId) => ({
              criterionId,
              leftScore: 3,
              rightScore: 3,
              reason: "The criterion is equivalent.",
            }),
          ),
        }),
      ),
    ]);
    services.models.registerProvider(provider.provider);

    const invalidCreateResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid release gate",
          baselineRunId: runIds[0],
          candidateRunIds: runIds.slice(1),
          model: { provider: "faux-suite-api", id: "faux-1" },
          unexpected: true,
        }),
      },
    );
    expect(invalidCreateResponse.status).toBe(400);
    expect(await invalidCreateResponse.json()).toEqual(
      expect.objectContaining({ error: "Evaluation suite request is invalid" }),
    );
    expect(services.store.listEvaluationSuites(thread.id)).toHaveLength(0);

    const createResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Release gate",
          baselineRunId: runIds[0],
          candidateRunIds: runIds.slice(1),
          model: { provider: "faux-suite-api", id: "faux-1" },
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as EvaluationSuite;
    expectEvaluationSuiteProjectionHeaders(createResponse, created);
    expect(created).toEqual(
      expect.objectContaining({
        revision: 1,
        baselineRunId: runIds[0],
        candidateRunIds: runIds.slice(1),
      }),
    );

    const invalidUpdateResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gate: { minimumPassRate: 0.5 },
          unexpected: true,
        }),
      },
    );
    expect(invalidUpdateResponse.status).toBe(400);
    expect(await invalidUpdateResponse.json()).toEqual(
      expect.objectContaining({
        error: "Evaluation suite update request is invalid",
      }),
    );
    expect(services.store.getEvaluationSuite(created.id)).toEqual(
      expect.objectContaining({ revision: created.revision }),
    );

    const updateResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${created.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gate: { minimumPassRate: 0.5 },
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as EvaluationSuite;
    expectEvaluationSuiteProjectionHeaders(updateResponse, updated);
    expect(updated).toEqual(
      expect.objectContaining({
        revision: 2,
        gate: expect.objectContaining({ minimumPassRate: 0.5 }),
      }),
    );

    const unavailableSuiteProvider = fauxProvider({
      provider: "faux-suite-api",
    });
    services.models.registerProvider({
      ...unavailableSuiteProvider.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const unavailableExecuteResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${created.id}/executions`,
      { method: "POST" },
    );
    expect(unavailableExecuteResponse.status).toBe(400);
    expect(await unavailableExecuteResponse.json()).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-suite-api",
      }),
    );
    expect(
      services.store.listEvaluationSuiteExecutions(thread.id, created.id),
    ).toHaveLength(0);
    services.models.registerProvider(provider.provider);

    const executeResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${created.id}/executions`,
      { method: "POST" },
    );
    expect(executeResponse.status).toBe(201);
    const execution =
      (await executeResponse.json()) as EvaluationSuiteExecution;
    expectEvaluationSuiteExecutionHeaders(executeResponse, execution);
    expect(execution).toEqual(
      expect.objectContaining({
        suiteId: created.id,
        suiteRevision: 2,
        status: "passed",
        passedCount: 2,
        passRate: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const receiptResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${created.id}/receipt`,
    );
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers.get("cache-control")).toBe("no-store");
    expect(receiptResponse.headers.get("content-disposition")).toMatch(
      new RegExp(
        `^attachment; filename="napier-gate-${created.id}-r2-[a-f0-9]{12}\\.json"$`,
      ),
    );
    const receipt =
      (await receiptResponse.json()) as EvaluationSuiteGateReceipt;
    expectEvaluationSuiteGateReceiptHeaders(receiptResponse, receipt);
    expect(receipt).toEqual(
      expect.objectContaining({
        state: "passed",
        suite: updated,
        execution,
        evaluations: expect.arrayContaining([
          expect.objectContaining({ id: execution.results[0]!.evaluationId }),
          expect.objectContaining({ id: execution.results[1]!.evaluationId }),
        ]),
      }),
    );
    expect(validateEvaluationSuiteGateReceipt(receipt)).toEqual(receipt);

    const suiteListResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites`,
    );
    expect(suiteListResponse.status).toBe(200);
    const suites = (await suiteListResponse.json()) as EvaluationSuite[];
    expectEvaluationSuiteListHeaders(suiteListResponse, thread.id, suites);
    expect(suites).toEqual([updated]);

    const executionListResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suite-executions?suite=${created.id}`,
    );
    expect(executionListResponse.status).toBe(200);
    const executions =
      (await executionListResponse.json()) as EvaluationSuiteExecution[];
    expectEvaluationSuiteExecutionListHeaders(
      executionListResponse,
      thread.id,
      created.id,
      executions,
    );
    expect(executions).toEqual([execution]);

    const detail = (await (
      await app.request(`/api/threads/${thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.evaluationSuites).toEqual([updated]);
    expect(detail.evaluationSuiteExecutions).toEqual([execution]);
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "evaluation.suite.created",
        "evaluation.suite.updated",
        "evaluation.suite.completed",
      ]),
    );
  });

  it("resolves independent reviewer ballots into consensus truth", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Consensus review API",
      agentId: agent.id,
    });
    const left = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.finishRun(left.id, "completed");
    const right = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.finishRun(right.id, "completed");
    const evaluation = await services.store.saveRunEvaluation({
      id: "evaluation_consensus_api",
      threadId: thread.id,
      leftRunId: left.id,
      rightRunId: right.id,
      leftSnapshotSha256: "a".repeat(64),
      rightSnapshotSha256: "b".repeat(64),
      rubric: {
        name: "Consensus API rubric",
        criteria: [
          {
            id: "correctness",
            name: "Correctness",
            description: "The result is supported by evidence.",
          },
        ],
      },
      scores: [
        {
          criterionId: "correctness",
          leftScore: 3,
          rightScore: 4,
          reason: "The candidate has stronger evidence.",
        },
      ],
      verdict: "right_better",
      reason: "The candidate is better supported.",
      evidence: "Compared immutable snapshots.",
      evaluatorModel: { provider: "faux", id: "judge-1" },
      createdAt: "2026-07-25T15:00:00.000Z",
    });
    const basePath = `/api/threads/${thread.id}/evaluations/${evaluation.id}`;

    const forgedProvenance = await app.request(`${basePath}/adjudication`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVerdict: "right_better",
        source: "reviewer_consensus",
        sourceSha256: "0".repeat(64),
      }),
    });
    expect(forgedProvenance.status).toBe(400);

    const invalid = await app.request(`${basePath}/reviewer-ballots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewerId: "reviewer_a",
        reviewerName: "Reviewer A",
        expectedVerdict: "right_better",
        unsupported: true,
      }),
    });
    expect(invalid.status).toBe(400);

    const firstResponse = await app.request(`${basePath}/reviewer-ballots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewerId: "reviewer_a",
        reviewerName: "Reviewer A",
        expectedVerdict: "right_better",
        note: "Private first-review rationale.",
      }),
    });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as EvaluationReviewerBallot;
    expectEvaluationReviewerBallotHeaders(firstResponse, first);
    const eventsAfterFirst = await services.store.listEvents(thread.id);
    const noOp = await app.request(`${basePath}/reviewer-ballots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewerId: "REVIEWER_A",
        reviewerName: "Reviewer A",
        expectedVerdict: "right_better",
        note: "Private first-review rationale.",
      }),
    });
    expect(noOp.status).toBe(200);
    const noOpBallot = (await noOp.json()) as EvaluationReviewerBallot;
    expectEvaluationReviewerBallotHeaders(noOp, noOpBallot);
    expect(noOpBallot).toEqual(first);
    expect(await services.store.listEvents(thread.id)).toHaveLength(
      eventsAfterFirst.length,
    );

    const insufficientResponse = await app.request(
      `${basePath}/consensus/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(insufficientResponse.status).toBe(200);
    const insufficient =
      (await insufficientResponse.json()) as EvaluationConsensusReport;
    expectEvaluationConsensusReportHeaders(insufficientResponse, insufficient);
    expect(insufficient).toEqual(
      expect.objectContaining({
        status: "insufficient_reviewers",
        reviewerCount: 1,
      }),
    );
    expect(
      (
        await app.request(`${basePath}/consensus/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(409);

    const secondResponse = await app.request(`${basePath}/reviewer-ballots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewerId: "reviewer_b",
        reviewerName: "Reviewer B",
        expectedVerdict: "right_better",
        note: "Private second-review rationale.",
      }),
    });
    expect(secondResponse.status).toBe(201);
    const second = (await secondResponse.json()) as EvaluationReviewerBallot;
    expectEvaluationReviewerBallotHeaders(secondResponse, second);
    const resolveResponse = await app.request(`${basePath}/consensus/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gate: {
          minimumReviewers: 2,
          minimumAgreementRate: 1,
          allowInconclusive: false,
        },
      }),
    });
    expect(resolveResponse.status).toBe(201);
    const resolved =
      (await resolveResponse.json()) as ResolveEvaluationConsensusResult;
    expectEvaluationConsensusResolutionResultHeaders(resolveResponse, resolved);
    expect(resolved).toEqual(
      expect.objectContaining({
        created: true,
        report: expect.objectContaining({
          status: "ready",
          reviewerCount: 2,
          consensusVerdict: "right_better",
          agreementRate: 1,
        }),
        adjudication: expect.objectContaining({ currentRevision: 1 }),
      }),
    );
    expect(resolved.adjudication.revisions[0]).toEqual(
      expect.objectContaining({
        source: "reviewer_consensus",
        sourceSha256: resolved.report.contentSha256,
      }),
    );
    const eventsAfterResolution = await services.store.listEvents(thread.id);
    const repeated = await app.request(`${basePath}/consensus/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gate: {
          minimumReviewers: 2,
          minimumAgreementRate: 1,
          allowInconclusive: false,
        },
      }),
    });
    expect(repeated.status).toBe(200);
    const repeatedResult =
      (await repeated.json()) as ResolveEvaluationConsensusResult;
    expectEvaluationConsensusResolutionResultHeaders(repeated, repeatedResult);
    expect(repeatedResult).toEqual(expect.objectContaining({ created: false }));
    expect(await services.store.listEvents(thread.id)).toHaveLength(
      eventsAfterResolution.length,
    );

    const ballotListResponse = await app.request(
      `${basePath}/reviewer-ballots`,
    );
    expect(ballotListResponse.status).toBe(200);
    const ballots =
      (await ballotListResponse.json()) as EvaluationReviewerBallot[];
    expectEvaluationReviewerBallotListHeaders(
      ballotListResponse,
      thread.id,
      evaluation.id,
      ballots,
    );
    expect(ballots).toHaveLength(2);
    const consensusResolutionListResponse = await app.request(
      `${basePath}/consensus-resolutions`,
    );
    expect(consensusResolutionListResponse.status).toBe(200);
    const consensusResolutions =
      (await consensusResolutionListResponse.json()) as EvaluationConsensusResolution[];
    expectEvaluationConsensusResolutionListHeaders(
      consensusResolutionListResponse,
      thread.id,
      evaluation.id,
      consensusResolutions,
    );
    expect(consensusResolutions).toHaveLength(1);
    const detail = (await (
      await app.request(`/api/threads/${thread.id}`)
    ).json()) as ThreadDetail;
    expect(detail.evaluationReviewerBallots).toHaveLength(2);
    expect(detail.evaluationConsensusResolutions).toHaveLength(1);
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "evaluation.reviewer_ballot.recorded",
        "evaluation.consensus.resolved",
      ]),
    );
    expect(JSON.stringify(detail.events)).not.toContain("Reviewer A");
    expect(JSON.stringify(detail.events)).not.toContain(
      "Private first-review rationale.",
    );
  });

  it("exports, evaluates, and imports replay evidence through public APIs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-"));
    temporaryRoots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Run Lab API test" }),
      })
    ).json()) as ThreadDetail;

    for (const text of ["Inspect this ledger.", "Verify this ledger."]) {
      const response = await app.request(
        `/api/threads/${created.thread.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      expect(response.status).toBe(200);
      expectFinalDoneMatchesSnapshot(parseSseFrames(await response.text()));
    }
    const detail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    const [left, right] = detail.runs;
    expect(left).toBeDefined();
    expect(right).toBeDefined();

    const replayResponse = await app.request(
      `/api/threads/${created.thread.id}/runs/${left!.id}/replay`,
    );
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.headers.get("content-disposition")).toContain(
      `${left!.id}-replay.json`,
    );
    const replay = (await replayResponse.json()) as RunReplaySnapshot;
    expectRunReplaySnapshotHeaders(replayResponse, replay);
    expect(replay).toEqual(
      expect.objectContaining({
        threadId: created.thread.id,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        eventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        configurationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(replay.events.every((event) => event.runId === left!.id)).toBe(true);
    expect(replay.subagents).toEqual([]);

    const replayVerifyResponse = await app.request(
      `/api/threads/${created.thread.id}/runs/${left!.id}/replay/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: replay }),
      },
    );
    expect(replayVerifyResponse.status).toBe(200);
    const replayVerification =
      (await replayVerifyResponse.json()) as RunReplaySnapshotVerification;
    expectRunReplaySnapshotVerificationHeaders(
      replayVerifyResponse,
      replayVerification,
    );
    expect(replayVerification).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: created.thread.id,
      runId: left!.id,
      contentSha256: replay.contentSha256,
      eventStreamSha256: replay.eventStreamSha256,
      configurationSha256: replay.configurationSha256,
      assistantTextSha256: replay.metrics.assistantTextSha256,
      eventCount: replay.events.length,
      subagentCount: replay.subagents.length,
      modelContextEnvelopeCount: replay.metrics.modelContextEnvelopeCount,
      embeddedModelContextEnvelopeCount:
        replay.metrics.embeddedModelContextEnvelopeCount,
    });

    const pathMismatchReplayVerifyResponse = await app.request(
      `/api/threads/${created.thread.id}/runs/${right!.id}/replay/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: replay }),
      },
    );
    expect(pathMismatchReplayVerifyResponse.status).toBe(200);
    const pathMismatchReplayVerification =
      (await pathMismatchReplayVerifyResponse.json()) as RunReplaySnapshotVerification;
    expectRunReplaySnapshotVerificationHeaders(
      pathMismatchReplayVerifyResponse,
      pathMismatchReplayVerification,
    );
    expect(pathMismatchReplayVerification).toEqual({
      ...replayVerification,
      status: "invalid",
      diagnostics: ["path_mismatch"],
    });

    const tamperedReplay = structuredClone(replay);
    tamperedReplay.events[0]!.payload = { text: "tampered run replay" };
    const rejectedReplayVerifyResponse = await app.request(
      `/api/threads/${created.thread.id}/runs/${left!.id}/replay/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: tamperedReplay }),
      },
    );
    expect(rejectedReplayVerifyResponse.status).toBe(200);
    const rejectedReplayVerification =
      (await rejectedReplayVerifyResponse.json()) as RunReplaySnapshotVerification;
    expectRunReplaySnapshotVerificationHeaders(
      rejectedReplayVerifyResponse,
      rejectedReplayVerification,
    );
    expect(rejectedReplayVerification).toEqual({
      status: "invalid",
      diagnostics: ["hash_mismatch"],
      eventCount: 0,
      subagentCount: 0,
      modelContextEnvelopeCount: 0,
      embeddedModelContextEnvelopeCount: 0,
    });

    const threadCountBeforeInvalidBranch = services.store.listThreads().length;
    const invalidBranchResponse = await app.request(
      `/api/threads/${created.thread.id}/branches`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromSeq: detail.events.at(-1)!.seq,
          title: "Invalid branch",
          unexpected: true,
        }),
      },
    );
    expect(invalidBranchResponse.status).toBe(400);
    expect(await invalidBranchResponse.json()).toEqual(
      expect.objectContaining({ error: "Thread branch request is invalid" }),
    );
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeInvalidBranch,
    );

    const branchResponse = await app.request(
      `/api/threads/${created.thread.id}/branches`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromSeq: detail.events.at(-1)!.seq,
          title: "Run Lab branch",
        }),
      },
    );
    expect(branchResponse.status).toBe(201);
    const branch = (await branchResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(branchResponse, branch);
    expect(branch.thread).toEqual(
      expect.objectContaining({
        title: "Run Lab branch",
        agentId: created.agent.id,
      }),
    );
    expect(branch.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["branch.created", "message.user"]),
    );
    expect(branch.runs[0]).toEqual(
      expect.objectContaining({
        branchFromSeq: detail.events.at(-1)!.seq,
        status: "completed",
      }),
    );

    const comparisonResponse = await app.request(
      `/api/threads/${created.thread.id}/runs/compare?left=${left!.id}&right=${right!.id}`,
    );
    expect(comparisonResponse.status).toBe(200);
    const comparison = (await comparisonResponse.json()) as RunComparison;
    expectRunComparisonHeaders(comparisonResponse, comparison);
    expect(comparison.left.run.id).toBe(left!.id);
    expect(comparison.right.run.id).toBe(right!.id);
    expect(comparison.configurationDelta).toEqual(
      expect.objectContaining({
        status: "comparable",
        changedFields: [],
        leftSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rightSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const invalidEvaluationResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leftRunId: left!.id,
          rightRunId: right!.id,
          model: { provider: "napier", id: "demo" },
          unexpected: true,
        }),
      },
    );
    expect(invalidEvaluationResponse.status).toBe(400);
    expect(await invalidEvaluationResponse.json()).toEqual(
      expect.objectContaining({ error: "Run evaluation request is invalid" }),
    );
    expect(services.store.listRunEvaluations(created.thread.id)).toHaveLength(
      0,
    );

    const unconfiguredEvaluator = fauxProvider({
      provider: "faux-evaluation-unconfigured",
    });
    services.models.registerProvider({
      ...unconfiguredEvaluator.provider,
      auth: {
        apiKey: {
          name: "Unavailable",
          resolve: async () => undefined,
        },
      },
    });
    const unconfiguredEvaluationResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leftRunId: left!.id,
          rightRunId: right!.id,
          model: { provider: "faux-evaluation-unconfigured", id: "faux-1" },
        }),
      },
    );
    expect(unconfiguredEvaluationResponse.status).toBe(400);
    expect(await unconfiguredEvaluationResponse.json()).toEqual(
      expect.objectContaining({
        error: "Model provider is not configured: faux-evaluation-unconfigured",
      }),
    );
    expect(services.store.listRunEvaluations(created.thread.id)).toHaveLength(
      0,
    );

    const evaluationResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leftRunId: left!.id,
          rightRunId: right!.id,
          model: { provider: "napier", id: "demo" },
        }),
      },
    );
    expect(evaluationResponse.status).toBe(201);
    const evaluation = (await evaluationResponse.json()) as RunEvaluationRecord;
    expectRunEvaluationRecordHeaders(evaluationResponse, evaluation);
    expect(evaluation).toEqual(
      expect.objectContaining({
        leftRunId: left!.id,
        rightRunId: right!.id,
        verdict: "inconclusive",
      }),
    );

    const evaluationsResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations`,
    );
    expect(evaluationsResponse.status).toBe(200);
    const evaluations =
      (await evaluationsResponse.json()) as RunEvaluationRecord[];
    expectRunEvaluationListHeaders(
      evaluationsResponse,
      created.thread.id,
      evaluations,
    );
    expect(evaluations).toEqual([evaluation]);
    const refreshed = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(refreshed.evaluations).toEqual([evaluation]);
    expect(refreshed.events.at(-1)?.type).toBe("evaluation.completed");

    const invalidReviewResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations/${evaluation.id}/adjudication`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVerdict: "teleported",
          note: "Invalid truth label.",
        }),
      },
    );
    expect(invalidReviewResponse.status).toBe(400);

    const firstReviewResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations/${evaluation.id}/adjudication`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVerdict: "right_better",
          note: "The first human review preferred the candidate.",
        }),
      },
    );
    expect(firstReviewResponse.status).toBe(201);
    const firstReview =
      (await firstReviewResponse.json()) as EvaluationAdjudication;
    expectEvaluationAdjudicationHeaders(firstReviewResponse, firstReview);
    expect(firstReview).toEqual(
      expect.objectContaining({
        evaluationId: evaluation.id,
        currentRevision: 1,
        revisions: [
          expect.objectContaining({
            expectedVerdict: "right_better",
            evaluationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    const detailAfterFirstReview = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    const noOpReviewResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations/${evaluation.id}/adjudication`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVerdict: "right_better",
          note: "The first human review preferred the candidate.",
        }),
      },
    );
    expect(noOpReviewResponse.status).toBe(200);
    const noOpReview =
      (await noOpReviewResponse.json()) as EvaluationAdjudication;
    expectEvaluationAdjudicationHeaders(noOpReviewResponse, noOpReview);
    expect(noOpReview).toEqual(firstReview);
    expect(
      (
        (await (
          await app.request(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail
      ).events,
    ).toHaveLength(detailAfterFirstReview.events.length);

    const revisedReviewResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluations/${evaluation.id}/adjudication`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVerdict: "inconclusive",
          note: "A second review confirmed the model's fail-closed verdict.",
        }),
      },
    );
    expect(revisedReviewResponse.status).toBe(200);
    const revisedReview =
      (await revisedReviewResponse.json()) as EvaluationAdjudication;
    expectEvaluationAdjudicationHeaders(revisedReviewResponse, revisedReview);
    expect(revisedReview.currentRevision).toBe(2);
    const adjudicationsResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluation-adjudications`,
    );
    expect(adjudicationsResponse.status).toBe(200);
    const adjudications =
      (await adjudicationsResponse.json()) as EvaluationAdjudication[];
    expectEvaluationAdjudicationListHeaders(
      adjudicationsResponse,
      created.thread.id,
      adjudications,
    );
    expect(adjudications).toEqual([revisedReview]);

    const calibrationResponse = await app.request(
      `/api/threads/${created.thread.id}/evaluation-calibration`,
    );
    expect(calibrationResponse.status).toBe(200);
    const calibration =
      (await calibrationResponse.json()) as EvaluationCalibrationReport;
    expectEvaluationCalibrationHeaders(calibrationResponse, calibration);
    expect(calibration).toEqual(
      expect.objectContaining({
        sampleCount: 1,
        agreementCount: 1,
        agreementRate: 1,
        samples: [
          expect.objectContaining({
            evaluationId: evaluation.id,
            adjudicationId: revisedReview.id,
            adjudicationRevision: 2,
            modelVerdict: "inconclusive",
            expectedVerdict: "inconclusive",
            agreement: true,
          }),
        ],
      }),
    );
    const reviewedDetail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(reviewedDetail.evaluationAdjudications).toEqual([revisedReview]);
    expect(reviewedDetail.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "evaluation.adjudication.reviewed",
        payload: expect.objectContaining({
          evaluationId: evaluation.id,
          adjudicationId: revisedReview.id,
          revision: 2,
          agreement: true,
        }),
      }),
    );
    expect(JSON.stringify(reviewedDetail.events)).not.toContain(
      revisedReview.revisions[1]!.note,
    );

    const invalidCasebookResponse = await app.request(
      "/api/evaluation-casebooks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          name: "Invalid Casebook",
          unsupported: true,
        }),
      },
    );
    expect(invalidCasebookResponse.status).toBe(400);
    expect(await invalidCasebookResponse.json()).toEqual(
      expect.objectContaining({ error: "Casebook request is invalid" }),
    );
    expect(services.store.listEvaluationCasebooks()).toHaveLength(0);

    const createCasebookResponse = await app.request(
      "/api/evaluation-casebooks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          name: "Release evaluator gold set",
          description: "Reviewed evidence across durable Threads.",
        }),
      },
    );
    expect(createCasebookResponse.status).toBe(201);
    const casebook =
      (await createCasebookResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(createCasebookResponse, casebook);
    expect(casebook).toEqual(
      expect.objectContaining({
        currentRevision: 1,
        cases: [],
        revisions: [
          expect.objectContaining({
            source: "created",
            caseIds: [],
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    const casebookListResponse = await app.request("/api/evaluation-casebooks");
    expect(casebookListResponse.status).toBe(200);
    const casebooks =
      (await casebookListResponse.json()) as EvaluationCasebook[];
    expectEvaluationCasebookListHeaders(casebookListResponse, casebooks);
    expect(casebooks).toEqual([casebook]);

    const casebookProjectionResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}`,
    );
    expect(casebookProjectionResponse.status).toBe(200);
    const projectedCasebook =
      (await casebookProjectionResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(
      casebookProjectionResponse,
      projectedCasebook,
    );
    expect(projectedCasebook).toEqual(casebook);

    const invalidCurateCaseResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/cases`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          evaluationId: evaluation.id,
          unsupported: true,
        }),
      },
    );
    expect(invalidCurateCaseResponse.status).toBe(400);
    expect(await invalidCurateCaseResponse.json()).toEqual(
      expect.objectContaining({ error: "Casebook curation is invalid" }),
    );
    expect(services.store.getEvaluationCasebook(casebook.id)).toEqual(casebook);

    const curateCaseResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/cases`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          evaluationId: evaluation.id,
        }),
      },
    );
    expect(curateCaseResponse.status).toBe(201);
    const curated = (await curateCaseResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(curateCaseResponse, curated);
    const curatedCase = curated.cases.find(
      (item) => item.id === curated.revisions.at(-1)!.caseIds[0],
    )!;
    expect(curated).toEqual(
      expect.objectContaining({
        currentRevision: 2,
        revisions: expect.arrayContaining([
          expect.objectContaining({
            source: "case_curated",
            sourceEvaluationId: evaluation.id,
            caseIds: [curatedCase.id],
          }),
        ]),
        cases: [
          expect.objectContaining({
            sourceAdjudicationId: revisedReview.id,
            adjudicationRevision: revisedReview.revisions[1],
            evaluation,
          }),
        ],
      }),
    );
    const detailAfterCuration = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    const noOpCurationResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/cases`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          evaluationId: evaluation.id,
        }),
      },
    );
    expect(noOpCurationResponse.status).toBe(200);
    const noOpCurated =
      (await noOpCurationResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(
      noOpCurationResponse,
      noOpCurated,
    );
    expect(noOpCurated).toEqual(curated);
    expect(
      (
        (await (
          await app.request(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail
      ).events,
    ).toHaveLength(detailAfterCuration.events.length);

    const invalidQualificationResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualifications`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          model: { provider: "napier", id: "demo" },
          unsupported: true,
        }),
      },
    );
    expect(invalidQualificationResponse.status).toBe(400);
    expect(await invalidQualificationResponse.json()).toEqual(
      expect.objectContaining({
        error: "Casebook qualification request is invalid",
      }),
    );
    expect(
      services.store.listEvaluationCasebookQualificationExecutions(casebook.id),
    ).toEqual([]);

    const notRunQualificationReceiptResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-receipt`,
    );
    expect(notRunQualificationReceiptResponse.status).toBe(200);
    const notRunQualificationReceipt =
      (await notRunQualificationReceiptResponse.json()) as EvaluationCasebookQualificationReceipt;
    expectEvaluationCasebookQualificationReceiptHeaders(
      notRunQualificationReceiptResponse,
      notRunQualificationReceipt,
    );
    expect(notRunQualificationReceipt.state).toBe("not_run");

    const qualificationResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualifications`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          model: { provider: "napier", id: "demo" },
          gate: {
            minimumAgreementRate: 1,
            allowInconclusive: false,
          },
        }),
      },
    );
    expect(qualificationResponse.status).toBe(201);
    const qualification =
      (await qualificationResponse.json()) as EvaluationCasebookQualificationExecution;
    expectEvaluationCasebookQualificationExecutionHeaders(
      qualificationResponse,
      qualification,
    );
    expect(qualification).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        casebookRevision: 2,
        status: "inconclusive",
        sampleCount: 1,
        agreementCount: 1,
        inconclusiveCount: 1,
        unverifiedCount: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const qualificationListResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualifications`,
    );
    expect(qualificationListResponse.status).toBe(200);
    const qualifications =
      (await qualificationListResponse.json()) as EvaluationCasebookQualificationExecution[];
    expectEvaluationCasebookQualificationListHeaders(
      qualificationListResponse,
      casebook.id,
      qualifications,
    );
    expect(qualifications).toEqual([qualification]);

    const qualificationReceiptResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-receipt`,
    );
    expect(qualificationReceiptResponse.status).toBe(200);
    const qualificationReceipt =
      (await qualificationReceiptResponse.json()) as EvaluationCasebookQualificationReceipt;
    expectEvaluationCasebookQualificationReceiptHeaders(
      qualificationReceiptResponse,
      qualificationReceipt,
    );
    expect(qualificationReceipt).toEqual(
      expect.objectContaining({
        state: "inconclusive",
        execution: qualification,
      }),
    );
    expect(
      validateEvaluationCasebookQualificationReceipt(qualificationReceipt),
    ).toEqual(qualificationReceipt);

    const invalidUpdateCasebookResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          description: "This invalid update must not persist.",
          unsupported: true,
        }),
      },
    );
    expect(invalidUpdateCasebookResponse.status).toBe(400);
    expect(await invalidUpdateCasebookResponse.json()).toEqual(
      expect.objectContaining({ error: "Casebook update is invalid" }),
    );
    expect(services.store.getEvaluationCasebook(casebook.id)).toEqual(curated);

    const updateCasebookResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          description: "Reviewed and release-approved durable evidence.",
        }),
      },
    );
    expect(updateCasebookResponse.status).toBe(200);
    const updatedCasebook =
      (await updateCasebookResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(
      updateCasebookResponse,
      updatedCasebook,
    );
    expect(updatedCasebook.currentRevision).toBe(3);
    expect(updatedCasebook.revisions.at(-1)?.source).toBe("metadata_updated");
    const staleQualificationReceiptResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-receipt`,
    );
    expect(staleQualificationReceiptResponse.status).toBe(200);
    const staleQualificationReceipt =
      (await staleQualificationReceiptResponse.json()) as EvaluationCasebookQualificationReceipt;
    expectEvaluationCasebookQualificationReceiptHeaders(
      staleQualificationReceiptResponse,
      staleQualificationReceipt,
    );
    expect(staleQualificationReceipt.state).toBe("not_run");

    const casebookCalibrationResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/calibration`,
    );
    expect(casebookCalibrationResponse.status).toBe(200);
    const casebookCalibration =
      (await casebookCalibrationResponse.json()) as EvaluationCasebookCalibrationReport;
    expectEvaluationCasebookCalibrationHeaders(
      casebookCalibrationResponse,
      casebookCalibration,
    );
    expect(casebookCalibration).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        casebookRevision: 3,
        sampleCount: 1,
        agreementCount: 1,
        agreementRate: 1,
      }),
    );

    const casebookExportResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/export`,
    );
    expect(casebookExportResponse.status).toBe(200);
    const casebookArtifact =
      (await casebookExportResponse.json()) as EvaluationCasebookArtifact;
    expectEvaluationCasebookArtifactHeaders(
      casebookExportResponse,
      casebookArtifact,
    );
    expect(validateEvaluationCasebookArtifact(casebookArtifact)).toEqual(
      casebookArtifact,
    );

    const invalidRemoveCaseResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/cases/${curatedCase.id}/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: created.thread.id,
          unsupported: true,
        }),
      },
    );
    expect(invalidRemoveCaseResponse.status).toBe(400);
    expect(await invalidRemoveCaseResponse.json()).toEqual(
      expect.objectContaining({ error: "Casebook removal is invalid" }),
    );
    expect(services.store.getEvaluationCasebook(casebook.id)).toEqual(
      updatedCasebook,
    );

    const removeCaseResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/cases/${curatedCase.id}/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: created.thread.id }),
      },
    );
    expect(removeCaseResponse.status).toBe(200);
    const removedCasebook =
      (await removeCaseResponse.json()) as EvaluationCasebook;
    expectEvaluationCasebookProjectionHeaders(
      removeCaseResponse,
      removedCasebook,
    );
    expect(removedCasebook).toEqual(
      expect.objectContaining({
        currentRevision: 4,
        revisions: expect.arrayContaining([
          expect.objectContaining({
            source: "case_removed",
            caseId: curatedCase.id,
            caseIds: [],
          }),
        ]),
      }),
    );
    const casebookDetail = (await (
      await app.request(`/api/threads/${created.thread.id}`)
    ).json()) as ThreadDetail;
    expect(casebookDetail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "evaluation.casebook.created",
        "evaluation.casebook.case.curated",
        "evaluation.casebook.qualification.completed",
        "evaluation.casebook.updated",
        "evaluation.casebook.case.removed",
      ]),
    );
    expect(JSON.stringify(casebookDetail.events)).not.toContain(
      revisedReview.revisions[1]!.note,
    );

    const fixtureResponse = await app.request(
      `/api/threads/${created.thread.id}/fixture`,
    );
    expect(fixtureResponse.status).toBe(200);
    expect(fixtureResponse.headers.get("cache-control")).toBe("no-store");
    expect(fixtureResponse.headers.get("content-disposition")).toMatch(
      /^attachment; filename="napier-thread-/,
    );
    const fixture = (await fixtureResponse.json()) as ThreadReplayBundle;
    expectThreadReplayBundleHeaders(fixtureResponse, fixture);
    expect(fixture).toEqual(
      expect.objectContaining({
        kind: "napier.thread-replay",
        thread: expect.objectContaining({ id: created.thread.id }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        eventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(fixture.runs).toHaveLength(4);
    const fixtureEvaluationRun = fixture.runs.find(
      (run) =>
        run.id !== left!.id &&
        run.id !== right!.id &&
        fixture.events.some(
          (event) =>
            event.runId === run.id && event.type === "evaluation.completed",
        ),
    );
    expect(fixtureEvaluationRun).toEqual(
      expect.objectContaining({
        status: "completed",
        configuration: expect.objectContaining({
          model: { provider: "napier", id: "demo" },
        }),
      }),
    );
    expect(
      fixture.events
        .filter((event) => event.runId === fixtureEvaluationRun!.id)
        .map((event) => event.type),
    ).toEqual(["evaluation.completed"]);
    const fixtureQualificationRun = fixture.runs.find(
      (run) =>
        run.id !== left!.id &&
        run.id !== right!.id &&
        run.id !== fixtureEvaluationRun!.id,
    );
    expect(fixtureQualificationRun).toEqual(
      expect.objectContaining({
        status: "completed",
        configuration: expect.objectContaining({
          model: { provider: "napier", id: "demo" },
        }),
      }),
    );
    expect(
      fixture.events
        .filter((event) => event.runId === fixtureQualificationRun!.id)
        .map((event) => event.type),
    ).toEqual(["evaluation.casebook.qualification.completed"]);
    expect(fixture.evaluations).toEqual([evaluation]);
    expect(fixture.evaluationAdjudications).toEqual([revisedReview]);

    const threadCountBeforeVerification = services.store.listThreads().length;
    const verifyResponse = await app.request("/api/threads/import/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: fixture }),
    });
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as ThreadReplayBundleVerification;
    expectThreadReplayBundleVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: fixture.thread.id,
      agentId: fixture.agent.id,
      contentSha256: fixture.contentSha256,
      eventStreamSha256: fixture.eventStreamSha256,
      eventCount: fixture.events.length,
      runCount: fixture.runs.length,
      planCount: fixture.plans.length,
      evaluationCount: fixture.evaluations.length,
      modelContextEnvelopeCount: fixture.events.filter(
        (event) => event.type === "context.model_envelope",
      ).length,
      embeddedModelContextEnvelopeCount: fixture.events.filter(
        (event) =>
          event.payload &&
          !Array.isArray(event.payload) &&
          typeof event.payload === "object" &&
          "modelContextEnvelope" in event.payload,
      ).length,
    });
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeVerification,
    );

    const importResponse = await app.request("/api/threads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bundle: fixture,
        title: "Imported Run Lab fixture",
      }),
    });
    expect(importResponse.status).toBe(201);
    const imported = (await importResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(importResponse, imported);
    expect(imported.thread).toEqual(
      expect.objectContaining({
        title: "Imported Run Lab fixture",
        eventCount: fixture.events.length + 1,
        importProvenance: expect.objectContaining({
          sourceThreadId: created.thread.id,
          sourceContentSha256: fixture.contentSha256,
          sourceEventStreamSha256: fixture.eventStreamSha256,
          sourceEventCount: fixture.events.length,
          localImportedThroughSeq: imported.events.length,
          sourceModelContextEnvelopeCount:
            verification.modelContextEnvelopeCount,
          sourceEmbeddedModelContextEnvelopeCount:
            verification.embeddedModelContextEnvelopeCount,
        }),
      }),
    );
    expect(imported.events.at(-1)).toEqual(
      expect.objectContaining({
        type: "thread.imported",
        category: "lifecycle",
        visibility: "debug",
        seq: imported.thread.importProvenance!.localImportedThroughSeq,
        payload: {
          kind: "napier.thread-import-provenance",
          sourceThreadId: created.thread.id,
          sourceApiVersion: fixture.apiVersion,
          sourceContentSha256: fixture.contentSha256,
          sourceEventStreamSha256: fixture.eventStreamSha256,
          sourceEventCount: fixture.events.length,
          localImportedThroughSeq:
            imported.thread.importProvenance!.localImportedThroughSeq,
          sourceModelContextEnvelopeCount:
            verification.modelContextEnvelopeCount,
          sourceEmbeddedModelContextEnvelopeCount:
            verification.embeddedModelContextEnvelopeCount,
          importedAt: imported.thread.importProvenance!.importedAt,
        },
      }),
    );
    const importedBranchResponse = await app.request(
      `/api/threads/${imported.thread.id}/branches`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromSeq: imported.events.at(-1)!.seq,
          title: "Imported branch",
        }),
      },
    );
    expect(importedBranchResponse.status).toBe(201);
    const importedBranch =
      (await importedBranchResponse.json()) as ThreadDetail;
    expectThreadDetailProjectionHeaders(importedBranchResponse, importedBranch);
    expect(importedBranch.thread).toEqual(
      expect.objectContaining({
        title: "Imported branch",
        importProvenance: {
          ...imported.thread.importProvenance!,
          localImportedThroughSeq:
            imported.events.filter((event) => event.category === "message")
              .length + 1,
        },
      }),
    );
    expect(importedBranch.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["branch.created", "message.user"]),
    );
    expect(imported.thread.id).not.toBe(created.thread.id);
    expect(imported.agent.id).not.toBe(created.agent.id);
    expect(imported.runs.map((run) => run.id)).not.toEqual(
      fixture.runs.map((run) => run.id),
    );
    expect(imported.evaluations).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(evaluation.id),
        threadId: imported.thread.id,
        leftRunId: imported.runs[0]!.id,
        rightRunId: imported.runs[1]!.id,
      }),
    ]);
    expect(imported.evaluationAdjudications).toEqual([
      expect.objectContaining({
        id: expect.not.stringMatching(revisedReview.id),
        threadId: imported.thread.id,
        evaluationId: imported.evaluations[0]!.id,
        currentRevision: 2,
        revisions: [
          expect.objectContaining({
            evaluationSha256: expect.not.stringMatching(
              revisedReview.revisions[0]!.evaluationSha256,
            ),
          }),
          expect.objectContaining({ expectedVerdict: "inconclusive" }),
        ],
      }),
    ]);

    const threadCountBeforeRejectedImport = services.store.listThreads().length;
    const tampered = structuredClone(fixture);
    tampered.events[0]!.payload = { text: "tampered API fixture" };
    const rejectedResponse = await app.request("/api/threads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: tampered }),
    });
    expect(rejectedResponse.status).toBe(400);
    expect(await rejectedResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("snapshot source binding mismatch"),
      }),
    );
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeRejectedImport,
    );

    const invalidVerifyResponse = await app.request(
      "/api/threads/import/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle: tampered }),
      },
    );
    expect(invalidVerifyResponse.status).toBe(200);
    const invalidVerification =
      (await invalidVerifyResponse.json()) as ThreadReplayBundleVerification;
    expectThreadReplayBundleVerificationHeaders(
      invalidVerifyResponse,
      invalidVerification,
    );
    expect(invalidVerification).toEqual({
      status: "invalid",
      diagnostics: ["invalid_bundle"],
      eventCount: 0,
      runCount: 0,
      planCount: 0,
      evaluationCount: 0,
      modelContextEnvelopeCount: 0,
      embeddedModelContextEnvelopeCount: 0,
    });
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeRejectedImport,
    );

    const extraFieldResponse = await app.request("/api/threads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: fixture, unexpected: true }),
    });
    expect(extraFieldResponse.status).toBe(400);
    expect(await extraFieldResponse.json()).toEqual(
      expect.objectContaining({
        error: "Thread replay import request is invalid",
      }),
    );
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeRejectedImport,
    );

    const emptyTitleResponse = await app.request("/api/threads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: fixture, title: "   " }),
    });
    expect(emptyTitleResponse.status).toBe(400);
    expect(await emptyTitleResponse.json()).toEqual(
      expect.objectContaining({
        error: "Thread replay import request is invalid",
      }),
    );
    expect(services.store.listThreads()).toHaveLength(
      threadCountBeforeRejectedImport,
    );

    const oversizedResponse = await app.request("/api/threads/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(10 * 1024 * 1024 + 1),
      },
      body: "{}",
    });
    expect(oversizedResponse.status).toBe(413);
  });
});

function inboundSignature(
  token: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac("sha256", token)
    .update(`${timestamp}\n${body}`)
    .digest("hex")}`;
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function optionalNumberHeader(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

function textSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractFunctions(
  source: string,
): { name: string; line: number; body: string }[] {
  const functions: { name: string; line: number; body: string }[] = [];
  const functionPattern = /function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = functionPattern.exec(source))) {
    const name = match[1] ?? "anonymous";
    const openBrace = source.indexOf("{", match.index);
    if (openBrace < 0) continue;
    let depth = 0;
    let end = openBrace;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    if (depth !== 0) continue;
    functions.push({
      name,
      line: source.slice(0, match.index).split("\n").length,
      body: source.slice(openBrace, end),
    });
    functionPattern.lastIndex = end;
  }
  return functions;
}

function extractRouteHandlers(
  source: string,
): { method: string; line: number; body: string; bodyStart: number }[] {
  const routes: {
    method: string;
    line: number;
    body: string;
    bodyStart: number;
  }[] = [];
  const routePattern = /app\.(get|post|put|delete|notFound|onError)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(source))) {
    const method = match[1] ?? "route";
    const arrow = source.indexOf("=>", match.index);
    if (arrow < 0) continue;
    const openBrace = source.indexOf("{", arrow);
    if (openBrace < 0) continue;
    let depth = 0;
    let end = openBrace;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    if (depth !== 0) continue;
    routes.push({
      method,
      line: lineNumberAt(source, match.index),
      body: source.slice(openBrace, end),
      bodyStart: openBrace,
    });
    routePattern.lastIndex = end;
  }
  return routes;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

async function expectJsonContentHash(
  response: Response,
  label: string,
): Promise<void> {
  const text = await response.text();
  expect(response.headers.get("cache-control"), label).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256-mode"), label).toBe(
    "body",
  );
  expect(response.headers.get("x-napier-content-sha256"), label).toBe(
    textSha256(text),
  );
  expect(() => JSON.parse(text), label).not.toThrow();
}

function bodyCallsContentHashHelper(body: string): boolean {
  return /set(?:Body|Stable)?ContentSha256Header\s*\(\s*context/.test(body);
}

function expectJsonErrorProjectionHeaders(
  response: Response,
  body: { error: string },
  status: number,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(body),
  );
  expect(response.headers.get("x-napier-error-status")).toBe(String(status));
  expect(response.headers.get("x-napier-error-code")).toBe(
    expectedJsonErrorCode(status),
  );
  expect(response.headers.get("x-napier-error-message-sha256")).toBe(
    textSha256(body.error),
  );
}

function expectedJsonErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "http_error";
  }
}

function expectUsagePriceTableCatalogHeaders(
  response: Response,
  catalog: UsagePriceTableCatalog,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    catalog.contentSha256,
  );
  expect(response.headers.get("x-napier-usage-price-table-count")).toBe(
    String(catalog.tables.length),
  );
  expect(response.headers.get("x-napier-usage-price-provider-count")).toBe(
    String(new Set(catalog.tables.map((table) => table.provider)).size),
  );
  expect(response.headers.get("x-napier-usage-price-providers-sha256")).toBe(
    responseSha256(catalog.tables.map((table) => table.provider).sort()),
  );
}

function expectUsagePriceTableVerificationHeaders(
  response: Response,
  verification: UsagePriceTableVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(response.headers.get("x-napier-usage-price-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-usage-price-table-count")).toBe(
    String(verification.tableCount),
  );
  expect(response.headers.get("x-napier-usage-price-provider-count")).toBe(
    String(verification.providers.length),
  );
  expect(response.headers.get("x-napier-usage-price-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-usage-price-providers-sha256")).toBe(
    responseSha256(verification.providers),
  );
  expect(response.headers.get("x-napier-usage-price-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-usage-price-catalog-sha256")).toBe(
    verification.catalogSha256 ?? null,
  );
}

function adapterIdsSha256(
  adapters: readonly InboundChannelAdapterDescriptor[],
): string {
  return responseSha256(adapters.map((adapter) => adapter.id).sort());
}

function expectInboundChannelAdapterCatalogHeaders(
  response: Response,
  adapters: InboundChannelAdapterDescriptor[],
): void {
  const catalogSha256 = responseSha256(adapters);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(catalogSha256);
  expect(response.headers.get("x-napier-adapter-catalog-sha256")).toBe(
    catalogSha256,
  );
  expect(response.headers.get("x-napier-adapter-count")).toBe(
    String(adapters.length),
  );
  expect(response.headers.get("x-napier-adapter-ids-sha256")).toBe(
    adapterIdsSha256(adapters),
  );
}

function expectInboundChannelAdapterPreviewHeaders(
  response: Response,
  preview: InboundChannelAdapterPreview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    preview.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(preview.channelId);
  expect(response.headers.get("x-napier-adapter")).toBe(preview.adapter);
  expect(response.headers.get("x-napier-body-sha256")).toBe(preview.bodySha256);
  expect(response.headers.get("x-napier-idempotency-fingerprint")).toBe(
    preview.idempotencyFingerprint,
  );
  expect(response.headers.get("x-napier-message-sha256")).toBe(
    preview.messageSha256,
  );
  expect(response.headers.get("x-napier-message-preview")).toBe(null);
}

function expectAgentProfileHeaders(
  response: Response,
  agent: AgentProfile,
  revision: AgentProfileRevision,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(agent))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-agent-id")).toBe(agent.id);
  expect(response.headers.get("x-napier-agent-revision")).toBe(
    String(agent.revision),
  );
  expect(response.headers.get("x-napier-agent-profile-revision-sha256")).toBe(
    revision.contentSha256,
  );
  expect(response.headers.get("x-napier-system-prompt-sha256")).toBe(
    revision.systemPromptSha256,
  );
  expect(response.headers.get("x-napier-agent-changed-field-count")).toBe(
    String(revision.changedFields.length),
  );
}

function expectAgentRevisionListHeaders(
  response: Response,
  agentId: string,
  revisions: AgentProfileRevision[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(revisions))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-agent-id")).toBe(agentId);
  expect(response.headers.get("x-napier-agent-revision-count")).toBe(
    String(revisions.length),
  );
  const latest = revisions[0];
  if (latest) {
    expect(response.headers.get("x-napier-agent-revision")).toBe(
      String(latest.revision),
    );
    expect(response.headers.get("x-napier-agent-profile-revision-sha256")).toBe(
      latest.contentSha256,
    );
    expect(response.headers.get("x-napier-system-prompt-sha256")).toBe(
      latest.systemPromptSha256,
    );
  }
}

function expectAgentRollbackHeaders(
  response: Response,
  result: AgentProfileRollbackResult,
  restoredSnapshot: AgentProfileRevision,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-agent-id")).toBe(result.agent.id);
  expect(response.headers.get("x-napier-agent-revision")).toBe(
    String(result.agent.revision),
  );
  expect(response.headers.get("x-napier-agent-restored-from-revision")).toBe(
    String(restoredSnapshot.revision),
  );
  expect(response.headers.get("x-napier-agent-profile-revision-sha256")).toBe(
    result.revision.contentSha256,
  );
  expect(response.headers.get("x-napier-agent-restored-snapshot-sha256")).toBe(
    restoredSnapshot.contentSha256,
  );
  expect(response.headers.get("x-napier-system-prompt-sha256")).toBe(
    result.revision.systemPromptSha256,
  );
  expect(response.headers.get("x-napier-agent-changed-field-count")).toBe(
    String(result.revision.changedFields.length),
  );
}

function expectMemoryListHeaders(
  response: Response,
  memories: MemoryFact[],
  agentId?: string,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(memories))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-agent-id")).toBe(agentId ?? null);
  expect(response.headers.get("x-napier-memory-count")).toBe(
    String(memories.length),
  );
  for (const status of [
    "proposed",
    "active",
    "stale",
    "rejected",
    "archived",
  ] satisfies MemoryFact["status"][]) {
    expect(response.headers.get(`x-napier-memory-${status}-count`)).toBe(
      String(memories.filter((memory) => memory.status === status).length),
    );
  }
}

function expectMemoryProjectionHeaders(
  response: Response,
  memory: MemoryFact,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(memory))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-memory-id")).toBe(memory.id);
  expect(response.headers.get("x-napier-memory-status")).toBe(memory.status);
  expect(response.headers.get("x-napier-memory-revision")).toBe(
    String(memory.revision),
  );
  expect(response.headers.get("x-napier-memory-scope")).toBe(memory.scope);
  expect(response.headers.get("x-napier-memory-category")).toBe(
    memory.category,
  );
  expect(response.headers.get("x-napier-memory-review-interval-days")).toBe(
    String(memory.reviewIntervalDays),
  );
  expect(response.headers.get("x-napier-memory-use-count")).toBe(
    String(memory.useCount),
  );
  expect(response.headers.get("x-napier-agent-id")).toBe(
    memory.agentId ?? null,
  );
  expect(response.headers.get("x-napier-memory-review-due-at")).toBe(
    memory.reviewDueAt ?? null,
  );
  expect(response.headers.get("x-napier-memory-supersedes-id")).toBe(
    memory.supersedesMemoryId ?? null,
  );
  expect(response.headers.get("x-napier-memory-superseded-by-id")).toBe(
    memory.supersededByMemoryId ?? null,
  );
  expect(response.headers.get("x-napier-memory-consolidates-count")).toBe(
    memory.consolidatesMemoryIds
      ? String(memory.consolidatesMemoryIds.length)
      : null,
  );
}

function expectCredentialReferenceListHeaders(
  response: Response,
  references: CredentialReference[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(references))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-credential-count")).toBe(
    String(references.length),
  );
  for (const status of [
    "active",
    "disabled",
  ] satisfies CredentialReference["status"][]) {
    expect(response.headers.get(`x-napier-credential-${status}-count`)).toBe(
      String(
        references.filter((reference) => reference.status === status).length,
      ),
    );
  }
  for (const availability of [
    "unknown",
    "available",
    "missing",
    "error",
  ] satisfies CredentialReference["availability"][]) {
    expect(
      response.headers.get(`x-napier-credential-${availability}-count`),
    ).toBe(
      String(
        references.filter(
          (reference) => reference.availability === availability,
        ).length,
      ),
    );
  }
}

function expectCredentialReferenceHeaders(
  response: Response,
  reference: CredentialReference,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(reference))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-credential-id")).toBe(reference.id);
  expect(response.headers.get("x-napier-credential-provider")).toBe(
    reference.providerId,
  );
  expect(response.headers.get("x-napier-credential-source-type")).toBe(
    reference.source.type,
  );
  expect(response.headers.get("x-napier-credential-status")).toBe(
    reference.status,
  );
  expect(response.headers.get("x-napier-credential-availability")).toBe(
    reference.availability,
  );
  expect(response.headers.get("x-napier-credential-revision")).toBe(
    String(reference.revision),
  );
  expect(response.headers.get("x-napier-credential-last-checked-at")).toBe(
    reference.lastCheckedAt ?? null,
  );
}

function expectThreadDetailProjectionHeaders(
  response: Response,
  detail: ThreadDetail,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(detail))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(detail.thread.id);
  expect(response.headers.get("x-napier-run-count")).toBe(
    String(detail.runs.length),
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(detail.events.length),
  );
  expect(response.headers.get("x-napier-plan-count")).toBe(
    String(detail.plans.length),
  );
  expect(response.headers.get("x-napier-evaluation-count")).toBe(
    String(detail.evaluations.length),
  );
  expect(response.headers.get("x-napier-subagent-count")).toBe(
    String(detail.subagents.length),
  );
  expect(response.headers.get("x-napier-run-control-message-count")).toBe(
    String(detail.runControlMessages.length),
  );
  expect(response.headers.get("x-napier-operator-decision-count")).toBe(
    String(detail.operatorDecisions.length),
  );
  expect(response.headers.get("x-napier-recovery-assessment-count")).toBe(
    String(detail.automaticRecoveryAssessments.length),
  );
  expect(response.headers.get("x-napier-recovery-attempt-count")).toBe(
    String(detail.automaticRecoveryAttempts.length),
  );
  const provenance = detail.thread.importProvenance;
  expect(response.headers.get("x-napier-import-source-thread-id")).toBe(
    provenance?.sourceThreadId ?? null,
  );
  expect(response.headers.get("x-napier-import-source-api-version")).toBe(
    provenance?.sourceApiVersion ?? null,
  );
  expect(response.headers.get("x-napier-import-source-content-sha256")).toBe(
    provenance?.sourceContentSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-import-source-event-stream-sha256"),
  ).toBe(provenance?.sourceEventStreamSha256 ?? null);
  expect(response.headers.get("x-napier-import-source-event-count")).toBe(
    provenance ? String(provenance.sourceEventCount) : null,
  );
  expect(
    response.headers.get("x-napier-import-local-imported-through-seq"),
  ).toBe(
    provenance?.localImportedThroughSeq === undefined
      ? null
      : String(provenance.localImportedThroughSeq),
  );
  expect(
    response.headers.get("x-napier-import-source-model-context-envelope-count"),
  ).toBe(
    provenance?.sourceModelContextEnvelopeCount === undefined
      ? null
      : String(provenance.sourceModelContextEnvelopeCount),
  );
  expect(
    response.headers.get(
      "x-napier-import-source-embedded-model-context-envelope-count",
    ),
  ).toBe(
    provenance?.sourceEmbeddedModelContextEnvelopeCount === undefined
      ? null
      : String(provenance.sourceEmbeddedModelContextEnvelopeCount),
  );
  expect(response.headers.get("x-napier-imported-at")).toBe(
    provenance?.importedAt ?? null,
  );
  const importReceipt =
    provenance?.localImportedThroughSeq === undefined
      ? undefined
      : detail.events.find(
          (event) =>
            event.type === "thread.imported" &&
            event.seq === provenance.localImportedThroughSeq &&
            event.category === "lifecycle" &&
            event.visibility === "debug" &&
            event.createdAt === provenance.importedAt,
        );
  expect(response.headers.get("x-napier-import-receipt-seq")).toBe(
    importReceipt ? String(importReceipt.seq) : null,
  );
  expect(response.headers.get("x-napier-import-receipt-sha256")).toBe(
    importReceipt ? responseSha256(importReceipt.payload) : null,
  );
}

function expectThreadEventsProjectionHeaders(
  response: Response,
  threadId: string,
  events: ThreadDetail["events"],
  afterSeq: number,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(events))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-after-seq")).toBe(String(afterSeq));
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(events.length),
  );
  expectEventBoundaryHeaders(response, events);
}

function expectRunControlMessageHeaders(
  response: Response,
  message: RunControlMessage,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    message.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-thread-id")).toBe(message.threadId);
  expect(response.headers.get("x-napier-run-id")).toBe(message.runId);
  expect(response.headers.get("x-napier-run-control-message-id")).toBe(
    message.id,
  );
  expect(response.headers.get("x-napier-run-control-mode")).toBe(message.mode);
  expect(response.headers.get("x-napier-run-control-status")).toBe(
    message.status,
  );
  expect(response.headers.get("x-napier-run-control-text-sha256")).toBe(
    message.textSha256,
  );
  expect(response.headers.get("x-napier-run-control-text-bytes")).toBe(
    String(message.textBytes),
  );
  expect(response.headers.get("x-napier-run-control-queued-event-seq")).toBe(
    String(message.queuedEventSeq),
  );
}

function expectRunControlMessageListHeaders(
  response: Response,
  threadId: string,
  runId: string,
  messages: RunControlMessage[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(messages))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-run-id")).toBe(runId);
  expect(response.headers.get("x-napier-run-control-message-count")).toBe(
    String(messages.length),
  );
  expect(response.headers.get("x-napier-run-control-queued-count")).toBe(
    String(messages.filter((message) => message.status === "queued").length),
  );
  expect(response.headers.get("x-napier-run-control-delivered-count")).toBe(
    String(messages.filter((message) => message.status === "delivered").length),
  );
  expect(response.headers.get("x-napier-run-control-cancelled-count")).toBe(
    String(messages.filter((message) => message.status === "cancelled").length),
  );
}

function expectAgentMilestoneListHeaders(
  response: Response,
  threadId: string,
  milestones: AgentMilestone[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(milestones))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-agent-milestone-count")).toBe(
    String(milestones.length),
  );
  expect(
    response.headers.get("x-napier-agent-milestone-evidence-event-count"),
  ).toBe(
    String(
      milestones.reduce(
        (total, milestone) => total + milestone.evidence.eventCount,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-agent-milestone-latest-id")).toBe(
    milestones.at(-1)?.id,
  );
  expect(
    response.headers.get("x-napier-agent-milestone-latest-content-sha256"),
  ).toBe(milestones.at(-1)?.contentSha256);
}

function expectOperatorDecisionHeaders(
  response: Response,
  decision: OperatorDecision,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    decision.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-thread-id")).toBe(decision.threadId);
  expect(response.headers.get("x-napier-run-id")).toBe(decision.runId);
  expect(response.headers.get("x-napier-operator-decision-id")).toBe(
    decision.id,
  );
  expect(response.headers.get("x-napier-operator-decision-status")).toBe(
    decision.status,
  );
  expect(
    response.headers.get("x-napier-operator-decision-question-sha256"),
  ).toBe(decision.questionSha256);
  expect(response.headers.get("x-napier-operator-decision-option-count")).toBe(
    String(decision.options.length),
  );
  expect(
    response.headers.get("x-napier-operator-decision-requested-event-seq"),
  ).toBe(String(decision.requestedEventSeq));
}

function expectOperatorDecisionListHeaders(
  response: Response,
  threadId: string,
  decisions: OperatorDecision[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(decisions))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-operator-decision-count")).toBe(
    String(decisions.length),
  );
  expect(response.headers.get("x-napier-operator-decision-pending-count")).toBe(
    String(
      decisions.filter((decision) => decision.status === "pending").length,
    ),
  );
}

function expectThreadStopHeaders(
  response: Response,
  threadId: string,
  receipt: { stopped: boolean },
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(receipt))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-thread-stopped")).toBe(
    String(receipt.stopped),
  );
}

function expectThreadResumeStreamHeaders(
  response: Response,
  threadId: string,
  runId?: string,
  model?: { provider: string; id: string },
): void {
  expect(response.headers.get("cache-control")).toBe("no-cache");
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-resume-requested")).toBe("true");
  expect(response.headers.get("x-napier-run-id")).toBe(runId ?? null);
  expect(response.headers.get("x-napier-model-provider")).toBe(
    model?.provider ?? null,
  );
  expect(response.headers.get("x-napier-model-id")).toBe(model?.id ?? null);
  expectThreadRunStreamErrorHeaders(response);
}

function expectThreadPromptStreamHeaders(
  response: Response,
  threadId: string,
  model?: { provider: string; id: string },
): void {
  expect(response.headers.get("cache-control")).toBe("no-cache");
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-prompt-requested")).toBe("true");
  expect(response.headers.get("x-napier-model-provider")).toBe(
    model?.provider ?? null,
  );
  expect(response.headers.get("x-napier-model-id")).toBe(model?.id ?? null);
  expectThreadRunStreamErrorHeaders(response);
}

function expectThreadRunStreamErrorHeaders(response: Response): void {
  expect(response.headers.get("x-napier-stream-error-code")).toBe("run_failed");
  expect(response.headers.get("x-napier-stream-error-diagnostic")).toBe(
    "sha256",
  );
  expect(response.headers.get("x-napier-stream-error-message-sha256")).toBe(
    createHash("sha256").update("Run failed while streaming.").digest("hex"),
  );
}

function expectExecutionPlanListHeaders(
  response: Response,
  threadId: string,
  plans: ExecutionPlan[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(plans))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-plan-count")).toBe(
    String(plans.length),
  );
  for (const status of [
    "active",
    "completed",
    "blocked",
    "cancelled",
  ] satisfies ExecutionPlan["status"][]) {
    expect(response.headers.get(`x-napier-plan-${status}-count`)).toBe(
      String(plans.filter((plan) => plan.status === status).length),
    );
  }
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(plans.reduce((total, plan) => total + plan.steps.length, 0)),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(plans.reduce((total, plan) => total + plan.artifacts.length, 0)),
  );
  expect(response.headers.get("x-napier-plan-replan-count")).toBe(
    String(plans.reduce((total, plan) => total + plan.replans.length, 0)),
  );
}

function expectExecutionPlanHeaders(
  response: Response,
  plan: ExecutionPlan,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(plan.threadId);
  expect(response.headers.get("x-napier-plan-id")).toBe(plan.id);
  expect(response.headers.get("x-napier-plan-status")).toBe(plan.status);
  expect(response.headers.get("x-napier-plan-revision")).toBe(
    String(plan.revision),
  );
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(plan.steps.length),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(plan.artifacts.length),
  );
  expect(response.headers.get("x-napier-plan-replan-count")).toBe(
    String(plan.replans.length),
  );
  expect(response.headers.get("x-napier-plan-critical-path-count")).toBe(
    String(plan.criticalPathStepIds.length),
  );
  expect(response.headers.get("x-napier-plan-ready-step-count")).toBe(
    String(plan.readyStepIds.length),
  );
  expect(response.headers.get("x-napier-plan-blocked-step-count")).toBe(
    String(plan.blockedStepIds.length),
  );
  expect(response.headers.get("x-napier-plan-phase-count")).toBe(
    String(plan.phaseWaves.length),
  );
  expect(response.headers.get("x-napier-plan-active-phase-index")).toBe(
    plan.activePhaseIndex === null ? "" : String(plan.activePhaseIndex),
  );
  expect(response.headers.get("x-napier-plan-parallel-ready-step-count")).toBe(
    String(plan.parallelReadyStepIds.length),
  );
  expect(response.headers.get("x-napier-plan-phase-projection-sha256")).toBe(
    plan.phaseProjectionSha256,
  );
  expect(response.headers.get("x-napier-replan-recommendation")).toBe(
    String(Boolean(plan.replanRecommendation)),
  );
  expect(response.headers.get("x-napier-replan-recommendation-sha256")).toBe(
    plan.replanRecommendation?.recommendationSha256 ?? null,
  );
  expect(response.headers.get("x-napier-replan-recommendation-strategy")).toBe(
    plan.replanRecommendation?.strategy ?? null,
  );
}

function expectExecutionPlanReplanDraftReviewHeaders(
  response: Response,
  review: ExecutionPlanReplanDraftModelReview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    review.reviewSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(review.threadId);
  expect(response.headers.get("x-napier-plan-id")).toBe(review.planId);
  expect(response.headers.get("x-napier-plan-expected-revision")).toBe(
    String(review.expectedRevision),
  );
  expect(response.headers.get("x-napier-replan-recommendation-sha256")).toBe(
    review.recommendationSha256,
  );
  expect(response.headers.get("x-napier-replan-draft-sha256")).toBe(
    review.draftSha256,
  );
  expect(response.headers.get("x-napier-replan-draft-evaluation-sha256")).toBe(
    review.deterministicEvaluationSha256,
  );
  expect(response.headers.get("x-napier-replan-review-verdict")).toBe(
    review.verdict,
  );
  expect(response.headers.get("x-napier-replan-review-risk")).toBe(review.risk);
  expect(response.headers.get("x-napier-replan-review-score")).toBe(
    String(review.score),
  );
  expect(
    response.headers.get(
      "x-napier-replan-review-model-context-envelope-sha256",
    ),
  ).toBe(review.modelContextEnvelope?.contentSha256 ?? null);
}

function expectExecutionPlanArchiveHeaders(
  response: Response,
  archive: ExecutionPlanArchive,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    archive.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-thread-id")).toBe(archive.threadId);
  expect(response.headers.get("x-napier-plan-id")).toBe(archive.plan.id);
  expect(response.headers.get("x-napier-plan-status")).toBe(
    archive.plan.status,
  );
  expect(response.headers.get("x-napier-plan-revision")).toBe(
    String(archive.plan.revision),
  );
  expect(response.headers.get("x-napier-plan-archive-sha256")).toBe(
    archive.contentSha256,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    archive.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(archive.events.length),
  );
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(archive.plan.steps.length),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(archive.plan.artifacts.length),
  );
  expect(response.headers.get("x-napier-plan-replan-count")).toBe(
    String(archive.plan.replans.length),
  );
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="napier-plan-${archive.plan.id}-r${archive.plan.revision}-${archive.contentSha256.slice(0, 12)}.json"`,
  );
  expectEventBoundaryHeaders(response, archive.events);
}

function expectExecutionPlanArchiveVerificationHeaders(
  response: Response,
  verification: ExecutionPlanArchiveVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(verification.eventCount),
  );
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(verification.stepCount),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(verification.artifactCount),
  );
  expect(response.headers.get("x-napier-plan-replan-count")).toBe(
    String(verification.replanCount),
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(verification.diagnostics))
      .digest("hex"),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    verification.threadId ?? null,
  );
  expect(response.headers.get("x-napier-plan-id")).toBe(
    verification.planId ?? null,
  );
  expect(response.headers.get("x-napier-plan-revision")).toBe(
    verification.revision === undefined ? null : String(verification.revision),
  );
  expect(response.headers.get("x-napier-plan-archive-sha256")).toBe(
    verification.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    verification.eventStreamSha256 ?? null,
  );
}

function expectExecutionPlanBlueprintHeaders(
  response: Response,
  blueprint: ExecutionPlanBlueprint,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    blueprint.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(blueprint.stepCount),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(blueprint.artifactCount),
  );
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="napier-plan-blueprint-${blueprint.source.planId}-r${blueprint.source.planRevision}-${blueprint.contentSha256.slice(0, 12)}.json"`,
  );
  expectExecutionPlanBlueprintSourceHeaders(response, blueprint);
}

function expectExecutionPlanBlueprintVerificationHeaders(
  response: Response,
  verification: ExecutionPlanBlueprintVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(verification.stepCount),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(verification.artifactCount),
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(verification.diagnostics))
      .digest("hex"),
  );
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    verification.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-source-thread-id")).toBe(
    verification.sourceThreadId ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-id")).toBe(
    verification.sourcePlanId ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-revision")).toBe(
    verification.sourcePlanRevision === undefined
      ? null
      : String(verification.sourcePlanRevision),
  );
  expect(response.headers.get("x-napier-blueprint-source-archive-sha256")).toBe(
    verification.sourcePlanArchiveSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-blueprint-source-event-stream-sha256"),
  ).toBe(verification.sourceEventStreamSha256 ?? null);
}

function expectExecutionPlanBlueprintSourceHeaders(
  response: Response,
  blueprint: ExecutionPlanBlueprint,
): void {
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    blueprint.contentSha256,
  );
  expect(response.headers.get("x-napier-blueprint-source-thread-id")).toBe(
    blueprint.source.threadId,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-id")).toBe(
    blueprint.source.planId,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-revision")).toBe(
    String(blueprint.source.planRevision),
  );
  expect(response.headers.get("x-napier-blueprint-source-archive-sha256")).toBe(
    blueprint.source.planArchiveSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-source-event-stream-sha256"),
  ).toBe(blueprint.source.eventStreamSha256);
}

function expectExecutionPlanBlueprintRecordListHeaders(
  response: Response,
  records: ExecutionPlanBlueprintRecord[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(records))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-plan-blueprint-count")).toBe(
    String(records.length),
  );
  expect(response.headers.get("x-napier-plan-blueprint-active-count")).toBe(
    String(records.filter((record) => record.status === "active").length),
  );
  expect(response.headers.get("x-napier-plan-blueprint-archived-count")).toBe(
    String(records.filter((record) => record.status === "archived").length),
  );
  expect(response.headers.get("x-napier-plan-blueprint-set-sha256")).toBe(
    createHash("sha256")
      .update(
        JSON.stringify(records.map((record) => record.blueprintSha256).sort()),
      )
      .digest("hex"),
  );
}

function expectExecutionPlanBlueprintRecordHeaders(
  response: Response,
  record: ExecutionPlanBlueprintRecord,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(record))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expectExecutionPlanBlueprintRecordMetadataHeaders(response, record);
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(record.blueprint.stepCount),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(record.blueprint.artifactCount),
  );
}

function expectExecutionPlanBlueprintSaveResultHeaders(
  response: Response,
  result: SaveExecutionPlanBlueprintResult,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-plan-blueprint-created")).toBe(
    String(result.created),
  );
  expectExecutionPlanBlueprintRecordMetadataHeaders(response, result.record);
}

function expectExecutionPlanBlueprintRecordPreviewHeaders(
  response: Response,
  preview: ExecutionPlanBlueprintRecordPreview,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(preview))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-plan-blueprint-preview-status")).toBe(
    preview.status,
  );
  expect(response.headers.get("x-napier-blueprint-preview-sha256")).toBe(
    preview.previewSha256,
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    preview.recordId,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(preview.threadId);
  expect(response.headers.get("x-napier-has-open-plan")).toBe(
    String(preview.hasOpenPlan),
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(preview.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(preview.diagnostics))
      .digest("hex"),
  );
  expect(response.headers.get("x-napier-qualification-status")).toBe(
    preview.qualification.status,
  );
  if (preview.plan) {
    expect(response.headers.get("x-napier-plan-id")).toBe(preview.plan.id);
    expect(response.headers.get("x-napier-plan-step-count")).toBe(
      String(preview.plan.steps.length),
    );
    expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
      String(preview.plan.artifacts.length),
    );
  }
}

function expectExecutionPlanBlueprintRecordReplayHistoryHeaders(
  response: Response,
  history: ExecutionPlanBlueprintRecordReplayHistory,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    history.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    history.recordId,
  );
  expect(response.headers.get("x-napier-blueprint-replay-count")).toBe(
    String(history.replayCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-thread-count")).toBe(
    String(history.threadCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-plan-count")).toBe(
    String(history.planCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-event-set-sha256"),
  ).toBe(history.eventSetSha256);
  expect(response.headers.get("x-napier-first-event-seq")).toBe(
    history.firstSeq === undefined ? null : String(history.firstSeq),
  );
  expect(response.headers.get("x-napier-last-event-seq")).toBe(
    history.lastSeq === undefined ? null : String(history.lastSeq),
  );
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    history.replays[0]?.blueprintSha256 ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-latest-preview-sha256")).toBe(
    history.replays.at(-1)?.previewSha256 ?? null,
  );
}

function expectExecutionPlanBlueprintRecordReplayHistoryVerificationHeaders(
  response: Response,
  verification: ExecutionPlanBlueprintRecordReplayHistoryVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    verification.recordId ?? null,
  );
  expect(
    response.headers.get("x-napier-expected-plan-blueprint-record-id"),
  ).toBe(verification.expectedRecordId ?? null);
  expect(response.headers.get("x-napier-declared-content-sha256")).toBe(
    verification.declaredContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-recomputed-content-sha256")).toBe(
    verification.recomputedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-content-sha256")).toBe(
    verification.observedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-declared-event-set-sha256")).toBe(
    verification.declaredEventSetSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-event-set-sha256")).toBe(
    verification.observedEventSetSha256 ?? null,
  );
  expect(response.headers.get("x-napier-replay-count")).toBe(
    verification.replayCount === undefined
      ? null
      : String(verification.replayCount),
  );
  expect(response.headers.get("x-napier-observed-replay-count")).toBe(
    verification.observedReplayCount === undefined
      ? null
      : String(verification.observedReplayCount),
  );
}

function expectExecutionPlanBlueprintRecordReplayOutcomesHeaders(
  response: Response,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    outcomes.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    outcomes.recordId,
  );
  expect(response.headers.get("x-napier-blueprint-replay-history-sha256")).toBe(
    outcomes.replayHistorySha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-outcome-set-sha256"),
  ).toBe(outcomes.outcomeSetSha256);
  expect(response.headers.get("x-napier-blueprint-replay-count")).toBe(
    String(outcomes.replayCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-active-count")).toBe(
    String(outcomes.activeCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completed-count"),
  ).toBe(String(outcomes.completedCount));
  expect(response.headers.get("x-napier-blueprint-replay-blocked-count")).toBe(
    String(outcomes.blockedCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-cancelled-count"),
  ).toBe(String(outcomes.cancelledCount));
  expect(response.headers.get("x-napier-blueprint-replay-invalid-count")).toBe(
    String(outcomes.invalidCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completion-rate-bps"),
  ).toBe(String(outcomes.completionRateBps));
}

function expectExecutionPlanBlueprintRecordReplayOutcomesVerificationHeaders(
  response: Response,
  verification: ExecutionPlanBlueprintRecordReplayOutcomesVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    verification.recordId ?? null,
  );
  expect(
    response.headers.get("x-napier-expected-plan-blueprint-record-id"),
  ).toBe(verification.expectedRecordId ?? null);
  expect(response.headers.get("x-napier-declared-content-sha256")).toBe(
    verification.declaredContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-recomputed-content-sha256")).toBe(
    verification.recomputedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-content-sha256")).toBe(
    verification.observedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-declared-replay-history-sha256")).toBe(
    verification.declaredReplayHistorySha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-replay-history-sha256")).toBe(
    verification.observedReplayHistorySha256 ?? null,
  );
  expect(response.headers.get("x-napier-declared-outcome-set-sha256")).toBe(
    verification.declaredOutcomeSetSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-outcome-set-sha256")).toBe(
    verification.observedOutcomeSetSha256 ?? null,
  );
  expect(response.headers.get("x-napier-replay-count")).toBe(
    optionalNumberHeader(verification.replayCount),
  );
  expect(response.headers.get("x-napier-observed-replay-count")).toBe(
    optionalNumberHeader(verification.observedReplayCount),
  );
  expect(response.headers.get("x-napier-completed-count")).toBe(
    optionalNumberHeader(verification.completedCount),
  );
  expect(response.headers.get("x-napier-observed-completed-count")).toBe(
    optionalNumberHeader(verification.observedCompletedCount),
  );
  expect(response.headers.get("x-napier-blocked-count")).toBe(
    optionalNumberHeader(verification.blockedCount),
  );
  expect(response.headers.get("x-napier-observed-blocked-count")).toBe(
    optionalNumberHeader(verification.observedBlockedCount),
  );
  expect(response.headers.get("x-napier-invalid-count")).toBe(
    optionalNumberHeader(verification.invalidCount),
  );
  expect(response.headers.get("x-napier-observed-invalid-count")).toBe(
    optionalNumberHeader(verification.observedInvalidCount),
  );
}

function expectExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
  response: Response,
  baselines: readonly ExecutionPlanBlueprintRecordOutcomeBaseline[],
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(baselines),
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-baseline-count"),
  ).toBe(String(baselines.length));
  const latest = baselines.at(-1);
  if (latest) {
    expectExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
      response,
      latest,
    );
  } else {
    expect(response.headers.get("x-napier-blueprint-outcome-baseline-id")).toBe(
      null,
    );
  }
}

function expectExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
  response: Response,
  result: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-baseline-created"),
  ).toBe(String(result.created));
  expectExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
    response,
    result.baseline,
  );
}

function expectExecutionPlanBlueprintRecordOutcomeBaselineMetadataHeaders(
  response: Response,
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
): void {
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    baseline.recordId,
  );
  expect(response.headers.get("x-napier-blueprint-outcome-baseline-id")).toBe(
    baseline.id,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-baseline-sha256"),
  ).toBe(baseline.contentSha256);
  expect(
    response.headers.get("x-napier-blueprint-replay-outcomes-sha256"),
  ).toBe(baseline.replayOutcomesSha256);
  expect(response.headers.get("x-napier-blueprint-replay-history-sha256")).toBe(
    baseline.replayHistorySha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-outcome-set-sha256"),
  ).toBe(baseline.outcomeSetSha256);
  expect(response.headers.get("x-napier-blueprint-replay-count")).toBe(
    String(baseline.replayCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completed-count"),
  ).toBe(String(baseline.completedCount));
  expect(response.headers.get("x-napier-blueprint-replay-blocked-count")).toBe(
    String(baseline.blockedCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-invalid-count")).toBe(
    String(baseline.invalidCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completion-rate-bps"),
  ).toBe(String(baseline.completionRateBps));
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-min-replay-count"),
  ).toBe(String(baseline.policy.minReplayCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-outcome-policy-min-completion-rate-bps",
    ),
  ).toBe(String(baseline.policy.minCompletionRateBps));
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-max-blocked-count"),
  ).toBe(String(baseline.policy.maxBlockedCount));
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-max-invalid-count"),
  ).toBe(String(baseline.policy.maxInvalidCount));
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-gate-min-score"),
  ).toBe(baseline.reviewGate ? String(baseline.reviewGate.minScore) : null);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-gate-max-risk"),
  ).toBe(baseline.reviewGate?.maxRisk ?? null);
  expect(response.headers.get("x-napier-blueprint-outcome-review-sha256")).toBe(
    baseline.reviewSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-input-sha256"),
  ).toBe(baseline.reviewInputSha256 ?? null);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-response-sha256"),
  ).toBe(baseline.reviewResponseSha256 ?? null);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-verdict"),
  ).toBe(baseline.reviewVerdict ?? null);
  expect(response.headers.get("x-napier-blueprint-outcome-review-score")).toBe(
    baseline.reviewScore !== undefined ? String(baseline.reviewScore) : null,
  );
  expect(response.headers.get("x-napier-blueprint-outcome-review-risk")).toBe(
    baseline.reviewRisk ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-outcome-review-model")).toBe(
    baseline.reviewModel
      ? `${baseline.reviewModel.provider}/${baseline.reviewModel.id}`
      : null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-supersedes-baseline-id"),
  ).toBe(baseline.supersedesBaselineId ?? null);
}

function expectExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
  response: Response,
  qualification: ExecutionPlanBlueprintRecordOutcomeQualification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    qualification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-qualification-status")).toBe(
    qualification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(qualification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(qualification.diagnostics),
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    qualification.recordId,
  );
  expect(response.headers.get("x-napier-blueprint-outcome-baseline-id")).toBe(
    qualification.baselineId ?? null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-baseline-sha256"),
  ).toBe(qualification.baselineSha256 ?? null);
  expect(
    response.headers.get("x-napier-blueprint-baseline-outcomes-sha256"),
  ).toBe(qualification.baselineOutcomesSha256 ?? null);
  expect(
    response.headers.get("x-napier-blueprint-current-outcomes-sha256"),
  ).toBe(qualification.currentOutcomesSha256);
  expect(response.headers.get("x-napier-blueprint-replay-history-sha256")).toBe(
    qualification.currentReplayHistorySha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-outcome-set-sha256"),
  ).toBe(qualification.currentOutcomeSetSha256);
  expect(response.headers.get("x-napier-blueprint-replay-count")).toBe(
    String(qualification.replayCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completed-count"),
  ).toBe(String(qualification.completedCount));
  expect(response.headers.get("x-napier-blueprint-replay-blocked-count")).toBe(
    String(qualification.blockedCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-invalid-count")).toBe(
    String(qualification.invalidCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completion-rate-bps"),
  ).toBe(String(qualification.completionRateBps));
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-min-replay-count"),
  ).toBe(
    qualification.policy ? String(qualification.policy.minReplayCount) : null,
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-outcome-policy-min-completion-rate-bps",
    ),
  ).toBe(
    qualification.policy
      ? String(qualification.policy.minCompletionRateBps)
      : null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-max-blocked-count"),
  ).toBe(
    qualification.policy ? String(qualification.policy.maxBlockedCount) : null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-policy-max-invalid-count"),
  ).toBe(
    qualification.policy ? String(qualification.policy.maxInvalidCount) : null,
  );
}

function expectExecutionPlanBlueprintRecordOutcomeReviewHeaders(
  response: Response,
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    review.reviewSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    review.recordId,
  );
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    review.blueprintSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-verdict"),
  ).toBe(review.verdict);
  expect(response.headers.get("x-napier-blueprint-outcome-review-risk")).toBe(
    review.risk,
  );
  expect(response.headers.get("x-napier-blueprint-outcome-review-score")).toBe(
    String(review.score),
  );
  expect(response.headers.get("x-napier-blueprint-outcome-review-sha256")).toBe(
    review.reviewSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-input-sha256"),
  ).toBe(review.inputSha256);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-prompt-sha256"),
  ).toBe(review.promptSha256);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-response-sha256"),
  ).toBe(review.responseSha256);
  expect(
    response.headers.get("x-napier-blueprint-outcome-review-schema-sha256"),
  ).toBe(review.reviewSchemaSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-outcome-review-model-context-envelope-sha256",
    ),
  ).toBe(review.modelContextEnvelope?.contentSha256 ?? null);
  expect(response.headers.get("x-napier-model-provider")).toBe(
    review.model.provider,
  );
  expect(response.headers.get("x-napier-model-id")).toBe(review.model.id);
  expect(
    response.headers.get("x-napier-blueprint-source-qualification-status"),
  ).toBe(review.sourceQualificationStatus);
  expect(
    response.headers.get("x-napier-blueprint-outcome-qualification-status"),
  ).toBe(review.outcomeQualificationStatus);
  expect(
    response.headers.get("x-napier-blueprint-replay-outcomes-sha256"),
  ).toBe(review.replayOutcomesSha256);
  expect(response.headers.get("x-napier-blueprint-replay-history-sha256")).toBe(
    review.replayHistorySha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-outcome-set-sha256"),
  ).toBe(review.outcomeSetSha256);
  expect(response.headers.get("x-napier-blueprint-replay-count")).toBe(
    String(review.replayCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completed-count"),
  ).toBe(String(review.completedCount));
  expect(response.headers.get("x-napier-blueprint-replay-blocked-count")).toBe(
    String(review.blockedCount),
  );
  expect(response.headers.get("x-napier-blueprint-replay-invalid-count")).toBe(
    String(review.invalidCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-replay-completion-rate-bps"),
  ).toBe(String(review.completionRateBps));
  expect(response.headers.get("x-napier-blueprint-outcome-baseline-id")).toBe(
    review.baselineId ?? null,
  );
  expect(
    response.headers.get("x-napier-blueprint-outcome-baseline-sha256"),
  ).toBe(review.baselineSha256 ?? null);
  expect(
    response.headers.get("x-napier-blueprint-baseline-outcomes-sha256"),
  ).toBe(review.baselineOutcomesSha256 ?? null);
}

function expectExecutionPlanBlueprintRecordSelectionHeaders(
  response: Response,
  selection: ExecutionPlanBlueprintRecordSelection,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    selection.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-thread-id")).toBe(selection.threadId);
  expect(response.headers.get("x-napier-plan-blueprint-candidate-count")).toBe(
    String(selection.candidateCount),
  );
  expect(
    response.headers.get("x-napier-plan-blueprint-qualified-candidate-count"),
  ).toBe(String(selection.qualifiedCandidateCount));
  expect(
    response.headers.get("x-napier-plan-blueprint-rejected-candidate-count"),
  ).toBe(String(selection.rejectedCandidateCount));
  expect(
    response.headers.get("x-napier-plan-blueprint-selection-set-sha256"),
  ).toBe(selection.selectionSetSha256);
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    selection.portfolioSetSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-template"),
  ).toBe(selection.recommendationPolicy.templateId);
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-sha256"),
  ).toBe(selection.recommendationPolicySha256);
  expect(
    response.headers.get("x-napier-blueprint-family-policy-override-count"),
  ).toBe(String(selection.familyPolicyOverrideCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-set-sha256",
    ),
  ).toBe(selection.familyPolicyOverrideSetSha256);
  expect(response.headers.get("x-napier-objective-sha256")).toBe(
    selection.objectiveSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-selected-plan-blueprint-record-id"),
  ).toBe(selection.selectedRecordId ?? null);
  expect(
    response.headers.get("x-napier-selected-blueprint-preview-sha256"),
  ).toBe(selection.selectedPreviewSha256 ?? null);
  expect(
    response.headers.get("x-napier-selected-blueprint-outcome-baseline-id"),
  ).toBe(selection.selectedBaselineId ?? null);
  expect(
    response.headers.get("x-napier-selected-blueprint-outcome-baseline-sha256"),
  ).toBe(selection.selectedBaselineSha256 ?? null);
  expect(response.headers.get("x-napier-selected-blueprint-score-bps")).toBe(
    optionalNumberHeader(selection.selectedScoreBps),
  );
  expect(
    response.headers.get("x-napier-selected-blueprint-family-sha256"),
  ).toBe(selection.selectedFamilySha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-family-completion-rate-bps",
    ),
  ).toBe(optionalNumberHeader(selection.selectedFamilyCompletionRateBps));
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-recommendation-score-bps",
    ),
  ).toBe(optionalNumberHeader(selection.selectedRecommendationScoreBps));
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-recommendation-policy-template",
    ),
  ).toBe(selection.selectedRecommendationPolicyTemplate ?? null);
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-recommendation-policy-sha256",
    ),
  ).toBe(selection.selectedRecommendationPolicySha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-recommendation-policy-source",
    ),
  ).toBe(selection.selectedRecommendationPolicySource ?? null);
  expect(
    response.headers.get(
      "x-napier-selected-blueprint-family-policy-override-sha256",
    ),
  ).toBe(selection.selectedFamilyPolicyOverrideSha256 ?? null);
}

function expectExecutionPlanBlueprintPortfolioCalibrationHeaders(
  response: Response,
  calibration: ExecutionPlanBlueprintPortfolioCalibration,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    calibration.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get("x-napier-blueprint-portfolio-record-count"),
  ).toBe(String(calibration.recordCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-active-count"),
  ).toBe(String(calibration.activeCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-archived-count"),
  ).toBe(String(calibration.archivedCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-family-count"),
  ).toBe(String(calibration.familyCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-source-qualified-count"),
  ).toBe(String(calibration.sourceQualifiedCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-portfolio-outcome-qualified-count",
    ),
  ).toBe(String(calibration.outcomeQualifiedCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-portfolio-reviewed-baseline-count",
    ),
  ).toBe(String(calibration.reviewedBaselineCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-missing-baseline-count"),
  ).toBe(String(calibration.missingBaselineCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-policy-failed-count"),
  ).toBe(String(calibration.policyFailedCount));
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    calibration.portfolioSetSha256,
  );
}

function expectExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(
  response: Response,
  backtest: ExecutionPlanBlueprintRecommendationPolicyBacktest,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    backtest.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get("x-napier-blueprint-portfolio-record-count"),
  ).toBe(String(backtest.recordCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-active-count"),
  ).toBe(String(backtest.activeCount));
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-count"),
  ).toBe(String(backtest.policyCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-recommendation-policy-divergent-selection-count",
    ),
  ).toBe(String(backtest.divergentSelectionCount));
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    backtest.portfolioSetSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-set-sha256"),
  ).toBe(backtest.policySetSha256);
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(
  response: Response,
  override: ExecutionPlanBlueprintRecommendationPolicyOverride,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    override.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-blueprint-family-sha256")).toBe(
    override.familySha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-template"),
  ).toBe(override.recommendationPolicy.templateId);
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-sha256"),
  ).toBe(override.recommendationPolicySha256);
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    override.portfolioSetSha256,
  );
  expect(response.headers.get("x-napier-blueprint-family-record-count")).toBe(
    String(override.familyRecordCount),
  );
  expect(
    response.headers.get("x-napier-blueprint-family-outcome-qualified-count"),
  ).toBe(String(override.familyOutcomeQualifiedCount));
  expect(
    response.headers.get("x-napier-blueprint-family-completion-rate-bps"),
  ).toBe(String(override.familyCompletionRateBps));
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(
  response: Response,
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverrideList,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    overrides.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get("x-napier-blueprint-family-policy-override-count"),
  ).toBe(String(overrides.overrideCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-set-sha256",
    ),
  ).toBe(overrides.overrideSetSha256);
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    overrides.portfolioSetSha256,
  );
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(
  response: Response,
  review: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    review.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get("x-napier-blueprint-family-policy-override-count"),
  ).toBe(String(review.overrideCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-aligned-count",
    ),
  ).toBe(String(review.alignedCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retire-recommended-count",
    ),
  ).toBe(String(review.retireRecommendedCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-missing-family-count",
    ),
  ).toBe(String(review.missingFamilyCount));
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    review.portfolioSetSha256,
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-set-sha256",
    ),
  ).toBe(review.overrideSetSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-drift-review-set-sha256",
    ),
  ).toBe(review.reviewSetSha256);
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(
  response: Response,
  result: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    result.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-blueprint-family-sha256")).toBe(
    result.familySha256,
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retired-sha256",
    ),
  ).toBe(result.retiredOverrideSha256);
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-template"),
  ).toBe(result.retiredRecommendationPolicyTemplate);
  expect(
    response.headers.get("x-napier-blueprint-recommendation-policy-sha256"),
  ).toBe(result.retiredRecommendationPolicySha256);
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    result.portfolioSetSha256,
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-set-sha256",
    ),
  ).toBe(result.overrideSetSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-drift-review-set-sha256",
    ),
  ).toBe(result.driftReviewSetSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-remaining-set-sha256",
    ),
  ).toBe(result.remainingOverrideSetSha256);
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(
  response: Response,
  history: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    history.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-count",
    ),
  ).toBe(String(history.retirementCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-set-sha256",
    ),
  ).toBe(history.retirementSetSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-current-set-sha256",
    ),
  ).toBe(history.currentOverrideSetSha256);
  expect(response.headers.get("x-napier-blueprint-portfolio-set-sha256")).toBe(
    history.portfolioSetSha256,
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-latest-retired-at",
    ),
  ).toBe(history.latestRetiredAt ?? null);
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(
  response: Response,
  verification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-declared-content-sha256")).toBe(
    verification.declaredContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-recomputed-content-sha256")).toBe(
    verification.recomputedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-content-sha256")).toBe(
    verification.observedContentSha256,
  );
  expect(
    response.headers.get("x-napier-declared-blueprint-portfolio-set-sha256"),
  ).toBe(verification.declaredPortfolioSetSha256 ?? null);
  expect(
    response.headers.get("x-napier-observed-blueprint-portfolio-set-sha256"),
  ).toBe(verification.observedPortfolioSetSha256);
  expect(
    response.headers.get(
      "x-napier-declared-blueprint-family-policy-override-current-set-sha256",
    ),
  ).toBe(verification.declaredCurrentOverrideSetSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-observed-blueprint-family-policy-override-current-set-sha256",
    ),
  ).toBe(verification.observedCurrentOverrideSetSha256);
  expect(
    response.headers.get(
      "x-napier-declared-blueprint-family-policy-override-retirement-set-sha256",
    ),
  ).toBe(verification.declaredRetirementSetSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-recomputed-blueprint-family-policy-override-retirement-set-sha256",
    ),
  ).toBe(verification.recomputedRetirementSetSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-observed-blueprint-family-policy-override-retirement-set-sha256",
    ),
  ).toBe(verification.observedRetirementSetSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-count",
    ),
  ).toBe(verification.retirementCount?.toString() ?? null);
  expect(
    response.headers.get(
      "x-napier-observed-blueprint-family-policy-override-retirement-count",
    ),
  ).toBe(String(verification.observedRetirementCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-latest-retired-at",
    ),
  ).toBe(verification.latestRetiredAt ?? null);
  expect(
    response.headers.get(
      "x-napier-observed-blueprint-family-policy-override-latest-retired-at",
    ),
  ).toBe(verification.observedLatestRetiredAt ?? null);
}

function expectExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(
  response: Response,
  proofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    proofBundle.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    proofBundle.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(proofBundle.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(proofBundle.diagnostics),
  );
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-history-count",
    ),
  ).toBe(String(proofBundle.historyCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-history-valid-count",
    ),
  ).toBe(String(proofBundle.validHistoryCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-history-invalid-count",
    ),
  ).toBe(String(proofBundle.invalidHistoryCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-history-distinct-count",
    ),
  ).toBe(String(proofBundle.distinctHistoryCount));
  expect(
    response.headers.get("x-napier-blueprint-portfolio-set-distinct-count"),
  ).toBe(String(proofBundle.distinctPortfolioSetCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-current-set-distinct-count",
    ),
  ).toBe(String(proofBundle.distinctCurrentOverrideSetCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-set-distinct-count",
    ),
  ).toBe(String(proofBundle.distinctRetirementSetCount));
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-history-set-sha256",
    ),
  ).toBe(proofBundle.historySetSha256);
  expect(
    response.headers.get("x-napier-blueprint-portfolio-set-bundle-sha256"),
  ).toBe(proofBundle.portfolioSetBundleSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-current-set-bundle-sha256",
    ),
  ).toBe(proofBundle.currentOverrideSetBundleSha256);
  expect(
    response.headers.get(
      "x-napier-blueprint-family-policy-override-retirement-set-bundle-sha256",
    ),
  ).toBe(proofBundle.retirementSetBundleSha256);
}

function expectExecutionPlanBlueprintRecordReplayEventVerificationHeaders(
  response: Response,
  verification: ExecutionPlanBlueprintRecordReplayEventVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(
    response.headers.get("x-napier-expected-plan-blueprint-record-id"),
  ).toBe(verification.expectedRecordId);
  expect(response.headers.get("x-napier-thread-id")).toBe(
    verification.threadId,
  );
  expect(response.headers.get("x-napier-blueprint-replay-event-id")).toBe(
    verification.eventId,
  );
  expect(response.headers.get("x-napier-blueprint-replay-event-seq")).toBe(
    String(verification.seq),
  );
  expect(response.headers.get("x-napier-declared-event-sha256")).toBe(
    verification.declaredEventSha256,
  );
  expect(response.headers.get("x-napier-observed-event-sha256")).toBe(
    verification.observedEventSha256 ?? null,
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    verification.observedReplay?.recordId ?? null,
  );
  expect(response.headers.get("x-napier-plan-id")).toBe(
    verification.observedReplay?.planId ?? null,
  );
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    verification.observedReplay?.blueprintSha256 ?? null,
  );
  expect(response.headers.get("x-napier-blueprint-preview-sha256")).toBe(
    verification.observedReplay?.previewSha256 ?? null,
  );
}

function expectExecutionPlanBlueprintRecordQualificationHeaders(
  response: Response,
  qualification: ExecutionPlanBlueprintRecordQualification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(qualification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-qualification-status")).toBe(
    qualification.status,
  );
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    qualification.recordId,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(qualification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(qualification.diagnostics))
      .digest("hex"),
  );
  expect(response.headers.get("x-napier-plan-step-count")).toBe(
    String(qualification.stepCount),
  );
  expect(response.headers.get("x-napier-plan-artifact-count")).toBe(
    String(qualification.artifactCount),
  );
  if (qualification.recordStatus) {
    expect(response.headers.get("x-napier-plan-blueprint-status")).toBe(
      qualification.recordStatus,
    );
  }
  if (qualification.blueprintSha256) {
    expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
      qualification.blueprintSha256,
    );
  }
  if (qualification.expectedPlanArchiveSha256) {
    expect(
      response.headers.get("x-napier-blueprint-source-archive-sha256"),
    ).toBe(qualification.expectedPlanArchiveSha256);
  }
  if (qualification.actualPlanArchiveSha256) {
    expect(
      response.headers.get("x-napier-blueprint-actual-source-archive-sha256"),
    ).toBe(qualification.actualPlanArchiveSha256);
  }
}

function expectExecutionPlanBlueprintRecordMetadataHeaders(
  response: Response,
  record: ExecutionPlanBlueprintRecord,
): void {
  expect(response.headers.get("x-napier-plan-blueprint-record-id")).toBe(
    record.id,
  );
  expect(response.headers.get("x-napier-plan-blueprint-status")).toBe(
    record.status,
  );
  expect(response.headers.get("x-napier-plan-blueprint-sha256")).toBe(
    record.blueprintSha256,
  );
  expect(response.headers.get("x-napier-blueprint-source-thread-id")).toBe(
    record.sourceThreadId,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-id")).toBe(
    record.sourcePlanId,
  );
  expect(response.headers.get("x-napier-blueprint-source-plan-revision")).toBe(
    String(record.sourcePlanRevision),
  );
  expect(response.headers.get("x-napier-blueprint-source-archive-sha256")).toBe(
    record.sourcePlanArchiveSha256,
  );
  expect(
    response.headers.get("x-napier-blueprint-source-event-stream-sha256"),
  ).toBe(record.sourceEventStreamSha256);
}

function expectExtensionListHeaders(
  response: Response,
  extensions: ExtensionRecord[],
  agentId?: string,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(extensions))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-agent-id")).toBe(agentId ?? null);
  expect(response.headers.get("x-napier-extension-count")).toBe(
    String(extensions.length),
  );
  for (const status of [
    "pending",
    "approved",
    "rejected",
  ] satisfies ExtensionRecord["trustStatus"][]) {
    expect(
      response.headers.get(`x-napier-extension-trust-${status}-count`),
    ).toBe(
      String(
        extensions.filter((extension) => extension.trustStatus === status)
          .length,
      ),
    );
  }
  expect(response.headers.get("x-napier-extension-enabled-agent-count")).toBe(
    String(
      extensions.reduce(
        (total, extension) => total + extension.enabledAgentIds.length,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-extension-tool-count")).toBe(
    String(
      extensions.reduce(
        (total, extension) => total + extension.tools.length,
        0,
      ),
    ),
  );
}

function expectExtensionRecordHeaders(
  response: Response,
  extension: ExtensionRecord,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(extension))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-extension-id")).toBe(extension.id);
  expect(response.headers.get("x-napier-extension-kind")).toBe(extension.kind);
  expect(response.headers.get("x-napier-extension-trust-status")).toBe(
    extension.trustStatus,
  );
  expect(response.headers.get("x-napier-extension-connection-status")).toBe(
    extension.connection.status,
  );
  expect(response.headers.get("x-napier-extension-revision")).toBe(
    String(extension.revision),
  );
  expect(
    response.headers.get("x-napier-extension-requested-capability-count"),
  ).toBe(String(extension.requestedCapabilities.length));
  expect(
    response.headers.get("x-napier-extension-approved-capability-count"),
  ).toBe(String(extension.approvedCapabilities.length));
  expect(response.headers.get("x-napier-extension-enabled-agent-count")).toBe(
    String(extension.enabledAgentIds.length),
  );
  expect(response.headers.get("x-napier-extension-tool-count")).toBe(
    String(extension.tools.length),
  );
  expect(response.headers.get("x-napier-extension-reviewed-tool-count")).toBe(
    String(
      extension.tools.filter((tool) => tool.reviewStatus !== "pending").length,
    ),
  );
  expect(
    response.headers.get("x-napier-extension-package-binding-sha256"),
  ).toBe(extension.packageBinding?.contentSha256 ?? null);
}

function expectRunReplaySnapshotHeaders(
  response: Response,
  snapshot: RunReplaySnapshot,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(snapshot.threadId);
  expect(response.headers.get("x-napier-run-id")).toBe(snapshot.run.id);
  expect(response.headers.get("x-napier-snapshot-sha256")).toBe(
    snapshot.contentSha256,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    snapshot.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(snapshot.events.length),
  );
  expect(response.headers.get("x-napier-subagent-count")).toBe(
    String(snapshot.subagents.length),
  );
  expectRunMetricsHeaders(response, "x-napier-run", snapshot.metrics);
  if (snapshot.configurationSha256) {
    expect(response.headers.get("x-napier-configuration-sha256")).toBe(
      snapshot.configurationSha256,
    );
  }
  expectEventBoundaryHeaders(response, snapshot.events);
}

function expectRunReplaySnapshotVerificationHeaders(
  response: Response,
  verification: RunReplaySnapshotVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(verification.eventCount),
  );
  expect(response.headers.get("x-napier-subagent-count")).toBe(
    String(verification.subagentCount),
  );
  expect(response.headers.get("x-napier-model-context-envelope-count")).toBe(
    String(verification.modelContextEnvelopeCount),
  );
  expect(
    response.headers.get("x-napier-embedded-model-context-envelope-count"),
  ).toBe(String(verification.embeddedModelContextEnvelopeCount));
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    verification.threadId ?? null,
  );
  expect(response.headers.get("x-napier-run-id")).toBe(
    verification.runId ?? null,
  );
  expect(response.headers.get("x-napier-snapshot-sha256")).toBe(
    verification.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    verification.eventStreamSha256 ?? null,
  );
  expect(response.headers.get("x-napier-configuration-sha256")).toBe(
    verification.configurationSha256 ?? null,
  );
  expect(response.headers.get("x-napier-assistant-text-sha256")).toBe(
    verification.assistantTextSha256 ?? null,
  );
}

function expectThreadReplayBundleHeaders(
  response: Response,
  bundle: ThreadReplayBundle,
): void {
  const verification = verifyThreadReplayBundle(bundle);
  expect(verification.status).toBe("valid");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    bundle.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(bundle.thread.id);
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    bundle.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(verification.eventCount),
  );
  expect(response.headers.get("x-napier-run-count")).toBe(
    String(verification.runCount),
  );
  expect(response.headers.get("x-napier-plan-count")).toBe(
    String(verification.planCount),
  );
  expect(response.headers.get("x-napier-evaluation-count")).toBe(
    String(verification.evaluationCount),
  );
  expect(response.headers.get("x-napier-model-context-envelope-count")).toBe(
    String(verification.modelContextEnvelopeCount),
  );
  expect(
    response.headers.get("x-napier-embedded-model-context-envelope-count"),
  ).toBe(String(verification.embeddedModelContextEnvelopeCount));
  expectEventBoundaryHeaders(response, bundle.events);
}

function expectThreadReplayBundleVerificationHeaders(
  response: Response,
  verification: ThreadReplayBundleVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("body");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(verification.eventCount),
  );
  expect(response.headers.get("x-napier-run-count")).toBe(
    String(verification.runCount),
  );
  expect(response.headers.get("x-napier-plan-count")).toBe(
    String(verification.planCount),
  );
  expect(response.headers.get("x-napier-evaluation-count")).toBe(
    String(verification.evaluationCount),
  );
  expect(response.headers.get("x-napier-model-context-envelope-count")).toBe(
    String(verification.modelContextEnvelopeCount),
  );
  expect(
    response.headers.get("x-napier-embedded-model-context-envelope-count"),
  ).toBe(String(verification.embeddedModelContextEnvelopeCount));
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    responseSha256(verification.diagnostics),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    verification.threadId ?? null,
  );
  expect(response.headers.get("x-napier-agent-id")).toBe(
    verification.agentId ?? null,
  );
  expect(response.headers.get("x-napier-bundle-sha256")).toBe(
    verification.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    verification.eventStreamSha256 ?? null,
  );
}

function expectRunComparisonHeaders(
  response: Response,
  comparison: RunComparison,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(comparison))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(comparison.threadId);
  expect(response.headers.get("x-napier-left-run-id")).toBe(
    comparison.left.run.id,
  );
  expect(response.headers.get("x-napier-right-run-id")).toBe(
    comparison.right.run.id,
  );
  expect(response.headers.get("x-napier-left-event-stream-sha256")).toBe(
    comparison.left.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-right-event-stream-sha256")).toBe(
    comparison.right.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-left-event-count")).toBe(
    String(comparison.left.events.length),
  );
  expect(response.headers.get("x-napier-right-event-count")).toBe(
    String(comparison.right.events.length),
  );
  expectRunMetricsHeaders(
    response,
    "x-napier-left-run",
    comparison.left.metrics,
  );
  expectRunMetricsHeaders(
    response,
    "x-napier-right-run",
    comparison.right.metrics,
  );
  expectRunMetricsHeaders(
    response,
    "x-napier-run-delta",
    comparison.metricDelta,
  );
  expect(response.headers.get("x-napier-output-changed")).toBe(
    String(comparison.outputChanged),
  );
  expect(response.headers.get("x-napier-configuration-delta-status")).toBe(
    comparison.configurationDelta.status,
  );
  expect(response.headers.get("x-napier-context-coverage-status")).toBe(
    comparison.contextCoverageDelta.status,
  );
  expect(response.headers.get("x-napier-context-coverage-left-rate")).toBe(
    String(comparison.contextCoverageDelta.left.coverageRate),
  );
  expect(response.headers.get("x-napier-context-coverage-right-rate")).toBe(
    String(comparison.contextCoverageDelta.right.coverageRate),
  );
  expect(response.headers.get("x-napier-context-coverage-rate-delta")).toBe(
    String(comparison.contextCoverageDelta.coverageRateDelta),
  );
  expect(
    response.headers.get(
      "x-napier-context-coverage-left-embedded-envelope-count",
    ),
  ).toBe(String(comparison.contextCoverageDelta.left.embeddedEnvelopeCount));
  expect(
    response.headers.get(
      "x-napier-context-coverage-right-embedded-envelope-count",
    ),
  ).toBe(String(comparison.contextCoverageDelta.right.embeddedEnvelopeCount));
  expect(
    response.headers.get("x-napier-context-coverage-embedded-envelope-delta"),
  ).toBe(String(comparison.contextCoverageDelta.embeddedEnvelopeDelta));
  expect(
    response.headers.get("x-napier-context-coverage-diagnostic-count"),
  ).toBe(String(comparison.contextCoverageDelta.diagnostics.length));
  expect(
    response.headers.get("x-napier-context-coverage-diagnostics-sha256"),
  ).toBe(responseSha256(comparison.contextCoverageDelta.diagnostics));
  expect(response.headers.get("x-napier-trace-summary-boundary-status")).toBe(
    comparison.traceSummaryBoundaryDelta.status,
  );
  expect(
    response.headers.get("x-napier-trace-summary-boundary-left-generic-count"),
  ).toBe(String(comparison.traceSummaryBoundaryDelta.left.generic));
  expect(
    response.headers.get("x-napier-trace-summary-boundary-right-generic-count"),
  ).toBe(String(comparison.traceSummaryBoundaryDelta.right.generic));
  expect(
    response.headers.get("x-napier-trace-summary-boundary-generic-delta"),
  ).toBe(String(comparison.traceSummaryBoundaryDelta.genericDelta));
  expect(
    response.headers.get("x-napier-trace-summary-boundary-diagnostic-count"),
  ).toBe(String(comparison.traceSummaryBoundaryDelta.diagnostics.length));
  expect(
    response.headers.get("x-napier-trace-summary-boundary-diagnostics-sha256"),
  ).toBe(responseSha256(comparison.traceSummaryBoundaryDelta.diagnostics));
  expect(response.headers.get("x-napier-event-type-delta-sha256")).toBe(
    responseSha256(comparison.eventTypeDelta),
  );
  expect(response.headers.get("x-napier-added-tool-count")).toBe(
    String(comparison.addedToolNames.length),
  );
  expect(response.headers.get("x-napier-removed-tool-count")).toBe(
    String(comparison.removedToolNames.length),
  );
  expect(response.headers.get("x-napier-added-tools-sha256")).toBe(
    responseSha256(comparison.addedToolNames),
  );
  expect(response.headers.get("x-napier-removed-tools-sha256")).toBe(
    responseSha256(comparison.removedToolNames),
  );
  expectRunConfigurationDeltaHeaders(response, comparison.configurationDelta);
  if (comparison.left.configurationSha256) {
    expect(response.headers.get("x-napier-left-configuration-sha256")).toBe(
      comparison.left.configurationSha256,
    );
  }
  if (comparison.right.configurationSha256) {
    expect(response.headers.get("x-napier-right-configuration-sha256")).toBe(
      comparison.right.configurationSha256,
    );
  }
}

function expectRunConfigurationDeltaHeaders(
  response: Response,
  delta: RunComparison["configurationDelta"],
): void {
  expect(
    response.headers.get("x-napier-configuration-changed-field-count"),
  ).toBe(String(delta.changedFields.length));
  expect(
    response.headers.get("x-napier-configuration-changed-fields-sha256"),
  ).toBe(responseSha256(delta.changedFields));
  expect(response.headers.get("x-napier-configuration-added-tool-count")).toBe(
    String(delta.addedTools.length),
  );
  expect(
    response.headers.get("x-napier-configuration-removed-tool-count"),
  ).toBe(String(delta.removedTools.length));
  expect(
    response.headers.get("x-napier-configuration-added-tools-sha256"),
  ).toBe(responseSha256(delta.addedTools));
  expect(
    response.headers.get("x-napier-configuration-removed-tools-sha256"),
  ).toBe(responseSha256(delta.removedTools));
  expect(response.headers.get("x-napier-configuration-added-skill-count")).toBe(
    String(delta.addedSkills.length),
  );
  expect(
    response.headers.get("x-napier-configuration-removed-skill-count"),
  ).toBe(String(delta.removedSkills.length));
  expect(
    response.headers.get("x-napier-configuration-added-skills-sha256"),
  ).toBe(responseSha256(delta.addedSkills));
  expect(
    response.headers.get("x-napier-configuration-removed-skills-sha256"),
  ).toBe(responseSha256(delta.removedSkills));
  expect(
    response.headers.get("x-napier-configuration-added-subagent-count"),
  ).toBe(String(delta.addedSubagents.length));
  expect(
    response.headers.get("x-napier-configuration-removed-subagent-count"),
  ).toBe(String(delta.removedSubagents.length));
  expect(
    response.headers.get("x-napier-configuration-added-subagents-sha256"),
  ).toBe(responseSha256(delta.addedSubagents));
  expect(
    response.headers.get("x-napier-configuration-removed-subagents-sha256"),
  ).toBe(responseSha256(delta.removedSubagents));
}

function expectRunMetricsHeaders(
  response: Response,
  prefix: string,
  metrics: Omit<RunMetrics, "assistantTextSha256"> & {
    assistantTextSha256?: string;
  },
): void {
  expect(response.headers.get(`${prefix}-duration-ms`)).toBe(
    String(metrics.durationMs),
  );
  expect(response.headers.get(`${prefix}-event-count`)).toBe(
    String(metrics.eventCount),
  );
  expect(response.headers.get(`${prefix}-message-count`)).toBe(
    String(metrics.messageCount),
  );
  expect(response.headers.get(`${prefix}-model-response-count`)).toBe(
    String(metrics.modelResponseCount),
  );
  expect(response.headers.get(`${prefix}-model-context-envelope-count`)).toBe(
    String(metrics.modelContextEnvelopeCount),
  );
  expect(
    response.headers.get(`${prefix}-embedded-model-context-envelope-count`),
  ).toBe(String(metrics.embeddedModelContextEnvelopeCount));
  expect(
    response.headers.get(`${prefix}-model-context-bound-response-count`),
  ).toBe(String(metrics.modelContextBoundResponseCount));
  expect(
    response.headers.get(`${prefix}-model-context-unbound-response-count`),
  ).toBe(String(metrics.modelContextUnboundResponseCount));
  expect(response.headers.get(`${prefix}-tool-call-count`)).toBe(
    String(metrics.toolCallCount),
  );
  expect(response.headers.get(`${prefix}-tool-completed-count`)).toBe(
    String(metrics.toolCompletedCount),
  );
  expect(response.headers.get(`${prefix}-tool-failed-count`)).toBe(
    String(metrics.toolFailedCount),
  );
  expect(response.headers.get(`${prefix}-tool-blocked-count`)).toBe(
    String(metrics.toolBlockedCount),
  );
  expect(response.headers.get(`${prefix}-subagent-count`)).toBe(
    String(metrics.subagentCount),
  );
  expect(response.headers.get(`${prefix}-input-tokens`)).toBe(
    String(metrics.inputTokens),
  );
  expect(response.headers.get(`${prefix}-output-tokens`)).toBe(
    String(metrics.outputTokens),
  );
  expect(response.headers.get(`${prefix}-cache-read-tokens`)).toBe(
    String(metrics.cacheReadTokens),
  );
  expect(response.headers.get(`${prefix}-cache-write-tokens`)).toBe(
    String(metrics.cacheWriteTokens),
  );
  expect(response.headers.get(`${prefix}-cost-usd`)).toBe(
    String(metrics.costUsd),
  );
  expect(response.headers.get(`${prefix}-assistant-text-sha256`)).toBe(
    metrics.assistantTextSha256 ?? null,
  );
}

function expectRunEvaluationListHeaders(
  response: Response,
  threadId: string,
  evaluations: RunEvaluationRecord[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(evaluations))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-evaluation-count")).toBe(
    String(evaluations.length),
  );
}

function expectRunEvaluationRecordHeaders(
  response: Response,
  evaluation: RunEvaluationRecord,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(evaluation),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(evaluation.threadId);
  expect(response.headers.get("x-napier-evaluation-id")).toBe(evaluation.id);
  expect(response.headers.get("x-napier-left-run-id")).toBe(
    evaluation.leftRunId,
  );
  expect(response.headers.get("x-napier-right-run-id")).toBe(
    evaluation.rightRunId,
  );
  expect(response.headers.get("x-napier-evaluation-verdict")).toBe(
    evaluation.verdict,
  );
  expect(response.headers.get("x-napier-left-snapshot-sha256")).toBe(
    evaluation.leftSnapshotSha256,
  );
  expect(response.headers.get("x-napier-right-snapshot-sha256")).toBe(
    evaluation.rightSnapshotSha256,
  );
  expect(response.headers.get("x-napier-evaluation-criterion-count")).toBe(
    String(evaluation.scores.length),
  );
  if (evaluation.comparisonGovernance) {
    expect(response.headers.get("x-napier-comparison-governance-sha256")).toBe(
      evaluation.comparisonGovernance.contentSha256,
    );
    expect(response.headers.get("x-napier-context-coverage-status")).toBe(
      evaluation.comparisonGovernance.contextCoverageStatus,
    );
    expect(
      response.headers.get("x-napier-context-coverage-diagnostics-sha256"),
    ).toBe(evaluation.comparisonGovernance.contextCoverageDiagnosticsSha256);
    if (
      evaluation.comparisonGovernance.traceSummaryBoundaryStatus &&
      evaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256
    ) {
      expect(
        response.headers.get("x-napier-trace-summary-boundary-status"),
      ).toBe(evaluation.comparisonGovernance.traceSummaryBoundaryStatus);
      expect(
        response.headers.get(
          "x-napier-trace-summary-boundary-diagnostics-sha256",
        ),
      ).toBe(
        evaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256,
      );
    }
  }
}

function expectEvaluationAdjudicationListHeaders(
  response: Response,
  threadId: string,
  adjudications: EvaluationAdjudication[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(adjudications))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-adjudication-count")).toBe(
    String(adjudications.length),
  );
  expect(response.headers.get("x-napier-adjudication-revision-count")).toBe(
    String(
      adjudications.reduce(
        (total, adjudication) => total + adjudication.revisions.length,
        0,
      ),
    ),
  );
}

function expectEvaluationAdjudicationHeaders(
  response: Response,
  adjudication: EvaluationAdjudication,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(adjudication),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    adjudication.threadId,
  );
  expect(response.headers.get("x-napier-evaluation-id")).toBe(
    adjudication.evaluationId,
  );
  expect(response.headers.get("x-napier-adjudication-id")).toBe(
    adjudication.id,
  );
  expect(response.headers.get("x-napier-adjudication-revision")).toBe(
    String(adjudication.currentRevision),
  );
  expect(response.headers.get("x-napier-adjudication-revision-count")).toBe(
    String(adjudication.revisions.length),
  );
  const latest = adjudication.revisions.at(-1);
  expect(response.headers.get("x-napier-adjudication-sha256")).toBe(
    latest?.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-expected-verdict")).toBe(
    latest?.expectedVerdict ?? null,
  );
  expect(response.headers.get("x-napier-evaluation-sha256")).toBe(
    latest?.evaluationSha256 ?? null,
  );
}

function expectEvaluationReviewerBallotListHeaders(
  response: Response,
  threadId: string,
  evaluationId: string,
  ballots: EvaluationReviewerBallot[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(ballots))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-evaluation-id")).toBe(evaluationId);
  expect(response.headers.get("x-napier-reviewer-ballot-count")).toBe(
    String(ballots.length),
  );
  expect(response.headers.get("x-napier-reviewer-ballot-revision-count")).toBe(
    String(
      ballots.reduce((total, ballot) => total + ballot.revisions.length, 0),
    ),
  );
}

function expectEvaluationReviewerBallotHeaders(
  response: Response,
  ballot: EvaluationReviewerBallot,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(ballot),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(ballot.threadId);
  expect(response.headers.get("x-napier-evaluation-id")).toBe(
    ballot.evaluationId,
  );
  expect(response.headers.get("x-napier-reviewer-ballot-id")).toBe(ballot.id);
  expect(response.headers.get("x-napier-reviewer-id")).toBe(ballot.reviewerId);
  expect(response.headers.get("x-napier-reviewer-ballot-revision")).toBe(
    String(ballot.currentRevision),
  );
  expect(response.headers.get("x-napier-reviewer-ballot-revision-count")).toBe(
    String(ballot.revisions.length),
  );
  const latest = ballot.revisions.at(-1);
  expect(response.headers.get("x-napier-reviewer-ballot-sha256")).toBe(
    latest?.contentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-expected-verdict")).toBe(
    latest?.expectedVerdict ?? null,
  );
  expect(response.headers.get("x-napier-evaluation-sha256")).toBe(
    latest?.evaluationSha256 ?? null,
  );
}

function expectEvaluationConsensusReportHeaders(
  response: Response,
  report: EvaluationConsensusReport,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    report.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(report.threadId);
  expect(response.headers.get("x-napier-evaluation-id")).toBe(
    report.evaluationId,
  );
  expect(response.headers.get("x-napier-consensus-status")).toBe(report.status);
  expect(response.headers.get("x-napier-reviewer-count")).toBe(
    String(report.reviewerCount),
  );
  expect(response.headers.get("x-napier-consensus-count")).toBe(
    String(report.consensusCount),
  );
  expect(response.headers.get("x-napier-agreement-rate")).toBe(
    String(report.agreementRate),
  );
  if (report.consensusVerdict) {
    expect(response.headers.get("x-napier-consensus-verdict")).toBe(
      report.consensusVerdict,
    );
  }
}
function expectEvaluationConsensusResolutionResultHeaders(
  response: Response,
  result: ResolveEvaluationConsensusResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    result.report.threadId,
  );
  expect(response.headers.get("x-napier-evaluation-id")).toBe(
    result.report.evaluationId,
  );
  expect(response.headers.get("x-napier-consensus-resolution-created")).toBe(
    String(result.created),
  );
  expect(response.headers.get("x-napier-consensus-status")).toBe(
    result.report.status,
  );
  expect(response.headers.get("x-napier-reviewer-count")).toBe(
    String(result.report.reviewerCount),
  );
  expect(response.headers.get("x-napier-consensus-count")).toBe(
    String(result.report.consensusCount),
  );
  expect(response.headers.get("x-napier-agreement-rate")).toBe(
    String(result.report.agreementRate),
  );
  expect(response.headers.get("x-napier-consensus-report-sha256")).toBe(
    result.report.contentSha256,
  );
  expect(response.headers.get("x-napier-adjudication-id")).toBe(
    result.adjudication.id,
  );
  expect(response.headers.get("x-napier-adjudication-revision")).toBe(
    String(result.adjudication.currentRevision),
  );
  expect(response.headers.get("x-napier-consensus-verdict")).toBe(
    result.report.consensusVerdict ?? null,
  );
  expect(response.headers.get("x-napier-consensus-resolution-id")).toBe(
    result.resolution.id,
  );
  expect(response.headers.get("x-napier-consensus-resolution-sha256")).toBe(
    result.resolution.contentSha256,
  );
}

function expectEvaluationConsensusResolutionListHeaders(
  response: Response,
  threadId: string,
  evaluationId: string,
  resolutions: EvaluationConsensusResolution[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(resolutions))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-evaluation-id")).toBe(evaluationId);
  expect(response.headers.get("x-napier-consensus-resolution-count")).toBe(
    String(resolutions.length),
  );
}

function expectEvaluationCasebookListHeaders(
  response: Response,
  casebooks: EvaluationCasebook[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(casebooks))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-casebook-count")).toBe(
    String(casebooks.length),
  );
  expect(response.headers.get("x-napier-casebook-revision-count")).toBe(
    String(
      casebooks.reduce(
        (total, casebook) => total + casebook.revisions.length,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-case-count")).toBe(
    String(
      casebooks.reduce((total, casebook) => total + casebook.cases.length, 0),
    ),
  );
}

function expectEvaluationCasebookProjectionHeaders(
  response: Response,
  casebook: EvaluationCasebook,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(casebook))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-casebook-id")).toBe(casebook.id);
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(casebook.currentRevision),
  );
  expect(response.headers.get("x-napier-case-count")).toBe(
    String(casebook.cases.length),
  );
  expect(response.headers.get("x-napier-casebook-revision-count")).toBe(
    String(casebook.revisions.length),
  );
}

function expectEvaluationCasebookCalibrationHeaders(
  response: Response,
  report: EvaluationCasebookCalibrationReport,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    report.contentSha256,
  );
  expect(response.headers.get("x-napier-casebook-id")).toBe(report.casebookId);
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(report.casebookRevision),
  );
  expect(response.headers.get("x-napier-calibration-sample-count")).toBe(
    String(report.sampleCount),
  );
  expect(response.headers.get("x-napier-calibration-agreement-count")).toBe(
    String(report.agreementCount),
  );
  expect(response.headers.get("x-napier-calibration-agreement-rate")).toBe(
    String(report.agreementRate),
  );
  expect(response.headers.get("x-napier-calibration-group-count")).toBe(
    String(report.groups.length),
  );
}

function expectEvaluationCasebookArtifactHeaders(
  response: Response,
  artifact: EvaluationCasebookArtifact,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="napier-casebook-${artifact.casebook.id}-r${artifact.casebook.currentRevision}-${artifact.contentSha256.slice(0, 12)}.json"`,
  );
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    artifact.contentSha256,
  );
  expect(response.headers.get("x-napier-casebook-id")).toBe(
    artifact.casebook.id,
  );
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(artifact.casebook.currentRevision),
  );
  expect(response.headers.get("x-napier-case-count")).toBe(
    String(artifact.casebook.cases.length),
  );
  expect(response.headers.get("x-napier-casebook-revision-count")).toBe(
    String(artifact.casebook.revisions.length),
  );
  expect(response.headers.get("x-napier-calibration-sample-count")).toBe(
    String(artifact.calibration.sampleCount),
  );
  expect(response.headers.get("x-napier-calibration-agreement-rate")).toBe(
    String(artifact.calibration.agreementRate),
  );
}

function expectEvaluationCasebookQualificationListHeaders(
  response: Response,
  casebookId: string,
  qualifications: EvaluationCasebookQualificationExecution[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(qualifications))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-casebook-id")).toBe(casebookId);
  expect(response.headers.get("x-napier-qualification-execution-count")).toBe(
    String(qualifications.length),
  );
  expect(response.headers.get("x-napier-qualification-sample-count")).toBe(
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.sampleCount,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-qualification-agreement-count")).toBe(
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.agreementCount,
        0,
      ),
    ),
  );
  expect(
    response.headers.get("x-napier-qualification-inconclusive-count"),
  ).toBe(
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.inconclusiveCount,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-qualification-unverified-count")).toBe(
    String(
      qualifications.reduce(
        (total, qualification) => total + qualification.unverifiedCount,
        0,
      ),
    ),
  );
}

function expectEvaluationCasebookQualificationExecutionHeaders(
  response: Response,
  execution: EvaluationCasebookQualificationExecution,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    execution.contentSha256,
  );
  expect(response.headers.get("x-napier-casebook-id")).toBe(
    execution.casebookId,
  );
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(execution.casebookRevision),
  );
  expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
    execution.id,
  );
  expect(response.headers.get("x-napier-qualification-execution-status")).toBe(
    execution.status,
  );
  expect(response.headers.get("x-napier-audit-thread-id")).toBe(
    execution.auditThreadId,
  );
  expect(response.headers.get("x-napier-qualification-sample-count")).toBe(
    String(execution.sampleCount),
  );
  expect(response.headers.get("x-napier-qualification-agreement-count")).toBe(
    String(execution.agreementCount),
  );
  expect(
    response.headers.get("x-napier-qualification-inconclusive-count"),
  ).toBe(String(execution.inconclusiveCount));
  expect(response.headers.get("x-napier-qualification-unverified-count")).toBe(
    String(execution.unverifiedCount),
  );
  expect(response.headers.get("x-napier-qualification-agreement-rate")).toBe(
    String(execution.agreementRate),
  );
}

function expectEvaluationCasebookQualificationReceiptHeaders(
  response: Response,
  receipt: EvaluationCasebookQualificationReceipt,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="napier-casebook-qualification-${receipt.casebook.id}-r${receipt.casebook.currentRevision}-${receipt.contentSha256.slice(0, 12)}.json"`,
  );
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    receipt.contentSha256,
  );
  expect(response.headers.get("x-napier-casebook-id")).toBe(
    receipt.casebook.id,
  );
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(receipt.casebook.currentRevision),
  );
  expect(response.headers.get("x-napier-qualification-state")).toBe(
    receipt.state,
  );
  expect(response.headers.get("x-napier-case-count")).toBe(
    String(receipt.casebook.cases.length),
  );
  expect(response.headers.get("x-napier-casebook-revision-count")).toBe(
    String(receipt.casebook.revisions.length),
  );
  if (receipt.execution) {
    expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
      receipt.execution.id,
    );
    expect(
      response.headers.get("x-napier-qualification-execution-status"),
    ).toBe(receipt.execution.status);
    expect(
      response.headers.get("x-napier-qualification-execution-sha256"),
    ).toBe(receipt.execution.contentSha256);
    expect(response.headers.get("x-napier-audit-thread-id")).toBe(
      receipt.execution.auditThreadId,
    );
    expect(response.headers.get("x-napier-qualification-sample-count")).toBe(
      String(receipt.execution.sampleCount),
    );
    expect(response.headers.get("x-napier-qualification-agreement-count")).toBe(
      String(receipt.execution.agreementCount),
    );
    expect(
      response.headers.get("x-napier-qualification-inconclusive-count"),
    ).toBe(String(receipt.execution.inconclusiveCount));
    expect(
      response.headers.get("x-napier-qualification-unverified-count"),
    ).toBe(String(receipt.execution.unverifiedCount));
  } else {
    expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
      null,
    );
    expect(
      response.headers.get("x-napier-qualification-execution-status"),
    ).toBe(null);
    expect(
      response.headers.get("x-napier-qualification-execution-sha256"),
    ).toBe(null);
    expect(response.headers.get("x-napier-audit-thread-id")).toBe(null);
    expect(response.headers.get("x-napier-qualification-sample-count")).toBe(
      null,
    );
    expect(response.headers.get("x-napier-qualification-agreement-count")).toBe(
      null,
    );
    expect(
      response.headers.get("x-napier-qualification-inconclusive-count"),
    ).toBe(null);
    expect(
      response.headers.get("x-napier-qualification-unverified-count"),
    ).toBe(null);
  }
}

function expectEvaluationSuiteListHeaders(
  response: Response,
  threadId: string,
  suites: EvaluationSuite[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(suites))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-evaluation-suite-count")).toBe(
    String(suites.length),
  );
  expect(response.headers.get("x-napier-evaluation-suite-revision-count")).toBe(
    String(suites.reduce((total, suite) => total + suite.revision, 0)),
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-candidate-count"),
  ).toBe(
    String(
      suites.reduce((total, suite) => total + suite.candidateRunIds.length, 0),
    ),
  );
}

function expectEvaluationSuiteProjectionHeaders(
  response: Response,
  suite: EvaluationSuite,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(suite),
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(suite.threadId);
  expect(response.headers.get("x-napier-evaluation-suite-id")).toBe(suite.id);
  expect(response.headers.get("x-napier-evaluation-suite-revision")).toBe(
    String(suite.revision),
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-candidate-count"),
  ).toBe(String(suite.candidateRunIds.length));
  expect(response.headers.get("x-napier-baseline-run-id")).toBe(
    suite.baselineRunId,
  );
}

function expectEvaluationSuiteExecutionListHeaders(
  response: Response,
  threadId: string,
  suiteId: string | undefined,
  executions: EvaluationSuiteExecution[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(executions))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-evaluation-suite-id")).toBe(
    suiteId ?? null,
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-execution-count"),
  ).toBe(String(executions.length));
  expect(response.headers.get("x-napier-evaluation-suite-case-count")).toBe(
    String(
      executions.reduce(
        (total, execution) => total + execution.results.length,
        0,
      ),
    ),
  );
  expect(response.headers.get("x-napier-evaluation-suite-passed-count")).toBe(
    String(
      executions.reduce((total, execution) => total + execution.passedCount, 0),
    ),
  );
  expect(response.headers.get("x-napier-evaluation-suite-failed-count")).toBe(
    String(
      executions.reduce((total, execution) => total + execution.failedCount, 0),
    ),
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-inconclusive-count"),
  ).toBe(
    String(
      executions.reduce(
        (total, execution) => total + execution.inconclusiveCount,
        0,
      ),
    ),
  );
}

function expectEvaluationSuiteExecutionHeaders(
  response: Response,
  execution: EvaluationSuiteExecution,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    execution.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(execution.threadId);
  expect(response.headers.get("x-napier-evaluation-suite-id")).toBe(
    execution.suiteId,
  );
  expect(response.headers.get("x-napier-evaluation-suite-execution-id")).toBe(
    execution.id,
  );
  expect(response.headers.get("x-napier-evaluation-suite-revision")).toBe(
    String(execution.suiteRevision),
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-execution-status"),
  ).toBe(execution.status);
  expect(response.headers.get("x-napier-evaluation-suite-case-count")).toBe(
    String(execution.results.length),
  );
  expect(response.headers.get("x-napier-evaluation-suite-passed-count")).toBe(
    String(execution.passedCount),
  );
  expect(response.headers.get("x-napier-evaluation-suite-failed-count")).toBe(
    String(execution.failedCount),
  );
  expect(
    response.headers.get("x-napier-evaluation-suite-inconclusive-count"),
  ).toBe(String(execution.inconclusiveCount));
  expect(response.headers.get("x-napier-evaluation-suite-pass-rate")).toBe(
    String(execution.passRate),
  );
}

function expectEvaluationSuiteGateReceiptHeaders(
  response: Response,
  receipt: EvaluationSuiteGateReceipt,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="napier-gate-${receipt.suite.id}-r${receipt.suite.revision}-${receipt.contentSha256.slice(0, 12)}.json"`,
  );
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    receipt.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(
    receipt.suite.threadId,
  );
  expect(response.headers.get("x-napier-evaluation-suite-id")).toBe(
    receipt.suite.id,
  );
  expect(response.headers.get("x-napier-evaluation-suite-revision")).toBe(
    String(receipt.suite.revision),
  );
  expect(response.headers.get("x-napier-evaluation-gate-state")).toBe(
    receipt.state,
  );
  expect(response.headers.get("x-napier-evaluation-count")).toBe(
    String(receipt.evaluations.length),
  );
  if (receipt.execution) {
    expect(response.headers.get("x-napier-evaluation-suite-execution-id")).toBe(
      receipt.execution.id,
    );
    expect(
      response.headers.get("x-napier-evaluation-suite-execution-status"),
    ).toBe(receipt.execution.status);
    expect(
      response.headers.get("x-napier-evaluation-suite-execution-sha256"),
    ).toBe(receipt.execution.contentSha256);
  } else {
    expect(response.headers.get("x-napier-evaluation-suite-execution-id")).toBe(
      null,
    );
    expect(
      response.headers.get("x-napier-evaluation-suite-execution-status"),
    ).toBe(null);
    expect(
      response.headers.get("x-napier-evaluation-suite-execution-sha256"),
    ).toBe(null);
  }
}

function expectEvaluationCalibrationHeaders(
  response: Response,
  report: EvaluationCalibrationReport,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    report.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(report.threadId);
  expect(response.headers.get("x-napier-calibration-sample-count")).toBe(
    String(report.sampleCount),
  );
  expect(response.headers.get("x-napier-calibration-agreement-count")).toBe(
    String(report.agreementCount),
  );
  expect(response.headers.get("x-napier-calibration-agreement-rate")).toBe(
    String(report.agreementRate),
  );
  expect(response.headers.get("x-napier-calibration-group-count")).toBe(
    String(report.groups.length),
  );
}

function expectContextCheckpointCalibrationHeaders(
  response: Response,
  report: ContextCheckpointCalibrationReport,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    report.contentSha256,
  );
  expect(response.headers.get("x-napier-thread-id")).toBe(report.threadId);
  expect(response.headers.get("x-napier-event-stream-sha256")).toBe(
    report.eventStreamSha256,
  );
  expect(response.headers.get("x-napier-message-event-count")).toBe(
    String(report.messageEventCount),
  );
  expect(response.headers.get("x-napier-checkpoint-count")).toBe(
    String(report.checkpointCount),
  );
  expect(response.headers.get("x-napier-verified-checkpoint-count")).toBe(
    String(report.verifiedCheckpointCount),
  );
  expect(response.headers.get("x-napier-drifted-checkpoint-count")).toBe(
    String(report.driftedCheckpointCount),
  );
  expect(response.headers.get("x-napier-malformed-checkpoint-count")).toBe(
    String(report.malformedCheckpointCount),
  );
  expect(
    response.headers.get("x-napier-context-compaction-failure-count"),
  ).toBe(String(report.failureCount));
  expect(response.headers.get("x-napier-covered-message-count")).toBe(
    String(report.coveredMessageCount),
  );
  expect(response.headers.get("x-napier-coverage-rate")).toBe(
    String(report.coverageRate),
  );
  expect(response.headers.get("x-napier-compression-ratio")).toBe(
    String(report.compressionRatio),
  );
  expect(response.headers.get("x-napier-fallback-omitted-message-count")).toBe(
    String(report.fallbackOmittedMessageCount),
  );
  expect(response.headers.get("x-napier-latest-checkpoint-id")).toBe(
    report.latestValidCheckpointId ?? null,
  );
  expect(response.headers.get("x-napier-latest-checkpoint-sample-sha256")).toBe(
    report.latestValidCheckpointSampleSha256 ?? null,
  );
}

function expectEventBoundaryHeaders(
  response: Response,
  events: ThreadDetail["events"],
): void {
  if (events.length > 0) {
    expect(response.headers.get("x-napier-first-event-seq")).toBe(
      String(events[0]!.seq),
    );
    expect(response.headers.get("x-napier-last-event-seq")).toBe(
      String(events.at(-1)!.seq),
    );
  } else {
    expect(response.headers.get("x-napier-first-event-seq")).toBe(null);
    expect(response.headers.get("x-napier-last-event-seq")).toBe(null);
  }
}

function expectAutomaticRecoveryProjectionHeaders(
  response: Response,
  recovery: {
    assessments: unknown[];
    attempts: unknown[];
  },
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(recovery))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-recovery-assessment-count")).toBe(
    String(recovery.assessments.length),
  );
  expect(response.headers.get("x-napier-recovery-attempt-count")).toBe(
    String(recovery.attempts.length),
  );
}

function expectAutomationScheduleProjectionHeaders(
  response: Response,
  schedule: AutomationSchedule,
): void {
  const scheduleSha256 = createHash("sha256")
    .update(JSON.stringify(schedule))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(scheduleSha256);
  expect(response.headers.get("x-napier-schedule-sha256")).toBe(scheduleSha256);
  expect(response.headers.get("x-napier-schedule-id")).toBe(schedule.id);
  expect(response.headers.get("x-napier-schedule-status")).toBe(
    schedule.status,
  );
  expect(response.headers.get("x-napier-schedule-revision")).toBe(
    String(schedule.revision),
  );
  expect(response.headers.get("x-napier-schedule-next-run-at")).toBe(
    schedule.nextRunAt,
  );
}

function expectAutomationScheduleListHeaders(
  response: Response,
  schedules: AutomationSchedule[],
): void {
  const scheduleListSha256 = createHash("sha256")
    .update(JSON.stringify(schedules))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    scheduleListSha256,
  );
  expect(response.headers.get("x-napier-schedule-list-sha256")).toBe(
    scheduleListSha256,
  );
  expectAutomationScheduleCountHeaders(response, schedules);
}

function expectAutomationScheduleCountHeaders(
  response: Response,
  schedules: AutomationSchedule[],
): void {
  expect(response.headers.get("x-napier-schedule-count")).toBe(
    String(schedules.length),
  );
  expect(response.headers.get("x-napier-active-schedule-count")).toBe(
    String(schedules.filter((schedule) => schedule.status === "active").length),
  );
  expect(response.headers.get("x-napier-paused-schedule-count")).toBe(
    String(schedules.filter((schedule) => schedule.status === "paused").length),
  );
}

function expectInboundChannelProjectionHeaders(
  response: Response,
  channel: CreatedInboundChannel["channel"],
  options: { includeContentSha256?: boolean } = {},
): void {
  const channelSha256 = createHash("sha256")
    .update(JSON.stringify(channel))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-channel-sha256")).toBe(channelSha256);
  expect(response.headers.get("x-napier-channel-status")).toBe(channel.status);
  expect(response.headers.get("x-napier-channel-revision")).toBe(
    String(channel.revision),
  );
  expect(response.headers.get("x-napier-token-fingerprint")).toBe(
    channel.tokenFingerprint,
  );
  expect(response.headers.get("x-napier-policy-template")).toBe(
    channel.policyTemplate,
  );
  if (options.includeContentSha256) {
    expect(response.headers.get("x-napier-content-sha256")).toBe(channelSha256);
  }
}

function expectInboundChannelListHeaders(
  response: Response,
  channels: CreatedInboundChannel["channel"][],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(channels))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-channel-list-sha256")).toBe(
    contentSha256,
  );
  expectInboundChannelCountHeaders(response, channels);
}

function expectInboundChannelCountHeaders(
  response: Response,
  channels: CreatedInboundChannel["channel"][],
): void {
  expect(response.headers.get("x-napier-channel-count")).toBe(
    String(channels.length),
  );
  expect(response.headers.get("x-napier-active-channel-count")).toBe(
    String(channels.filter((channel) => channel.status === "active").length),
  );
  expect(response.headers.get("x-napier-disabled-channel-count")).toBe(
    String(channels.filter((channel) => channel.status === "disabled").length),
  );
}

function expectInboundDeliveryListHeaders(
  response: Response,
  channelId: string,
  deliveries: InboundDelivery[],
): void {
  const deliveryListSha256 = responseSha256(deliveries);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    deliveryListSha256,
  );
  expect(response.headers.get("x-napier-delivery-list-sha256")).toBe(
    deliveryListSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(channelId);
  expect(response.headers.get("x-napier-delivery-count")).toBe(
    String(deliveries.length),
  );
  expect(response.headers.get("x-napier-delivery-ids-sha256")).toBe(
    responseSha256(deliveries.map((delivery) => delivery.id).sort()),
  );
  for (const status of [
    "accepted",
    "running",
    "retrying",
    "completed",
    "failed",
  ] satisfies InboundDelivery["status"][]) {
    expect(response.headers.get(`x-napier-${status}-delivery-count`)).toBe(
      String(
        deliveries.filter((delivery) => delivery.status === status).length,
      ),
    );
  }
}

function expectInboundDeliveryProjectionHeaders(
  response: Response,
  delivery: InboundDelivery,
  expectedContentSha256: string = responseSha256(delivery),
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    expectedContentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(delivery.channelId);
  expect(response.headers.get("x-napier-thread-id")).toBe(delivery.threadId);
  expect(response.headers.get("x-napier-delivery-id")).toBe(delivery.id);
  expect(response.headers.get("x-napier-trigger-id")).toBe(delivery.triggerId);
  expect(response.headers.get("x-napier-delivery-status")).toBe(
    delivery.status,
  );
  expect(response.headers.get("x-napier-attempt-count")).toBe(
    String(delivery.attemptCount),
  );
  expect(response.headers.get("x-napier-max-attempts")).toBe(
    String(delivery.maxAttempts),
  );
  expect(response.headers.get("x-napier-delivery-revision")).toBe(
    String(delivery.revision),
  );
  expect(response.headers.get("x-napier-idempotency-fingerprint")).toBe(
    delivery.idempotencyFingerprint,
  );
  expect(response.headers.get("x-napier-run-id")).toBe(delivery.runId ?? null);
  expect(response.headers.get("x-napier-next-attempt-at")).toBe(
    delivery.nextAttemptAt ?? null,
  );
  expect(response.headers.get("x-napier-body-sha256")).toBe(
    delivery.bodySha256 ?? null,
  );
  expect(response.headers.get("x-napier-adapter-catalog-sha256")).toBe(
    delivery.adapterCatalogSha256 ?? null,
  );
}

function expectInboundReceiptHeaders(
  response: Response,
  receipt: InboundReceipt,
): void {
  expectInboundDeliveryProjectionHeaders(
    response,
    receipt.delivery,
    responseSha256(receipt),
  );
  expect(response.headers.get("x-napier-duplicate")).toBe(
    String(receipt.duplicate),
  );
}

function expectInboundDeliveryQualificationHeaders(
  response: Response,
  qualification: InboundDeliveryQualification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    qualification.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(
    qualification.channelId,
  );
  expect(response.headers.get("x-napier-delivery-id")).toBe(
    qualification.deliveryId,
  );
  expect(response.headers.get("x-napier-qualification-status")).toBe(
    qualification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(qualification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-current-adapter-catalog-sha256")).toBe(
    qualification.currentAdapterCatalogSha256,
  );
  expect(response.headers.get("x-napier-body-sha256")).toBe(
    qualification.bodySha256 ?? null,
  );
  expect(response.headers.get("x-napier-adapter-catalog-sha256")).toBe(
    qualification.adapterCatalogSha256 ?? null,
  );
}

function expectInboundDeadLetterExportHeaders(
  response: Response,
  artifact: InboundDeadLetterExport,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toMatch(
    /^attachment; filename="napier-dead-letters-/,
  );
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    artifact.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(artifact.channel.id);
  expect(response.headers.get("x-napier-thread-id")).toBe(
    artifact.channel.threadId,
  );
  expect(response.headers.get("x-napier-channel-status")).toBe(
    artifact.channel.status,
  );
  expect(response.headers.get("x-napier-channel-revision")).toBe(
    String(artifact.channel.revision),
  );
  expect(response.headers.get("x-napier-delivery-count")).toBe(
    String(artifact.deliveryCount),
  );
  expect(response.headers.get("x-napier-delivery-ids-sha256")).toBe(
    responseSha256(
      artifact.deliveries.map((delivery) => delivery.deliveryId).sort(),
    ),
  );
  expect(response.headers.get("x-napier-manual-retry-available-count")).toBe(
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "manual_retry_available",
      ).length,
    ),
  );
  expect(response.headers.get("x-napier-retry-exhausted-count")).toBe(
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "retry_exhausted",
      ).length,
    ),
  );
  expect(response.headers.get("x-napier-current-adapter-catalog-sha256")).toBe(
    artifact.currentAdapterCatalogSha256 ?? null,
  );
  expect(response.headers.get("x-napier-qualified-count")).toBe(
    artifact.qualifiedCount === undefined
      ? null
      : String(artifact.qualifiedCount),
  );
  expect(response.headers.get("x-napier-evidence-missing-count")).toBe(
    artifact.evidenceMissingCount === undefined
      ? null
      : String(artifact.evidenceMissingCount),
  );
  expect(response.headers.get("x-napier-adapter-catalog-drift-count")).toBe(
    artifact.adapterCatalogDriftCount === undefined
      ? null
      : String(artifact.adapterCatalogDriftCount),
  );
}

function expectInboundDeadLetterExportVerificationHeaders(
  response: Response,
  verification: InboundDeadLetterExportVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(
    verification.channelId ?? null,
  );
  expect(response.headers.get("x-napier-expected-channel-id")).toBe(
    verification.expectedChannelId ?? null,
  );
  expect(response.headers.get("x-napier-declared-content-sha256")).toBe(
    verification.declaredContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-recomputed-content-sha256")).toBe(
    verification.recomputedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-delivery-count")).toBe(
    verification.observedDeliveryCount === undefined
      ? null
      : String(verification.observedDeliveryCount),
  );
  expect(response.headers.get("x-napier-observed-qualified-count")).toBe(
    verification.observedQualifiedCount === undefined
      ? null
      : String(verification.observedQualifiedCount),
  );
  expect(response.headers.get("x-napier-observed-evidence-missing-count")).toBe(
    verification.observedEvidenceMissingCount === undefined
      ? null
      : String(verification.observedEvidenceMissingCount),
  );
  expect(
    response.headers.get("x-napier-observed-adapter-catalog-drift-count"),
  ).toBe(
    verification.observedAdapterCatalogDriftCount === undefined
      ? null
      : String(verification.observedAdapterCatalogDriftCount),
  );
}

function expectInboundDeadLetterRetryPreviewHeaders(
  response: Response,
  preview: InboundDeadLetterRetryPreview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    preview.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(preview.channelId);
  expect(response.headers.get("x-napier-verification-status")).toBe(
    preview.verificationStatus,
  );
  expect(response.headers.get("x-napier-artifact-sha256")).toBe(
    preview.artifactSha256 ?? null,
  );
  expect(response.headers.get("x-napier-retryable-count")).toBe(
    String(preview.retryableCount),
  );
  expect(response.headers.get("x-napier-blocked-count")).toBe(
    String(preview.blockedCount),
  );
  expect(response.headers.get("x-napier-candidate-count")).toBe(
    String(preview.candidates.length),
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(preview.diagnostics.length),
  );
  expect(response.headers.get("x-napier-candidate-set-sha256")).toBe(
    preview.candidateSetSha256,
  );
  expect(response.headers.get("x-napier-retryable-delivery-ids-sha256")).toBe(
    preview.retryableDeliveryIdsSha256,
  );
  expect(response.headers.get("x-napier-blocked-delivery-ids-sha256")).toBe(
    preview.blockedDeliveryIdsSha256,
  );
}

function expectInboundDeadLetterRetryApplyResultHeaders(
  response: Response,
  result: InboundDeadLetterRetryApplyResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    result.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(result.channelId);
  expect(response.headers.get("x-napier-preview-sha256")).toBe(
    result.previewSha256,
  );
  expect(response.headers.get("x-napier-artifact-sha256")).toBe(
    result.artifactSha256 ?? null,
  );
  expect(response.headers.get("x-napier-retried-count")).toBe(
    String(result.retriedCount),
  );
  expect(response.headers.get("x-napier-skipped-count")).toBe(
    String(result.skippedCount),
  );
  expect(response.headers.get("x-napier-retried-delivery-count")).toBe(
    String(result.deliveries.length),
  );
  expect(response.headers.get("x-napier-skipped-delivery-count")).toBe(
    String(result.skipped.length),
  );
  expect(response.headers.get("x-napier-preview-candidate-set-sha256")).toBe(
    result.previewCandidateSetSha256,
  );
  expect(
    response.headers.get("x-napier-preview-retryable-delivery-ids-sha256"),
  ).toBe(result.previewRetryableDeliveryIdsSha256);
  expect(
    response.headers.get("x-napier-preview-blocked-delivery-ids-sha256"),
  ).toBe(result.previewBlockedDeliveryIdsSha256);
  expect(response.headers.get("x-napier-retried-delivery-ids-sha256")).toBe(
    result.retriedDeliveryIdsSha256,
  );
  expect(response.headers.get("x-napier-skipped-delivery-ids-sha256")).toBe(
    result.skippedDeliveryIdsSha256,
  );
}

function expectInboundDeadLetterRetryHistoryHeaders(
  response: Response,
  history: InboundDeadLetterRetryHistory,
  threadId: string,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toMatch(
    /^attachment; filename="napier-dead-letter-retry-history-/,
  );
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    history.contentSha256,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(history.channelId);
  expect(response.headers.get("x-napier-thread-id")).toBe(threadId);
  expect(response.headers.get("x-napier-event-set-sha256")).toBe(
    history.eventSetSha256,
  );
  expect(response.headers.get("x-napier-event-count")).toBe(
    String(history.eventCount),
  );
  expect(response.headers.get("x-napier-first-event-seq")).toBe(
    history.fromSeq === undefined ? null : String(history.fromSeq),
  );
  expect(response.headers.get("x-napier-last-event-seq")).toBe(
    history.toSeq === undefined ? null : String(history.toSeq),
  );
}

function expectInboundDeadLetterRetryHistoryVerificationHeaders(
  response: Response,
  verification: InboundDeadLetterRetryHistoryVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-channel-id")).toBe(
    verification.channelId ?? null,
  );
  expect(response.headers.get("x-napier-expected-channel-id")).toBe(
    verification.expectedChannelId ?? null,
  );
  expect(response.headers.get("x-napier-observed-content-sha256")).toBe(
    verification.observedContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-event-set-sha256")).toBe(
    verification.observedEventSetSha256 ?? null,
  );
  expect(response.headers.get("x-napier-observed-event-count")).toBe(
    verification.observedEventCount === undefined
      ? null
      : String(verification.observedEventCount),
  );
  expect(response.headers.get("x-napier-observed-first-event-seq")).toBe(
    verification.observedFromSeq === undefined
      ? null
      : String(verification.observedFromSeq),
  );
  expect(response.headers.get("x-napier-observed-last-event-seq")).toBe(
    verification.observedToSeq === undefined
      ? null
      : String(verification.observedToSeq),
  );
}

function parseSseFrames(source: string): StreamFrame[] {
  return source.split(/\r?\n\r?\n/).flatMap((record): StreamFrame[] => {
    const data = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data ? [JSON.parse(data) as StreamFrame] : [];
  });
}

function expectFinalDoneMatchesSnapshot(
  frames: StreamFrame[],
): Extract<StreamFrame, { type: "done" }> {
  const done = frames.at(-1);
  expect(done?.type).toBe("done");
  if (!done || done.type !== "done") {
    throw new Error("Expected final done frame");
  }
  const snapshots = frames.filter(
    (frame): frame is Extract<StreamFrame, { type: "snapshot" }> =>
      frame.type === "snapshot",
  );
  const snapshot = snapshots.at(-1);
  expect(snapshot).toBeDefined();
  if (!snapshot) {
    throw new Error("Expected final snapshot frame");
  }
  expect(snapshot.detail.runs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: done.runId,
        status: done.status,
      }),
    ]),
  );
  expect(done.threadId).toBe(snapshot.detail.thread.id);
  expect(done.snapshotSha256).toBe(snapshot.detailSha256);
  expect(done.eventCount).toBe(snapshot.detail.thread.eventCount);
  expect(done.eventStreamSha256).toBe(
    textSha256(
      snapshot.detail.events.map((event) => JSON.stringify(event)).join("\n"),
    ),
  );
  const snapshotEventsBySeq = new Map(
    snapshot.detail.events.map((event) => [event.seq, event]),
  );
  const streamedEvents = frames.filter(
    (frame): frame is Extract<StreamFrame, { type: "event" }> =>
      frame.type === "event",
  );
  for (const frame of streamedEvents) {
    expect(snapshotEventsBySeq.get(frame.event.seq)).toEqual(frame.event);
  }
  return done;
}

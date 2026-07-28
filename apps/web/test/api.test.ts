import { createHash } from "node:crypto";

import type {
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
  HealthResponse,
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
  OperatorDecision,
  RunControlMessage,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  ThreadReplayBundle,
  ThreadReplayBundleVerification,
  TrustedReceiptEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerOperatorDecision,
  cancelOperatorDecision,
  createExecutionPlanFromBlueprint,
  createExecutionPlanFromBlueprintRecord,
  createExecutionPlanFromBlueprintRecordWithReplayEvent,
  getExecutionPlanArchive,
  getExecutionPlanBlueprint,
  getExecutionPlanBlueprintPortfolioCalibration,
  getExecutionPlanBlueprintRecommendationPolicyBacktest,
  getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  getExecutionPlanBlueprintRecommendationPolicyOverrides,
  getExecutionPlanBlueprintRecordQualification,
  getExecutionPlanBlueprintRecordOutcomeBaselines,
  getExecutionPlanBlueprintRecordOutcomeQualification,
  getExecutionPlanBlueprintRecordReplayOutcomes,
  getExecutionPlanBlueprintRecordReplays,
  getExecutionPlanBlueprintRecords,
  getHealth,
  queueRunControlMessage,
  cancelRunControlMessage,
  previewExecutionPlanFromBlueprintRecord,
  promoteExecutionPlanBlueprintRecordOutcomeBaseline,
  retireExecutionPlanBlueprintRecommendationPolicyOverride,
  reviewExecutionPlanBlueprintRecordOutcomes,
  saveExecutionPlanBlueprint,
  selectExecutionPlanBlueprintRecord,
  setExecutionPlanBlueprintRecommendationPolicyOverride,
  setExecutionPlanBlueprintRecordStatus,
  signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  verifyExecutionPlanBlueprintRecordReplayEvent,
  verifyExecutionPlanBlueprintRecordReplayOutcomes,
  verifyExecutionPlanBlueprintRecordReplays,
  verifyOpenTelemetryTraceArtifact,
  verifyRunReplaySnapshot,
  verifyThreadReplayBundle,
} from "../src/api";

describe("Web JSON API wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the typed health readiness projection", async () => {
    const health: HealthResponse = {
      status: "ok",
      service: "napier",
      time: "2026-07-26T00:00:00.000Z",
      runtime: {
        node: {
          version: "24.16.0",
          platform: "darwin",
          arch: "arm64",
        },
        components: {
          sqlite: "3.53.0",
          openssl: "3.5.6",
          uv: "1.52.1",
          v8: "13.6.233.17-node.49",
        },
      },
      ledger: {
        schemaVersion: 2,
        quickCheck: "ok",
        migrations: [
          {
            version: 2,
            name: "schema_migration_history",
            appliedAt: "2026-07-26T00:00:00.000Z",
          },
        ],
      },
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/health");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const text = JSON.stringify(health);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queues and cancels hash-bound Run control messages", async () => {
    const queued: RunControlMessage = {
      kind: "napier.run-control-message",
      schemaVersion: 1,
      id: "control_message1234",
      threadId: "thread_1",
      runId: "run_1",
      mode: "steering",
      status: "queued",
      textSha256: "a".repeat(64),
      textBytes: 18,
      queuedAt: "2026-07-28T00:00:00.000Z",
      queuedEventSeq: 4,
      contentSha256: "b".repeat(64),
    };
    const cancelled: RunControlMessage = {
      ...queued,
      status: "cancelled",
      cancelledAt: "2026-07-28T00:00:01.000Z",
      cancellationEventSeq: 5,
      cancellationReason: "operator_cancelled",
      contentSha256: "c".repeat(64),
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (path: string, init?: RequestInit) => {
        expect(path).toBe("/api/threads/thread_1/runs/run_1/control-messages");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            mode: "steering",
            text: "Use narrower scope.",
          }),
        );
        const text = JSON.stringify(queued);
        return new Response(text, {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "X-Napier-Content-SHA256": sha256Text(text),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        });
      })
      .mockImplementationOnce(async (path: string, init?: RequestInit) => {
        expect(path).toBe(
          "/api/threads/thread_1/runs/run_1/control-messages/control_message1234/cancel",
        );
        expect(init?.method).toBe("POST");
        const text = JSON.stringify(cancelled);
        return new Response(text, {
          headers: {
            "Content-Type": "application/json",
            "X-Napier-Content-SHA256": sha256Text(text),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      queueRunControlMessage("thread_1", "run_1", {
        mode: "steering",
        text: "Use narrower scope.",
      }),
    ).resolves.toEqual(queued);
    await expect(
      cancelRunControlMessage("thread_1", "run_1", "control_message1234"),
    ).resolves.toEqual(cancelled);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers and cancels durable operator decisions", async () => {
    const pending: OperatorDecision = {
      kind: "napier.operator-decision",
      schemaVersion: 1,
      id: "decision_message1234",
      threadId: "thread_1",
      runId: "run_1",
      status: "pending",
      header: "Scope",
      question: "Which scope should continue?",
      options: [
        {
          id: "option_1",
          label: "Runtime",
          description: "Continue with runtime only.",
        },
        {
          id: "option_2",
          label: "Full product",
          description: "Continue through the Workbench.",
        },
      ],
      multiSelect: false,
      questionSha256: "a".repeat(64),
      requestedAt: "2026-07-28T00:00:00.000Z",
      requestedEventSeq: 4,
      contentSha256: "b".repeat(64),
    };
    const answered: OperatorDecision = {
      ...pending,
      status: "answered",
      answeredAt: "2026-07-28T00:00:01.000Z",
      answeredEventSeq: 5,
      selectedOptionIds: ["option_2"],
      customText: "Preserve compatibility.",
      answerSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
    };
    const cancelled: OperatorDecision = {
      ...answered,
      status: "cancelled",
      cancelledAt: "2026-07-28T00:00:02.000Z",
      cancellationEventSeq: 6,
      cancellationReason: "operator_cancelled",
      contentSha256: "e".repeat(64),
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (path: string, init?: RequestInit) => {
        expect(path).toBe(
          "/api/threads/thread_1/operator-decisions/decision_message1234/answer",
        );
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            selectedOptionIds: ["option_2"],
            customText: "Preserve compatibility.",
          }),
        );
        const text = JSON.stringify(answered);
        return new Response(text, {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "X-Napier-Content-SHA256": sha256Text(text),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        });
      })
      .mockImplementationOnce(async (path: string, init?: RequestInit) => {
        expect(path).toBe(
          "/api/threads/thread_1/operator-decisions/decision_message1234/cancel",
        );
        expect(init?.method).toBe("POST");
        const text = JSON.stringify(cancelled);
        return new Response(text, {
          headers: {
            "Content-Type": "application/json",
            "X-Napier-Content-SHA256": sha256Text(text),
            "X-Napier-Content-SHA256-Mode": "body",
          },
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      answerOperatorDecision("thread_1", pending.id, {
        selectedOptionIds: ["option_2"],
        customText: "Preserve compatibility.",
      }),
    ).resolves.toEqual(answered);
    await expect(
      cancelOperatorDecision("thread_1", pending.id),
    ).resolves.toEqual(cancelled);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("verifies thread replay bundles through the no-store import preflight", async () => {
    const bundle = {
      kind: "napier.thread-replay",
      contentSha256: "a".repeat(64),
    } as ThreadReplayBundle;
    const verification: ThreadReplayBundleVerification = {
      status: "valid",
      diagnostics: [],
      threadId: "thread_1",
      agentId: "agent_napier",
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
      eventCount: 2,
      runCount: 1,
      planCount: 0,
      evaluationCount: 0,
      modelContextEnvelopeCount: 1,
      embeddedModelContextEnvelopeCount: 1,
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/import/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ bundle }));
      const text = JSON.stringify(verification);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyThreadReplayBundle({ bundle })).resolves.toEqual(
      verification,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies Run replay snapshots through the path-bound preflight", async () => {
    const snapshot = {
      schemaVersion: 1,
      threadId: "thread_1",
      run: { id: "run_1" },
      events: [],
      subagents: [],
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
    } as unknown as RunReplaySnapshot;
    const verification: RunReplaySnapshotVerification = {
      status: "valid",
      diagnostics: [],
      threadId: "thread_1",
      runId: "run_1",
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
      assistantTextSha256: "c".repeat(64),
      eventCount: 0,
      subagentCount: 0,
      modelContextEnvelopeCount: 0,
      embeddedModelContextEnvelopeCount: 0,
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/runs/run_1/replay/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ snapshot }));
      const text = JSON.stringify(verification);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyRunReplaySnapshot("thread_1", "run_1", { snapshot }),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies OpenTelemetry trace artifacts through the thread-bound preflight", async () => {
    const artifact = {
      kind: "napier.opentelemetry-trace",
      threadId: "thread_1",
      traceId: "c".repeat(32),
      contentSha256: "a".repeat(64),
      eventRange: { eventStreamSha256: "b".repeat(64), eventCount: 2 },
      spanCount: 4,
    } as unknown as OpenTelemetryTraceArtifact;
    const verification: OpenTelemetryTraceArtifactVerification = {
      status: "valid",
      diagnostics: [],
      threadId: "thread_1",
      traceId: "c".repeat(32),
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
      spanCount: 4,
      eventCount: 2,
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/trace/otlp/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ artifact }));
      const text = JSON.stringify(verification);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyOpenTelemetryTraceArtifact("thread_1", { artifact }),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies execution plan archives through the plan-bound preflight", async () => {
    const archive = {
      kind: "napier.execution-plan-archive",
      threadId: "thread_1",
      plan: { id: "plan_1", revision: 3 },
      events: [],
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
    } as unknown as ExecutionPlanArchive;
    const verification: ExecutionPlanArchiveVerification = {
      status: "valid",
      diagnostics: [],
      threadId: "thread_1",
      planId: "plan_1",
      revision: 3,
      contentSha256: "a".repeat(64),
      eventStreamSha256: "b".repeat(64),
      eventCount: 0,
      stepCount: 1,
      artifactCount: 0,
      replanCount: 0,
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/plans/plan_1/archive/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ archive }));
      const text = JSON.stringify(verification);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyExecutionPlanArchive("thread_1", "plan_1", { archive }),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exports execution plan archives through the typed wrapper", async () => {
    const archiveContent = {
      kind: "napier.execution-plan-archive",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      threadId: "thread_1",
      plan: { id: "plan_1", revision: 3 },
      events: [],
      eventStreamSha256: "b".repeat(64),
    };
    const archive = {
      ...archiveContent,
      generatedAt: "2026-07-26T00:00:00.000Z",
      contentSha256: sha256Canonical(archiveContent),
    } as unknown as ExecutionPlanArchive;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/plans/plan_1/archive");
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const text = JSON.stringify(archive);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": archive.contentSha256,
          "X-Napier-Content-SHA256-Mode": "stable",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getExecutionPlanArchive("thread_1", "plan_1"),
    ).resolves.toEqual(archive);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exports execution plan blueprints through the typed wrapper", async () => {
    const blueprint = planBlueprintFixture();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/plans/plan_1/blueprint");
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const text = JSON.stringify(blueprint);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": blueprint.contentSha256,
          "X-Napier-Content-SHA256-Mode": "stable",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getExecutionPlanBlueprint("thread_1", "plan_1"),
    ).resolves.toEqual(blueprint);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies execution plan blueprints through the thread preflight", async () => {
    const blueprint = planBlueprintFixture();
    const verification: ExecutionPlanBlueprintVerification = {
      status: "valid",
      diagnostics: [],
      contentSha256: blueprint.contentSha256,
      sourceThreadId: "thread_1",
      sourcePlanId: "plan_1",
      sourcePlanRevision: 3,
      sourcePlanArchiveSha256: "a".repeat(64),
      sourceEventStreamSha256: "b".repeat(64),
      stepCount: 1,
      artifactCount: 0,
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_1/plans/blueprints/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ blueprint }));
      const text = JSON.stringify(verification);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyExecutionPlanBlueprint("thread_1", { blueprint }),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates execution plans from verified blueprints", async () => {
    const blueprint = planBlueprintFixture();
    const createdPlan = {
      id: "plan_created",
      threadId: "thread_2",
      objective: blueprint.objective,
      status: "active",
      steps: [],
      artifacts: [],
      replans: [],
      replanRecommendation: null,
      criticalPathStepIds: [],
      readyStepIds: [],
      blockedStepIds: [],
      phaseWaves: [],
      activePhaseIndex: null,
      parallelReadyStepIds: [],
      phaseProjectionSha256: "f".repeat(64),
      revision: 1,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    } as ExecutionPlan;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/threads/thread_2/plans/from-blueprint");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ blueprint }));
      const text = JSON.stringify(createdPlan);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createExecutionPlanFromBlueprint("thread_2", { blueprint }),
    ).resolves.toEqual(createdPlan);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses typed wrappers for the execution plan blueprint library", async () => {
    const blueprint = planBlueprintFixture();
    const record = planBlueprintRecordFixture(blueprint);
    const createdPlan = {
      id: "plan_from_record",
      threadId: "thread_2",
      objective: blueprint.objective,
      status: "active",
      steps: [],
      artifacts: [],
      replans: [],
      replanRecommendation: null,
      criticalPathStepIds: [],
      readyStepIds: [],
      blockedStepIds: [],
      phaseWaves: [],
      activePhaseIndex: null,
      parallelReadyStepIds: [],
      phaseProjectionSha256: "f".repeat(64),
      revision: 1,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    } as ExecutionPlan;
    const saveResult = { record, created: true };
    const qualification: ExecutionPlanBlueprintRecordQualification = {
      status: "qualified",
      diagnostics: [],
      recordId: record.id,
      recordStatus: record.status,
      blueprintSha256: record.blueprintSha256,
      sourceThreadId: record.sourceThreadId,
      sourcePlanId: record.sourcePlanId,
      sourcePlanRevision: record.sourcePlanRevision,
      expectedPlanArchiveSha256: record.sourcePlanArchiveSha256,
      expectedEventStreamSha256: record.sourceEventStreamSha256,
      actualSourcePlanRevision: record.sourcePlanRevision,
      actualPlanArchiveSha256: record.sourcePlanArchiveSha256,
      actualEventStreamSha256: record.sourceEventStreamSha256,
      stepCount: record.blueprint.stepCount,
      artifactCount: record.blueprint.artifactCount,
      qualifiedAt: "2026-07-26T00:00:00.000Z",
    };
    const preview: ExecutionPlanBlueprintRecordPreview = {
      status: "ready",
      diagnostics: [],
      threadId: "thread_2",
      recordId: record.id,
      qualification,
      hasOpenPlan: false,
      plan: createdPlan,
      previewSha256: "d".repeat(64),
    };
    const replayHistory: ExecutionPlanBlueprintRecordReplayHistory = {
      kind: "napier.execution-plan-blueprint-replay-history",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      generatedAt: "2026-07-26T00:00:00.000Z",
      recordId: record.id,
      replayCount: 1,
      threadCount: 1,
      planCount: 1,
      eventSetSha256: "e".repeat(64),
      firstSeq: 1,
      lastSeq: 1,
      replays: [
        {
          eventId: "event_12345678",
          threadId: "thread_2",
          runId: "runctl_12345678",
          seq: 1,
          createdAt: "2026-07-26T00:00:01.000Z",
          recordId: record.id,
          planId: createdPlan.id,
          objectiveSha256: "f".repeat(64),
          status: "active",
          stepCount: createdPlan.steps.length,
          artifactCount: createdPlan.artifacts.length,
          blueprintSha256: record.blueprintSha256,
          sourcePlanId: record.sourcePlanId,
          sourcePlanRevision: record.sourcePlanRevision,
          sourcePlanArchiveSha256: record.sourcePlanArchiveSha256,
          qualificationStatus: "qualified",
          qualificationSha256: "1".repeat(64),
          qualificationDiagnosticsSha256: "2".repeat(64),
          previewSha256: preview.previewSha256,
        },
      ],
      contentSha256: "3".repeat(64),
    };
    const replayHistoryVerification: ExecutionPlanBlueprintRecordReplayHistoryVerification =
      {
        schemaVersion: 1,
        status: "valid",
        diagnostics: [],
        recordId: record.id,
        expectedRecordId: record.id,
        declaredContentSha256: replayHistory.contentSha256,
        recomputedContentSha256: replayHistory.contentSha256,
        observedContentSha256: replayHistory.contentSha256,
        declaredEventSetSha256: replayHistory.eventSetSha256,
        observedEventSetSha256: replayHistory.eventSetSha256,
        replayCount: replayHistory.replayCount,
        observedReplayCount: replayHistory.replayCount,
        threadCount: replayHistory.threadCount,
        observedThreadCount: replayHistory.threadCount,
        planCount: replayHistory.planCount,
        observedPlanCount: replayHistory.planCount,
        ...(replayHistory.firstSeq !== undefined
          ? { firstSeq: replayHistory.firstSeq }
          : {}),
        ...(replayHistory.firstSeq !== undefined
          ? { observedFirstSeq: replayHistory.firstSeq }
          : {}),
        ...(replayHistory.lastSeq !== undefined
          ? { lastSeq: replayHistory.lastSeq }
          : {}),
        ...(replayHistory.lastSeq !== undefined
          ? { observedLastSeq: replayHistory.lastSeq }
          : {}),
        contentSha256: "4".repeat(64),
      };
    const replayOutcomes: ExecutionPlanBlueprintRecordReplayOutcomes = {
      kind: "napier.execution-plan-blueprint-replay-outcomes",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      generatedAt: "2026-07-26T00:00:02.000Z",
      recordId: record.id,
      replayHistorySha256: replayHistory.contentSha256,
      replayCount: 1,
      activeCount: 1,
      completedCount: 0,
      blockedCount: 0,
      cancelledCount: 0,
      invalidCount: 0,
      completionRateBps: 0,
      outcomeSetSha256: "7".repeat(64),
      outcomes: [
        {
          replayEventId: replayHistory.replays[0]!.eventId,
          replayEventSeq: replayHistory.replays[0]!.seq,
          threadId: replayHistory.replays[0]!.threadId,
          planId: createdPlan.id,
          createdAt: replayHistory.replays[0]!.createdAt,
          status: "active",
          planRevision: createdPlan.revision,
          stepCount: 0,
          completedStepCount: 0,
          skippedStepCount: 0,
          blockedStepCount: 0,
          artifactCount: 0,
          verifiedArtifactCount: 0,
          missingArtifactCount: 0,
          replanCount: 0,
          planProjectionSha256: "8".repeat(64),
          outcomeSha256: "9".repeat(64),
        },
      ],
      contentSha256: "a".repeat(64),
    };
    const replayOutcomesVerification: ExecutionPlanBlueprintRecordReplayOutcomesVerification =
      {
        schemaVersion: 1,
        status: "valid",
        diagnostics: [],
        recordId: record.id,
        expectedRecordId: record.id,
        declaredContentSha256: replayOutcomes.contentSha256,
        recomputedContentSha256: replayOutcomes.contentSha256,
        observedContentSha256: replayOutcomes.contentSha256,
        declaredReplayHistorySha256: replayOutcomes.replayHistorySha256,
        observedReplayHistorySha256: replayOutcomes.replayHistorySha256,
        declaredOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        observedOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: 1,
        observedReplayCount: 1,
        completedCount: 0,
        observedCompletedCount: 0,
        blockedCount: 0,
        observedBlockedCount: 0,
        invalidCount: 0,
        observedInvalidCount: 0,
        contentSha256: "b".repeat(64),
      };
    const outcomeBaseline: ExecutionPlanBlueprintRecordOutcomeBaseline = {
      id: "outcome_base_1234567890abcdef1234",
      recordId: record.id,
      replayOutcomesSha256: replayOutcomes.contentSha256,
      replayHistorySha256: replayOutcomes.replayHistorySha256,
      outcomeSetSha256: replayOutcomes.outcomeSetSha256,
      replayCount: replayOutcomes.replayCount,
      completedCount: replayOutcomes.completedCount,
      blockedCount: replayOutcomes.blockedCount,
      invalidCount: replayOutcomes.invalidCount,
      completionRateBps: replayOutcomes.completionRateBps,
      policy: {
        minReplayCount: 1,
        minCompletionRateBps: 0,
        maxBlockedCount: 0,
        maxInvalidCount: 0,
      },
      promotedAt: "2026-07-26T00:00:03.000Z",
      contentSha256: "c".repeat(64),
    };
    const outcomeBaselineResult: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult =
      {
        baseline: outcomeBaseline,
        created: true,
      };
    const outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification =
      {
        schemaVersion: 1,
        status: "qualified",
        diagnostics: [],
        recordId: record.id,
        baselineId: outcomeBaseline.id,
        baselineSha256: outcomeBaseline.contentSha256,
        baselineOutcomesSha256: outcomeBaseline.replayOutcomesSha256,
        currentOutcomesSha256: replayOutcomes.contentSha256,
        currentReplayHistorySha256: replayOutcomes.replayHistorySha256,
        currentOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
        replayCount: replayOutcomes.replayCount,
        completedCount: replayOutcomes.completedCount,
        blockedCount: replayOutcomes.blockedCount,
        invalidCount: replayOutcomes.invalidCount,
        completionRateBps: replayOutcomes.completionRateBps,
        policy: outcomeBaseline.policy,
        contentSha256: "d".repeat(64),
      };
    const outcomeReview: ExecutionPlanBlueprintRecordOutcomeReview = {
      kind: "napier.execution-plan-blueprint-outcome-review",
      schemaVersion: 1,
      policyId: "napier.blueprint-outcome-review.v1",
      recordId: record.id,
      blueprintSha256: record.blueprintSha256,
      model: { provider: "napier", id: "demo" },
      criteria: {
        name: "Reusable workflow delivery",
        criteria: [
          {
            id: "completion",
            name: "Completion",
            description: "The workflow completes.",
          },
          {
            id: "auditability",
            name: "Auditability",
            description: "The workflow is hash-bound.",
          },
        ],
      },
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason: "The deterministic demo model cannot score outcomes.",
      concerns: ["live_model_required"],
      scores: [],
      sourceQualificationStatus: "qualified",
      outcomeQualificationStatus: "qualified",
      replayOutcomesSha256: replayOutcomes.contentSha256,
      replayHistorySha256: replayOutcomes.replayHistorySha256,
      outcomeSetSha256: replayOutcomes.outcomeSetSha256,
      replayCount: replayOutcomes.replayCount,
      completedCount: replayOutcomes.completedCount,
      blockedCount: replayOutcomes.blockedCount,
      invalidCount: replayOutcomes.invalidCount,
      completionRateBps: replayOutcomes.completionRateBps,
      baselineId: outcomeBaseline.id,
      baselineSha256: outcomeBaseline.contentSha256,
      baselineOutcomesSha256: outcomeBaseline.replayOutcomesSha256,
      inputSha256: "2".repeat(64),
      promptSha256: "3".repeat(64),
      responseSha256: "4".repeat(64),
      reviewSchemaSha256: "5".repeat(64),
      modelContextEnvelope: {
        kind: "napier.model-context-envelope" as const,
        schemaVersion: 1 as const,
        turnIndex: 0,
        systemPromptSha256: "1".repeat(64),
        systemPromptBytes: 120,
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        toolResultMessageCount: 0,
        otherMessageCount: 0,
        messageSetSha256: "2".repeat(64),
        toolCount: 0,
        toolNameSetSha256: "3".repeat(64),
        toolDefinitionSetSha256: "4".repeat(64),
        contentSha256: "5".repeat(64),
      },
      reviewSha256: "6".repeat(64),
      createdAt: "2026-07-26T00:00:04.000Z",
    };
    const reviewedOutcomeBaseline: ExecutionPlanBlueprintRecordOutcomeBaseline =
      {
        ...outcomeBaseline,
        id: "outcome_base_reviewed123456789",
        reviewGate: {
          minScore: 80,
          maxRisk: "medium",
        },
        reviewSha256: outcomeReview.reviewSha256,
        reviewInputSha256: outcomeReview.inputSha256,
        reviewResponseSha256: outcomeReview.responseSha256,
        reviewVerdict: outcomeReview.verdict,
        reviewScore: outcomeReview.score,
        reviewRisk: outcomeReview.risk,
        reviewModel: outcomeReview.model,
        supersedesBaselineId: outcomeBaseline.id,
        contentSha256: "e".repeat(64),
      };
    const reviewedOutcomeBaselineResult: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult =
      {
        baseline: reviewedOutcomeBaseline,
        created: true,
      };
    const selection: ExecutionPlanBlueprintRecordSelection = {
      kind: "napier.execution-plan-blueprint-selection",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-26T00:00:04.000Z",
      threadId: "thread_2",
      candidateCount: 1,
      qualifiedCandidateCount: 1,
      rejectedCandidateCount: 0,
      selectedRecordId: record.id,
      selectedPreviewSha256: "e".repeat(64),
      selectedBaselineId: outcomeBaseline.id,
      selectedBaselineSha256: outcomeBaseline.contentSha256,
      selectedScoreBps: 0,
      selectedFamilySha256: "3".repeat(64),
      selectedFamilyCompletionRateBps: 0,
      selectedRecommendationScoreBps: 1_600,
      selectedRecommendationPolicyTemplate: "balanced",
      selectedRecommendationPolicySha256: "7".repeat(64),
      selectedRecommendationPolicySource: "default",
      recommendationPolicy: {
        templateId: "balanced",
        weights: {
          outcomeCompletionBps: 5_000,
          familyCompletionBps: 2_500,
          reviewedBaselineBps: 1_500,
          replayEvidenceBps: 1_000,
        },
      },
      recommendationPolicySha256: "7".repeat(64),
      familyPolicyOverrideCount: 0,
      familyPolicyOverrideSetSha256: "8".repeat(64),
      portfolioSetSha256: "2".repeat(64),
      selectionSetSha256: "f".repeat(64),
      candidates: [
        {
          recordId: record.id,
          recordStatus: "active",
          recordUpdatedAt: record.updatedAt,
          selectionStatus: "selected",
          diagnostics: [],
          blueprintSha256: record.blueprintSha256,
          familySha256: "3".repeat(64),
          sourceQualificationStatus: "qualified",
          outcomeQualificationStatus: "qualified",
          familyRecordCount: 1,
          familyOutcomeQualifiedCount: 1,
          familyReviewedBaselineCount: 1,
          familyCompletionRateBps: 0,
          recommendationScoreBps: 1_600,
          recommendationPolicyTemplate: "balanced",
          recommendationPolicySha256: "7".repeat(64),
          recommendationPolicySource: "default",
          previewStatus: "ready",
          previewSha256: "e".repeat(64),
          baselineId: outcomeBaseline.id,
          baselineSha256: outcomeBaseline.contentSha256,
          baselineOutcomesSha256: outcomeBaseline.replayOutcomesSha256,
          baselinePromotedAt: outcomeBaseline.promotedAt,
          currentOutcomesSha256: replayOutcomes.contentSha256,
          currentReplayHistorySha256: replayOutcomes.replayHistorySha256,
          currentOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
          scoreBps: 0,
          replayCount: replayOutcomes.replayCount,
          completedCount: replayOutcomes.completedCount,
          blockedCount: replayOutcomes.blockedCount,
          invalidCount: replayOutcomes.invalidCount,
          completionRateBps: replayOutcomes.completionRateBps,
          stepCount: record.blueprint.stepCount,
          artifactCount: record.blueprint.artifactCount,
        },
      ],
      contentSha256: "1".repeat(64),
    };
    const portfolioCalibration: ExecutionPlanBlueprintPortfolioCalibration = {
      kind: "napier.execution-plan-blueprint-portfolio-calibration",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-26T00:00:05.000Z",
      recordCount: 1,
      activeCount: 1,
      archivedCount: 0,
      familyCount: 1,
      sourceQualifiedCount: 1,
      outcomeQualifiedCount: 1,
      reviewedBaselineCount: 1,
      missingBaselineCount: 0,
      policyFailedCount: 0,
      portfolioSetSha256: "2".repeat(64),
      families: [
        {
          familySha256: "3".repeat(64),
          recordCount: 1,
          activeCount: 1,
          archivedCount: 0,
          sourceQualifiedCount: 1,
          outcomeQualifiedCount: 1,
          reviewedBaselineCount: 1,
          replayCount: replayOutcomes.replayCount,
          completedCount: replayOutcomes.completedCount,
          blockedCount: replayOutcomes.blockedCount,
          invalidCount: replayOutcomes.invalidCount,
          completionRateBps: replayOutcomes.completionRateBps,
          topRecordId: record.id,
          topRecordScoreBps: 0,
          latestBaselineSha256: reviewedOutcomeBaseline.contentSha256,
        },
      ],
      contentSha256: "4".repeat(64),
    };
    const recommendationPolicyBacktest: ExecutionPlanBlueprintRecommendationPolicyBacktest =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-backtest",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:06.000Z",
        recordCount: 1,
        activeCount: 1,
        policyCount: 1,
        divergentSelectionCount: 0,
        portfolioSetSha256: "2".repeat(64),
        policySetSha256: "8".repeat(64),
        results: [
          {
            recommendationPolicy: selection.recommendationPolicy,
            recommendationPolicySha256: selection.recommendationPolicySha256,
            candidateCount: 1,
            qualifiedCandidateCount: 1,
            rejectedCandidateCount: 0,
            selectedRecordId: record.id,
            selectedFamilySha256: "3".repeat(64),
            selectedRecommendationScoreBps: 1_600,
            averageRecommendationScoreBps: 1_600,
            candidates: [
              {
                recordId: record.id,
                recordStatus: "active",
                recordUpdatedAt: record.updatedAt,
                selectionStatus: "selected",
                diagnostics: [],
                familySha256: "3".repeat(64),
                sourceQualificationStatus: "qualified",
                outcomeQualificationStatus: "qualified",
                familyRecordCount: 1,
                familyCompletionRateBps: 0,
                familyReviewedBaselineCount: 1,
                reviewedBaselineCoverageBps: 10_000,
                replayEvidenceBps: 1_000,
                recommendationScoreBps: 1_600,
                replayCount: replayOutcomes.replayCount,
                completedCount: replayOutcomes.completedCount,
                blockedCount: replayOutcomes.blockedCount,
                invalidCount: replayOutcomes.invalidCount,
                completionRateBps: replayOutcomes.completionRateBps,
                currentOutcomesSha256: replayOutcomes.contentSha256,
                currentOutcomeSetSha256: replayOutcomes.outcomeSetSha256,
              },
            ],
          },
        ],
        contentSha256: "9".repeat(64),
      };
    const recommendationPolicyOverride: ExecutionPlanBlueprintRecommendationPolicyOverride =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        familySha256: "3".repeat(64),
        recommendationPolicy: selection.recommendationPolicy,
        recommendationPolicySha256: selection.recommendationPolicySha256,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        familyRecordCount: 1,
        familyOutcomeQualifiedCount: 1,
        familyCompletionRateBps: 0,
        updatedAt: "2026-07-26T00:00:07.000Z",
        contentSha256: "a".repeat(64),
      };
    const recommendationPolicyOverrideList: ExecutionPlanBlueprintRecommendationPolicyOverrideList =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-overrides",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:08.000Z",
        overrideCount: 1,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: "b".repeat(64),
        overrides: [recommendationPolicyOverride],
        contentSha256: "c".repeat(64),
      };
    const recommendationPolicyOverrideDriftReview: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:09.000Z",
        overrideCount: 1,
        alignedCount: 0,
        retireRecommendedCount: 1,
        missingFamilyCount: 0,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: recommendationPolicyOverrideList.overrideSetSha256,
        reviewSetSha256: "d".repeat(64),
        reviews: [
          {
            familySha256: recommendationPolicyOverride.familySha256,
            overrideSha256: recommendationPolicyOverride.contentSha256,
            status: "retire_recommended",
            recommendation: "retire",
            diagnostics: ["override_policy_not_best"],
            overridePolicyTemplate: "balanced",
            overridePolicySha256:
              recommendationPolicyOverride.recommendationPolicySha256,
            overrideSelectedRecordId: record.id,
            overrideSelectedRecommendationScoreBps: 1_600,
            bestPolicyTemplate: "portfolio_first",
            bestPolicySha256: "e".repeat(64),
            bestSelectedRecordId: "blueprint_87654321",
            bestSelectedRecommendationScoreBps: 2_100,
            familyRecordCount: 1,
            familyOutcomeQualifiedCount: 1,
            familyCompletionRateBps: 0,
            reviewSha256: "f".repeat(64),
          },
        ],
        contentSha256: "1".repeat(64),
      };
    const recommendationPolicyOverrideRetirement: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        familySha256: recommendationPolicyOverride.familySha256,
        retiredOverrideSha256: recommendationPolicyOverride.contentSha256,
        retiredRecommendationPolicyTemplate: "balanced",
        retiredRecommendationPolicySha256:
          recommendationPolicyOverride.recommendationPolicySha256,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        overrideSetSha256: recommendationPolicyOverrideList.overrideSetSha256,
        driftReviewSetSha256:
          recommendationPolicyOverrideDriftReview.reviewSetSha256,
        remainingOverrideSetSha256: "2".repeat(64),
        retiredAt: "2026-07-26T00:00:10.000Z",
        contentSha256: "3".repeat(64),
      };
    const recommendationPolicyOverrideRetirementHistory: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:11.000Z",
        retirementCount: 1,
        portfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        currentOverrideSetSha256:
          recommendationPolicyOverrideRetirement.remainingOverrideSetSha256,
        retirementSetSha256: "4".repeat(64),
        latestRetiredAt: recommendationPolicyOverrideRetirement.retiredAt,
        retirements: [recommendationPolicyOverrideRetirement],
        contentSha256: "5".repeat(64),
      };
    const recommendationPolicyOverrideRetirementHistoryVerification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:12.000Z",
        status: "valid",
        diagnostics: [],
        declaredContentSha256:
          recommendationPolicyOverrideRetirementHistory.contentSha256,
        recomputedContentSha256:
          recommendationPolicyOverrideRetirementHistory.contentSha256,
        observedContentSha256:
          recommendationPolicyOverrideRetirementHistory.contentSha256,
        declaredPortfolioSetSha256:
          recommendationPolicyOverrideRetirementHistory.portfolioSetSha256,
        observedPortfolioSetSha256:
          recommendationPolicyOverrideRetirementHistory.portfolioSetSha256,
        declaredCurrentOverrideSetSha256:
          recommendationPolicyOverrideRetirementHistory.currentOverrideSetSha256,
        observedCurrentOverrideSetSha256:
          recommendationPolicyOverrideRetirementHistory.currentOverrideSetSha256,
        declaredRetirementSetSha256:
          recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
        recomputedRetirementSetSha256:
          recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
        observedRetirementSetSha256:
          recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
        retirementCount:
          recommendationPolicyOverrideRetirementHistory.retirementCount,
        observedRetirementCount:
          recommendationPolicyOverrideRetirementHistory.retirementCount,
        latestRetiredAt: recommendationPolicyOverrideRetirement.retiredAt,
        observedLatestRetiredAt:
          recommendationPolicyOverrideRetirement.retiredAt,
        contentSha256: "6".repeat(64),
      };
    const recommendationPolicyOverrideRetirementHistoryProofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:13.000Z",
        status: "aligned",
        diagnostics: [],
        historyCount: 2,
        validHistoryCount: 2,
        invalidHistoryCount: 0,
        distinctHistoryCount: 1,
        distinctPortfolioSetCount: 1,
        distinctCurrentOverrideSetCount: 1,
        distinctRetirementSetCount: 1,
        historySetSha256: "7".repeat(64),
        portfolioSetBundleSha256: "8".repeat(64),
        currentOverrideSetBundleSha256: "9".repeat(64),
        retirementSetBundleSha256: "a".repeat(64),
        histories: [
          {
            index: 0,
            status: "valid",
            diagnostics: [],
            declaredContentSha256:
              recommendationPolicyOverrideRetirementHistory.contentSha256,
            recomputedContentSha256:
              recommendationPolicyOverrideRetirementHistory.contentSha256,
            declaredPortfolioSetSha256:
              recommendationPolicyOverrideRetirementHistory.portfolioSetSha256,
            declaredCurrentOverrideSetSha256:
              recommendationPolicyOverrideRetirementHistory.currentOverrideSetSha256,
            declaredRetirementSetSha256:
              recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
            recomputedRetirementSetSha256:
              recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
            retirementCount:
              recommendationPolicyOverrideRetirementHistory.retirementCount,
            recomputedRetirementCount:
              recommendationPolicyOverrideRetirementHistory.retirementCount,
            latestRetiredAt: recommendationPolicyOverrideRetirement.retiredAt,
            recomputedLatestRetiredAt:
              recommendationPolicyOverrideRetirement.retiredAt,
            itemSha256: "b".repeat(64),
          },
          {
            index: 1,
            status: "valid",
            diagnostics: [],
            declaredContentSha256:
              recommendationPolicyOverrideRetirementHistory.contentSha256,
            recomputedContentSha256:
              recommendationPolicyOverrideRetirementHistory.contentSha256,
            declaredPortfolioSetSha256:
              recommendationPolicyOverrideRetirementHistory.portfolioSetSha256,
            declaredCurrentOverrideSetSha256:
              recommendationPolicyOverrideRetirementHistory.currentOverrideSetSha256,
            declaredRetirementSetSha256:
              recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
            recomputedRetirementSetSha256:
              recommendationPolicyOverrideRetirementHistory.retirementSetSha256,
            retirementCount:
              recommendationPolicyOverrideRetirementHistory.retirementCount,
            recomputedRetirementCount:
              recommendationPolicyOverrideRetirementHistory.retirementCount,
            latestRetiredAt: recommendationPolicyOverrideRetirement.retiredAt,
            recomputedLatestRetiredAt:
              recommendationPolicyOverrideRetirement.retiredAt,
            itemSha256: "c".repeat(64),
          },
        ],
        contentSha256: "d".repeat(64),
      };
    const signedRecommendationPolicyOverrideRetirementHistoryProofBundle: TrustedReceiptEnvelope<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle> =
      {
        kind: "napier.trusted-receipt-envelope",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        receiptKind: "policy_retirement_proof_bundle",
        receipt: recommendationPolicyOverrideRetirementHistoryProofBundle,
        signature: {
          algorithm: "Ed25519",
          keyId: "e".repeat(64),
          signedAt: "2026-07-26T00:00:14.000Z",
          receiptArtifactSha256: "f".repeat(64),
          statementSha256: "1".repeat(64),
          value: "signed-policy-retirement-proof-bundle",
        },
        contentSha256: "2".repeat(64),
      };
    const replayEventVerification: ExecutionPlanBlueprintRecordReplayEventVerification =
      {
        schemaVersion: 1,
        status: "valid",
        diagnostics: [],
        expectedRecordId: record.id,
        threadId: "thread_2",
        eventId: "event_12345678",
        seq: 1,
        declaredEventSha256: "5".repeat(64),
        observedEventSha256: "5".repeat(64),
        observedReplay: replayHistory.replays[0]!,
        contentSha256: "6".repeat(64),
      };
    const calls = [
      {
        path: "/api/plan-blueprints?status=active",
        response: [record],
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/qualification",
        response: qualification,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays",
        response: replayHistory,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/verify",
        method: "POST",
        body: { history: replayHistory },
        response: replayHistoryVerification,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes",
        response: replayOutcomes,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/verify",
        method: "POST",
        body: { outcomes: replayOutcomes },
        response: replayOutcomesVerification,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/baselines",
        response: [outcomeBaseline],
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/baselines",
        method: "POST",
        body: {
          outcomes: replayOutcomes,
          policy: { minCompletionRateBps: 0 },
        },
        response: outcomeBaselineResult,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/qualification",
        response: outcomeQualification,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/review",
        method: "POST",
        body: { model: { provider: "napier", id: "demo" } },
        response: outcomeReview,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/outcomes/baselines",
        method: "POST",
        body: {
          outcomes: replayOutcomes,
          review: outcomeReview,
        },
        response: reviewedOutcomeBaselineResult,
      },
      {
        path: "/api/threads/thread_2/plan-blueprints/selection",
        method: "POST",
        body: {},
        response: selection,
      },
      {
        path: "/api/plan-blueprints/portfolio/calibration",
        response: portfolioCalibration,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-backtest",
        response: recommendationPolicyBacktest,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
        response: recommendationPolicyOverrideList,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review",
        response: recommendationPolicyOverrideDriftReview,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire",
        method: "POST",
        body: {
          familySha256: "3".repeat(64),
          expectedOverrideSha256: recommendationPolicyOverride.contentSha256,
          expectedOverrideSetSha256:
            recommendationPolicyOverrideList.overrideSetSha256,
          expectedDriftReviewSetSha256:
            recommendationPolicyOverrideDriftReview.reviewSetSha256,
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        },
        response: recommendationPolicyOverrideRetirement,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements",
        response: recommendationPolicyOverrideRetirementHistory,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify",
        method: "POST",
        body: { history: recommendationPolicyOverrideRetirementHistory },
        response: recommendationPolicyOverrideRetirementHistoryVerification,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify",
        method: "POST",
        body: {
          histories: [
            recommendationPolicyOverrideRetirementHistory,
            recommendationPolicyOverrideRetirementHistory,
          ],
        },
        response: recommendationPolicyOverrideRetirementHistoryProofBundle,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign",
        method: "POST",
        body: {
          histories: [
            recommendationPolicyOverrideRetirementHistory,
            recommendationPolicyOverrideRetirementHistory,
          ],
          threadId: "thread_2",
          trustAnchorId: "trustkey_12345678",
        },
        response:
          signedRecommendationPolicyOverrideRetirementHistoryProofBundle,
      },
      {
        path: "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
        method: "POST",
        body: {
          familySha256: "3".repeat(64),
          policyTemplate: "balanced",
          expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
        },
        response: recommendationPolicyOverride,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/replays/events/verify",
        method: "POST",
        body: {
          threadId: "thread_2",
          eventId: "event_12345678",
          seq: 1,
          eventSha256: "5".repeat(64),
        },
        response: replayEventVerification,
      },
      {
        path: "/api/threads/thread_2/plans/from-blueprint-record/preview",
        method: "POST",
        body: { recordId: record.id },
        response: preview,
      },
      {
        path: "/api/threads/thread_1/plan-blueprints",
        method: "POST",
        body: { blueprint, name: "Reusable plan" },
        response: saveResult,
      },
      {
        path: "/api/plan-blueprints/blueprint_12345678/status",
        method: "POST",
        body: { status: "archived" },
        response: { ...record, status: "archived" },
      },
      {
        path: "/api/threads/thread_2/plans/from-blueprint-record",
        method: "POST",
        body: {
          recordId: record.id,
          expectedPreviewSha256: preview.previewSha256,
        },
        response: createdPlan,
      },
      {
        path: "/api/threads/thread_2/plans/from-blueprint-record",
        method: "POST",
        body: {
          recordId: record.id,
          expectedPreviewSha256: preview.previewSha256,
        },
        response: createdPlan,
      },
      {
        path: "/api/threads/thread_2/plans/from-blueprint-record",
        method: "POST",
        body: {
          recordId: record.id,
          expectedPreviewSha256: preview.previewSha256,
        },
        response: createdPlan,
        headers: {
          "X-Napier-Blueprint-Replay-Event-Id": "event_12345678",
          "X-Napier-Blueprint-Replay-Event-Seq": "1",
          "X-Napier-Blueprint-Replay-Event-SHA256": "5".repeat(64),
        },
      },
    ];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const call = calls[fetchMock.mock.calls.length - 1]!;
      expect(path).toBe(call.path);
      expect(init?.method).toBe(call.method);
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      if (call.body) expect(init?.body).toBe(JSON.stringify(call.body));
      const text = JSON.stringify(call.response);
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": sha256Text(text),
          "X-Napier-Content-SHA256-Mode": "body",
          ...call.headers,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getExecutionPlanBlueprintRecords("active")).resolves.toEqual([
      record,
    ]);
    await expect(
      getExecutionPlanBlueprintRecordQualification(record.id),
    ).resolves.toEqual(qualification);
    await expect(
      getExecutionPlanBlueprintRecordReplays(record.id),
    ).resolves.toEqual(replayHistory);
    await expect(
      verifyExecutionPlanBlueprintRecordReplays(record.id, {
        history: replayHistory,
      }),
    ).resolves.toEqual(replayHistoryVerification);
    await expect(
      getExecutionPlanBlueprintRecordReplayOutcomes(record.id),
    ).resolves.toEqual(replayOutcomes);
    await expect(
      verifyExecutionPlanBlueprintRecordReplayOutcomes(record.id, {
        outcomes: replayOutcomes,
      }),
    ).resolves.toEqual(replayOutcomesVerification);
    await expect(
      getExecutionPlanBlueprintRecordOutcomeBaselines(record.id),
    ).resolves.toEqual([outcomeBaseline]);
    await expect(
      promoteExecutionPlanBlueprintRecordOutcomeBaseline(record.id, {
        outcomes: replayOutcomes,
        policy: { minCompletionRateBps: 0 },
      }),
    ).resolves.toEqual(outcomeBaselineResult);
    await expect(
      getExecutionPlanBlueprintRecordOutcomeQualification(record.id),
    ).resolves.toEqual(outcomeQualification);
    await expect(
      reviewExecutionPlanBlueprintRecordOutcomes(record.id, {
        model: { provider: "napier", id: "demo" },
      }),
    ).resolves.toEqual(outcomeReview);
    await expect(
      promoteExecutionPlanBlueprintRecordOutcomeBaseline(record.id, {
        outcomes: replayOutcomes,
        review: outcomeReview,
      }),
    ).resolves.toEqual(reviewedOutcomeBaselineResult);
    await expect(
      selectExecutionPlanBlueprintRecord("thread_2"),
    ).resolves.toEqual(selection);
    await expect(
      getExecutionPlanBlueprintPortfolioCalibration(),
    ).resolves.toEqual(portfolioCalibration);
    await expect(
      getExecutionPlanBlueprintRecommendationPolicyBacktest(),
    ).resolves.toEqual(recommendationPolicyBacktest);
    await expect(
      getExecutionPlanBlueprintRecommendationPolicyOverrides(),
    ).resolves.toEqual(recommendationPolicyOverrideList);
    await expect(
      getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview(),
    ).resolves.toEqual(recommendationPolicyOverrideDriftReview);
    await expect(
      retireExecutionPlanBlueprintRecommendationPolicyOverride({
        familySha256: "3".repeat(64),
        expectedOverrideSha256: recommendationPolicyOverride.contentSha256,
        expectedOverrideSetSha256:
          recommendationPolicyOverrideList.overrideSetSha256,
        expectedDriftReviewSetSha256:
          recommendationPolicyOverrideDriftReview.reviewSetSha256,
        expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
      }),
    ).resolves.toEqual(recommendationPolicyOverrideRetirement);
    await expect(
      getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(),
    ).resolves.toEqual(recommendationPolicyOverrideRetirementHistory);
    await expect(
      verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements({
        history: recommendationPolicyOverrideRetirementHistory,
      }),
    ).resolves.toEqual(
      recommendationPolicyOverrideRetirementHistoryVerification,
    );
    await expect(
      verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
        {
          histories: [
            recommendationPolicyOverrideRetirementHistory,
            recommendationPolicyOverrideRetirementHistory,
          ],
        },
      ),
    ).resolves.toEqual(
      recommendationPolicyOverrideRetirementHistoryProofBundle,
    );
    await expect(
      signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
        {
          histories: [
            recommendationPolicyOverrideRetirementHistory,
            recommendationPolicyOverrideRetirementHistory,
          ],
          threadId: "thread_2",
          trustAnchorId: "trustkey_12345678",
        },
      ),
    ).resolves.toEqual(
      signedRecommendationPolicyOverrideRetirementHistoryProofBundle,
    );
    await expect(
      setExecutionPlanBlueprintRecommendationPolicyOverride({
        familySha256: "3".repeat(64),
        policyTemplate: "balanced",
        expectedPortfolioSetSha256: portfolioCalibration.portfolioSetSha256,
      }),
    ).resolves.toEqual(recommendationPolicyOverride);
    await expect(
      verifyExecutionPlanBlueprintRecordReplayEvent(record.id, {
        threadId: "thread_2",
        eventId: "event_12345678",
        seq: 1,
        eventSha256: "5".repeat(64),
      }),
    ).resolves.toEqual(replayEventVerification);
    await expect(
      previewExecutionPlanFromBlueprintRecord("thread_2", {
        recordId: record.id,
      }),
    ).resolves.toEqual(preview);
    await expect(
      saveExecutionPlanBlueprint("thread_1", {
        blueprint,
        name: "Reusable plan",
      }),
    ).resolves.toEqual(saveResult);
    await expect(
      setExecutionPlanBlueprintRecordStatus(record.id, {
        status: "archived",
      }),
    ).resolves.toEqual({ ...record, status: "archived" });
    await expect(
      createExecutionPlanFromBlueprintRecord("thread_2", {
        recordId: record.id,
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).resolves.toEqual(createdPlan);
    await expect(
      createExecutionPlanFromBlueprintRecordWithReplayEvent("thread_2", {
        recordId: record.id,
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).resolves.toEqual({
      plan: createdPlan,
    });
    await expect(
      createExecutionPlanFromBlueprintRecordWithReplayEvent("thread_2", {
        recordId: record.id,
        expectedPreviewSha256: preview.previewSha256,
      }),
    ).resolves.toEqual({
      plan: createdPlan,
      replayEvent: {
        threadId: "thread_2",
        eventId: "event_12345678",
        seq: 1,
        eventSha256: "5".repeat(64),
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(29);
  });
});

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function planBlueprintFixture(): ExecutionPlanBlueprint {
  const content: Omit<ExecutionPlanBlueprint, "generatedAt" | "contentSha256"> =
    {
      kind: "napier.execution-plan-blueprint",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      title: "Reusable plan",
      objective: "Reuse a verified workflow.",
      source: {
        type: "plan",
        threadId: "thread_1",
        planId: "plan_1",
        planRevision: 3,
        planArchiveSha256: "a".repeat(64),
        eventStreamSha256: "b".repeat(64),
      },
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the workspace.",
          verification: "Inspection evidence is recorded.",
        },
      ],
      stepCount: 1,
      artifactCount: 0,
    };
  return {
    ...content,
    generatedAt: "2026-07-26T00:00:00.000Z",
    contentSha256: sha256Canonical(content),
  };
}

function planBlueprintRecordFixture(
  blueprint: ExecutionPlanBlueprint,
): ExecutionPlanBlueprintRecord {
  return {
    id: "blueprint_12345678",
    name: "Reusable plan",
    description: "",
    status: "active",
    blueprint,
    blueprintSha256: blueprint.contentSha256,
    sourceThreadId: blueprint.source.threadId,
    sourcePlanId: blueprint.source.planId,
    sourcePlanRevision: blueprint.source.planRevision,
    sourcePlanArchiveSha256: blueprint.source.planArchiveSha256,
    sourceEventStreamSha256: blueprint.source.eventStreamSha256,
    createdByThreadId: "thread_1",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
}

function sha256Canonical(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

import { createHash } from "node:crypto";

import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalJson } from "../src/stable-digest";
import {
  executeWorkflowExperiment,
  previewWorkflowExperiment,
  validateWorkflowExperimentResultFrame,
} from "../src/workflow-experiment-api";

describe("Workflow experiment Web API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews through the hash-bound no-store route", async () => {
    const fixture = experimentFixture();
    const controller = new AbortController();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(
        `/api/threads/${fixture.sourceThreadId}/workflows/${fixture.sourcePlanId}/experiments/preview`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(controller.signal);
      expect(JSON.parse(String(init?.body))).toEqual({
        manifest: fixture.manifest,
        fromNodeId: "report",
      });
      return jsonResponse(fixture.preview, {
        headers: {
          "Cache-Control": "no-store",
          "X-Napier-Content-SHA256": fixture.preview.previewSha256,
          "X-Napier-Content-SHA256-Mode": "stable",
          "X-Napier-Workflow-Experiment-Preview-SHA256":
            fixture.preview.previewSha256,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      previewWorkflowExperiment(
        fixture.sourceThreadId,
        fixture.sourcePlanId,
        {
          manifest: fixture.manifest,
          fromNodeId: "report",
        },
        controller.signal,
      ),
    ).resolves.toEqual(fixture.preview);
  });

  it("rejects a valid preview bound to another source Thread", async () => {
    const fixture = experimentFixture();
    const { previewSha256: _previewSha256, ...previewContent } =
      fixture.preview;
    const driftedContent = {
      ...previewContent,
      sourceThreadId: "thread_other_12345678",
    };
    const drifted = {
      ...driftedContent,
      previewSha256: sha256(canonicalJson(driftedContent)),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(drifted, {
          headers: {
            "Cache-Control": "no-store",
            "X-Napier-Content-SHA256": drifted.previewSha256,
            "X-Napier-Content-SHA256-Mode": "stable",
            "X-Napier-Workflow-Experiment-Preview-SHA256":
              drifted.previewSha256,
          },
        }),
      ),
    );

    await expect(
      previewWorkflowExperiment(fixture.sourceThreadId, fixture.sourcePlanId, {
        manifest: fixture.manifest,
        fromNodeId: "report",
      }),
    ).rejects.toThrow("preview binding");
  });

  it("accepts a snapshot-bound experiment result and exposes progress frames", async () => {
    const fixture = experimentFixture();
    const frames: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(fixture.snapshot)}`,
            "",
            `event: workflow_experiment_result\ndata: ${JSON.stringify(fixture.resultFrame)}`,
            "",
          ].join("\n"),
          fixture,
        ),
      ),
    );

    const result = await executeWorkflowExperiment(
      fixture.sourceThreadId,
      fixture.sourcePlanId,
      {
        manifest: fixture.manifest,
        fromNodeId: "report",
        expectedPreviewSha256: fixture.preview.previewSha256,
      },
      fixture.preview,
      (frame) => frames.push(frame),
    );

    expect(result).toEqual(fixture.resultFrame);
    expect(frames.map((frame) => (frame as { type: string }).type)).toEqual([
      "snapshot",
      "workflow_experiment_result",
    ]);
  });

  it("rejects stale preview bindings before network mutation", async () => {
    const fixture = experimentFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeWorkflowExperiment(
        fixture.sourceThreadId,
        fixture.sourcePlanId,
        {
          manifest: fixture.manifest,
          fromNodeId: "report",
          expectedPreviewSha256: "f".repeat(64),
        },
        fixture.preview,
      ),
    ).rejects.toThrow("preview is stale");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing terminal result and comparison tampering", async () => {
    const fixture = experimentFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          `event: snapshot\ndata: ${JSON.stringify(fixture.snapshot)}`,
          fixture,
        ),
      ),
    );
    await expect(
      executeWorkflowExperiment(
        fixture.sourceThreadId,
        fixture.sourcePlanId,
        {
          manifest: fixture.manifest,
          fromNodeId: "report",
          expectedPreviewSha256: fixture.preview.previewSha256,
        },
        fixture.preview,
      ),
    ).rejects.toThrow("without terminal frame");

    const tampered = structuredClone(fixture.resultFrame);
    tampered.experiment.comparison!.metricDelta.costUsd = 10;
    await expect(
      validateWorkflowExperimentResultFrame(tampered),
    ).rejects.toThrow("comparison hash");

    const forgedSkipped = structuredClone(fixture.resultFrame);
    const skippedTarget = forgedSkipped.experiment.comparison!.nodes[0]!.target;
    skippedTarget.status = "skipped";
    skippedTarget.outputSha256 = "5".repeat(64);
    skippedTarget.metrics.attemptCount = 1;
    const { contentSha256: _comparisonSha256, ...comparisonContent } =
      forgedSkipped.experiment.comparison!;
    forgedSkipped.experiment.comparison!.contentSha256 = sha256(
      canonicalJson(comparisonContent),
    );
    const { contentSha256: _frameSha256, ...frameContent } = forgedSkipped;
    forgedSkipped.contentSha256 = sha256(canonicalJson(frameContent));
    await expect(
      validateWorkflowExperimentResultFrame(forgedSkipped),
    ).rejects.toThrow("comparison is invalid");

    const forgedStatus = structuredClone(fixture.resultFrame);
    const output = { report: "Forged status", approved: true };
    const outputSha256 = sha256(canonicalJson(output));
    forgedStatus.experiment.result.nodeResults = [
      {
        nodeId: "report",
        attempt: 0,
        status: "skipped",
        inputSha256: "4".repeat(64),
        inputSchemaSha256: "5".repeat(64),
        outputSchemaSha256: "6".repeat(64),
        output,
        outputSha256,
      },
    ];
    const forgedTarget = forgedStatus.experiment.comparison!.nodes[0]!.target;
    forgedTarget.status = "completed";
    forgedTarget.outputSha256 = outputSha256;
    forgedStatus.experiment.comparison!.nodes[0]!.statusChanged = true;
    forgedStatus.experiment.comparison!.nodes[0]!.outputChange =
      "became_available";
    forgedStatus.experiment.comparison!.changedNodeIds = ["report"];
    const { contentSha256: _statusComparisonSha256, ...statusComparison } =
      forgedStatus.experiment.comparison!;
    forgedStatus.experiment.comparison!.contentSha256 = sha256(
      canonicalJson(statusComparison),
    );
    const { resultSha256: _statusResultSha256, ...statusResult } =
      forgedStatus.experiment.result;
    forgedStatus.experiment.result.resultSha256 = sha256(
      canonicalJson(statusResult),
    );
    const { contentSha256: _statusFrameSha256, ...statusFrame } = forgedStatus;
    forgedStatus.contentSha256 = sha256(canonicalJson(statusFrame));
    await expect(
      validateWorkflowExperimentResultFrame(forgedStatus),
    ).rejects.toThrow("result binding is invalid");
  });

  it("rejects duplicate terminal snapshots", async () => {
    const fixture = experimentFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            `event: snapshot\ndata: ${JSON.stringify(fixture.snapshot)}`,
            "",
            `event: snapshot\ndata: ${JSON.stringify(fixture.snapshot)}`,
            "",
            `event: workflow_experiment_result\ndata: ${JSON.stringify(fixture.resultFrame)}`,
            "",
          ].join("\n"),
          fixture,
        ),
      ),
    );

    await expect(
      executeWorkflowExperiment(
        fixture.sourceThreadId,
        fixture.sourcePlanId,
        {
          manifest: fixture.manifest,
          fromNodeId: "report",
          expectedPreviewSha256: fixture.preview.previewSha256,
        },
        fixture.preview,
      ),
    ).rejects.toThrow("duplicate snapshots");
  });
});

function experimentFixture() {
  const sourceThreadId = "thread_source_12345678";
  const sourcePlanId = "plan_source_12345678";
  const targetThreadId = "thread_target_12345678";
  const targetPlanId = "plan_target_12345678";
  const manifest = workflowManifest();
  const preview = workflowPreview(manifest, sourceThreadId, sourcePlanId);
  const comparison = workflowComparison({
    sourceThreadId,
    sourcePlanId,
    targetThreadId,
    targetPlanId,
  });
  const workflowResultContent = {
    kind: "napier.execution-plan-workflow-result" as const,
    schemaVersion: 1 as const,
    threadId: targetThreadId,
    planId: targetPlanId,
    manifestSha256: manifest.contentSha256,
    blueprintSha256: manifest.blueprint.contentSha256,
    status: "blocked" as const,
    resumed: false,
    nodeResults: [],
  };
  const workflowResult = {
    ...workflowResultContent,
    resultSha256: sha256(canonicalJson(workflowResultContent)),
  };
  const experiment = {
    kind: "napier.execution-plan-workflow-experiment-result" as const,
    schemaVersion: 1 as const,
    preview,
    sourceManifest: manifest,
    candidateManifest: manifest,
    targetThreadId,
    result: workflowResult,
    comparison,
  };
  const snapshot = snapshotFrame(targetThreadId, targetPlanId);
  const frameContent = {
    type: "workflow_experiment_result" as const,
    sourceThreadId,
    sourcePlanId,
    targetThreadId,
    targetPlanId,
    status: "blocked" as const,
    previewSha256: preview.previewSha256,
    candidateManifestSha256: manifest.contentSha256,
    experiment,
    snapshotSha256: snapshot.detailSha256,
    snapshotBytes: snapshot.detailBytes,
    eventCount: 0,
    eventBytes: snapshot.eventBytes,
    eventStreamSha256: sha256(""),
  };
  const resultFrame: ExecutionPlanWorkflowExperimentResultFrame = {
    ...frameContent,
    contentSha256: sha256(canonicalJson(frameContent)),
  };
  return {
    sourceThreadId,
    sourcePlanId,
    targetThreadId,
    targetPlanId,
    manifest,
    preview,
    snapshot,
    resultFrame,
  };
}

function workflowManifest(): ExecutionPlanWorkflowManifest {
  const content = {
    kind: "napier.execution-plan-workflow" as const,
    schemaVersion: 1 as const,
    apiVersion: "2026-07-25",
    name: "Web experiment",
    version: 1,
    description: "Exercise the browser experiment path.",
    blueprint: {
      kind: "napier.execution-plan-blueprint" as const,
      schemaVersion: 1 as const,
      apiVersion: "2026-07-25",
      source: {
        type: "plan" as const,
        threadId: "thread_blueprint_12345678",
        planId: "plan_blueprint_12345678",
        planRevision: 1,
        planArchiveSha256: "0".repeat(64),
        eventStreamSha256: "1".repeat(64),
      },
      title: "Web experiment",
      objective: "Produce a report.",
      steps: [
        {
          id: "report",
          title: "Report",
          description: "Produce a report.",
          verification: "Return typed JSON.",
          dependsOn: [],
        },
      ],
      stepCount: 1,
      artifactCount: 0,
      generatedAt: "2026-07-31T00:00:00.000Z",
      contentSha256: "2".repeat(64),
    },
    inputSchema: objectSchema("request"),
    outputSchema: objectSchema("report"),
    outputNodeId: "report",
    nodes: [
      {
        id: "report",
        type: "agent" as const,
        inputBindings: { workflow: { source: "workflow" as const } },
        inputSchema: {
          type: "object" as const,
          properties: { workflow: objectSchema("request") },
          required: ["workflow"],
          additionalProperties: false as const,
        },
        outputSchema: objectSchema("report"),
        model: { provider: "faux", id: "source" },
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
    nodeCount: 1,
  };
  return {
    ...content,
    generatedAt: "2026-07-31T00:00:00.000Z",
    contentSha256: sha256(canonicalJson(content)),
  };
}

function workflowPreview(
  manifest: ExecutionPlanWorkflowManifest,
  sourceThreadId: string,
  sourcePlanId: string,
): ExecutionPlanWorkflowExperimentPreview {
  const content = {
    kind: "napier.execution-plan-workflow-experiment-preview" as const,
    schemaVersion: 1 as const,
    sourceThreadId,
    sourcePlanId,
    sourcePlanRevision: 3,
    sourceManifestSha256: manifest.contentSha256,
    candidateManifestSha256: manifest.contentSha256,
    sourceAgentId: "agent_napier_12345678",
    sourceAgentRevision: 1,
    fromNodeId: "report",
    reusedNodeIds: [],
    rerunNodeIds: ["report"],
    modelOverrides: {},
    toolEffects: [
      {
        nodeId: "report",
        attemptCount: 1,
        toolCallCount: 0,
        readOnlyCount: 0,
        writeCount: 0,
        unknownCount: 0,
        unresolvedCount: 0,
        writeToolNames: [],
        unknownToolNames: [],
      },
    ],
    requiresSideEffectConfirmation: false,
  };
  return {
    ...content,
    previewSha256: sha256(canonicalJson(content)),
  };
}

function workflowComparison(ids: {
  sourceThreadId: string;
  sourcePlanId: string;
  targetThreadId: string;
  targetPlanId: string;
}) {
  const metrics = metricSet();
  const evaluations = {
    total: 0,
    leftBetter: 0,
    rightBetter: 0,
    tie: 0,
    inconclusive: 0,
  };
  const artifacts = {
    total: 0,
    produced: 0,
    verified: 0,
    missing: 0,
    setSha256: "3".repeat(64),
  };
  const observation = {
    status: "blocked" as const,
    runIds: [],
    runSources: [],
    models: [],
    configurationSha256s: [],
    toolNames: [],
    inputSha256: "4".repeat(64),
    metrics,
    evaluations,
  };
  const content = {
    kind: "napier.execution-plan-workflow-experiment-comparison" as const,
    schemaVersion: 1 as const,
    ...ids,
    sourceStatus: "completed" as const,
    targetStatus: "blocked" as const,
    sourceInputSha256: "4".repeat(64),
    targetInputSha256: "4".repeat(64),
    inputChange: "unchanged" as const,
    outputChange: "unavailable" as const,
    reusedNodeCount: 0,
    rerunNodeCount: 1,
    sourceMetrics: metrics,
    targetMetrics: metrics,
    metricDelta: metrics,
    sourceEvaluations: evaluations,
    targetEvaluations: evaluations,
    sourceArtifacts: artifacts,
    targetArtifacts: artifacts,
    changedNodeIds: [],
    nodes: [
      {
        nodeId: "report",
        execution: "rerun" as const,
        source: observation,
        target: observation,
        statusChanged: false,
        modelChanged: false,
        configurationChanged: false,
        inputChange: "unchanged" as const,
        outputChange: "unavailable" as const,
        metricDelta: metrics,
        addedToolNames: [],
        removedToolNames: [],
      },
    ],
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function snapshotFrame(threadId: string, planId: string) {
  const detail = {
    thread: {
      id: threadId,
      title: "Experiment target",
      agentId: "agent_napier_12345678",
      status: "failed",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
      lastMessage: "",
      eventCount: 0,
      runIds: [],
    },
    agent: { id: "agent_napier_12345678" },
    runs: [],
    plans: [{ id: planId, status: "blocked" }],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration: {},
    events: [],
  };
  return {
    type: "snapshot" as const,
    detail,
    detailSha256: sha256(JSON.stringify(detail)),
    detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
    eventBytes: Buffer.byteLength(JSON.stringify(detail.events), "utf8"),
  };
}

function metricSet() {
  return {
    runCount: 0,
    attemptCount: 0,
    durationMs: 0,
    modelResponseCount: 0,
    toolCallCount: 0,
    toolCompletedCount: 0,
    toolFailedCount: 0,
    toolBlockedCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function objectSchema(name: string) {
  return {
    type: "object" as const,
    properties: {
      [name]: { type: "string" as const, maxLength: 200 },
    },
    required: [name],
    additionalProperties: false as const,
  };
}

function sseResponse(
  chunk: string,
  fixture: ReturnType<typeof experimentFixture>,
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Napier-Content-SHA256": fixture.preview.previewSha256,
        "X-Napier-Content-SHA256-Mode": "stable",
        "X-Napier-Workflow-Experiment-Preview-SHA256":
          fixture.preview.previewSha256,
        "X-Napier-Workflow-Experiment-Source-Manifest-SHA256":
          fixture.manifest.contentSha256,
        "X-Napier-Workflow-Experiment-Candidate-Manifest-SHA256":
          fixture.manifest.contentSha256,
      },
    },
  );
}

function jsonResponse(
  body: unknown,
  init: { headers: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

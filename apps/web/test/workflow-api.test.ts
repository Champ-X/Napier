import { createHash } from "node:crypto";

import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResultFrame,
  JsonValue,
  RunEvent,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { continueWorkflowBreakpoint } from "../src/workflow-api";
import type { OpenWorkflowBreakpoint } from "../src/workflow-breakpoint-view-model";
import { validateWorkflowResultFrame } from "../src/workflow-result-web-protocol";
import { canonicalJson } from "../src/stable-digest";

describe("Workflow Web continuation API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("continues one exact breakpoint through a bound SSE result", async () => {
    const fixture = workflowFixture();
    const frames: unknown[] = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(`/api/threads/${fixture.threadId}/workflows`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        manifest: fixture.manifest,
        planId: fixture.breakpoint.planId,
        continueBreakpoint: true,
      });
      return workflowResponse(fixture);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      continueWorkflowBreakpoint(
        fixture.threadId,
        fixture.manifest,
        fixture.breakpoint,
        (frame) => frames.push(frame),
      ),
    ).resolves.toEqual(fixture.resultFrame);
    expect(frames.map((frame) => (frame as { type: string }).type)).toEqual([
      "event",
      "snapshot",
      "workflow_result",
    ]);
  });

  it("rejects a terminal stream without the exact continuation event", async () => {
    const fixture = workflowFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        workflowResponse(
          fixture,
          [
            `event: snapshot\ndata: ${JSON.stringify(fixture.snapshot)}`,
            "",
            `event: workflow_result\ndata: ${JSON.stringify(fixture.resultFrame)}`,
            "",
          ].join("\n"),
        ),
      ),
    );

    await expect(
      continueWorkflowBreakpoint(
        fixture.threadId,
        fixture.manifest,
        fixture.breakpoint,
      ),
    ).rejects.toThrow("terminal binding");
  });

  it("rejects a rehashed paused result without matching reached evidence", async () => {
    const fixture = workflowFixture();
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.detail.thread.status = "waiting";
    snapshot.detail.plans[0]!.status = "active";
    snapshot.detailSha256 = sha256(JSON.stringify(snapshot.detail));
    snapshot.detailBytes = Buffer.byteLength(
      JSON.stringify(snapshot.detail),
      "utf8",
    );
    const breakpoint = {
      nodeId: fixture.breakpoint.nodeId,
      breakpointIndex: fixture.breakpoint.breakpointIndex,
      breakpointCount: fixture.breakpoint.breakpointCount,
      reachedEventSeq: 7,
      bindingContextSha256: fixture.breakpoint.bindingContextSha256,
    };
    const { resultSha256: _resultSha256, ...originalResultContent } =
      fixture.resultFrame.result;
    const resultContent = {
      ...originalResultContent,
      status: "paused" as const,
      breakpoint,
    };
    const result = {
      ...resultContent,
      resultSha256: sha256(canonicalJson(resultContent)),
    };
    const { contentSha256: _contentSha256, ...originalFrameContent } =
      fixture.resultFrame;
    const frameContent = {
      ...originalFrameContent,
      status: "paused" as const,
      result,
      snapshotSha256: snapshot.detailSha256,
      snapshotBytes: snapshot.detailBytes,
    };
    const resultFrame: ExecutionPlanWorkflowResultFrame = {
      ...frameContent,
      contentSha256: sha256(
        canonicalJson(frameContent as unknown as JsonValue),
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        workflowResponse({ ...fixture, snapshot, resultFrame }),
      ),
    );

    await expect(
      continueWorkflowBreakpoint(
        fixture.threadId,
        fixture.manifest,
        fixture.breakpoint,
      ),
    ).rejects.toThrow("paused breakpoint evidence");
  });

  it("rejects a self-consistently rehashed impossible breakpoint sequence", async () => {
    const fixture = workflowFixture();
    const forged = structuredClone(fixture.resultFrame);
    const breakpoint = {
      nodeId: "next",
      breakpointIndex: 1,
      breakpointCount: 2,
      reachedEventSeq: forged.eventCount + 1,
      bindingContextSha256: "8".repeat(64),
    };
    const { resultSha256: _resultSha256, ...originalResultContent } =
      forged.result;
    const resultContent = {
      ...originalResultContent,
      status: "paused" as const,
      breakpoint,
    };
    forged.status = "paused";
    forged.result = {
      ...resultContent,
      resultSha256: sha256(canonicalJson(resultContent)),
    };
    const { contentSha256: _contentSha256, ...frameContent } = forged;
    forged.contentSha256 = sha256(
      canonicalJson(frameContent as unknown as JsonValue),
    );

    await expect(validateWorkflowResultFrame(forged)).rejects.toThrow(
      "binding",
    );
  });
});

function workflowFixture() {
  const threadId = "thread_target12345678";
  const planId = "plan_target12345678";
  const manifest = workflowManifest();
  const breakpoint: OpenWorkflowBreakpoint = {
    planId,
    manifestSha256: manifest.contentSha256,
    nodeId: "write",
    breakpointIndex: 0,
    breakpointCount: 1,
    reachedEventSeq: 8,
    bindingContextSha256: "4".repeat(64),
    planRevision: 3,
    breakBeforeNodeIds: ["write"],
  };
  const continued = continuationEvent(threadId, breakpoint);
  const events = [...priorEvents(threadId, breakpoint), continued];
  const eventFrame = {
    type: "event" as const,
    event: continued,
    eventSha256: sha256(JSON.stringify(continued)),
  };
  const snapshot = snapshotFrame(threadId, planId, events);
  const resultContent = {
    kind: "napier.execution-plan-workflow-result" as const,
    schemaVersion: 1 as const,
    threadId,
    planId,
    manifestSha256: manifest.contentSha256,
    blueprintSha256: manifest.blueprint.contentSha256,
    status: "blocked" as const,
    resumed: true,
    nodeResults: [],
  };
  const result = {
    ...resultContent,
    resultSha256: sha256(canonicalJson(resultContent)),
  };
  const frameContent = {
    type: "workflow_result" as const,
    threadId,
    planId,
    status: "blocked" as const,
    manifestSha256: manifest.contentSha256,
    result,
    snapshotSha256: snapshot.detailSha256,
    snapshotBytes: snapshot.detailBytes,
    eventCount: events.length,
    eventBytes: snapshot.eventBytes,
    eventStreamSha256: sha256(
      events.map((event) => JSON.stringify(event)).join("\n"),
    ),
  };
  const resultFrame: ExecutionPlanWorkflowResultFrame = {
    ...frameContent,
    contentSha256: sha256(canonicalJson(frameContent)),
  };
  return {
    threadId,
    manifest,
    breakpoint,
    eventFrame,
    snapshot,
    resultFrame,
  };
}

function priorEvents(
  threadId: string,
  breakpoint: OpenWorkflowBreakpoint,
): RunEvent[] {
  return Array.from({ length: 8 }, (_, index) => {
    const seq = index + 1;
    return {
      id: `evt_prior_${String(seq).padStart(8, "0")}`,
      threadId,
      runId: "runctl_abcdefghijklmnopqrst",
      seq,
      type:
        seq === breakpoint.reachedEventSeq
          ? "workflow.breakpoint.reached"
          : "plan.observed",
      category: "plan",
      visibility: "user",
      createdAt: "2026-08-01T00:00:00.000Z",
      payload:
        seq === breakpoint.reachedEventSeq
          ? {
              schemaVersion: 1,
              planId: breakpoint.planId,
              manifestSha256: breakpoint.manifestSha256,
              nodeId: breakpoint.nodeId,
              breakpointIndex: breakpoint.breakpointIndex,
              breakpointCount: breakpoint.breakpointCount,
              bindingContextSha256: breakpoint.bindingContextSha256,
              planRevision: breakpoint.planRevision,
            }
          : { schemaVersion: 1, planId: breakpoint.planId },
    };
  });
}

function workflowManifest(): ExecutionPlanWorkflowManifest {
  return {
    kind: "napier.execution-plan-workflow",
    schemaVersion: 1,
    apiVersion: "2026-07-25",
    generatedAt: "2026-08-01T00:00:00.000Z",
    name: "Breakpoint Web control",
    version: 1,
    description: "Continue one bound breakpoint.",
    blueprint: {
      kind: "napier.execution-plan-blueprint",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      source: {
        type: "plan",
        threadId: "thread_source_12345678",
        planId: "plan_source_12345678",
        planRevision: 1,
        planArchiveSha256: "1".repeat(64),
        eventStreamSha256: "2".repeat(64),
      },
      title: "Breakpoint",
      objective: "Continue one node.",
      steps: [
        {
          id: "write",
          title: "Write",
          description: "Write the file.",
          verification: "Return a receipt.",
          dependsOn: [],
        },
      ],
      stepCount: 1,
      artifactCount: 0,
      generatedAt: "2026-08-01T00:00:00.000Z",
      contentSha256: "3".repeat(64),
    },
    inputSchema: objectSchema("request"),
    outputSchema: objectSchema("done"),
    outputNodeId: "write",
    nodes: [
      {
        id: "write",
        type: "agent",
        inputBindings: { workflow: { source: "workflow" } },
        inputSchema: {
          type: "object",
          properties: { workflow: objectSchema("request") },
          required: ["workflow"],
          additionalProperties: false,
        },
        outputSchema: objectSchema("done"),
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    ],
    nodeCount: 1,
    contentSha256: "5".repeat(64),
  };
}

function continuationEvent(
  threadId: string,
  breakpoint: OpenWorkflowBreakpoint,
): RunEvent {
  return {
    id: "evt_abcdefghijklmnopqrst",
    threadId,
    runId: "runctl_abcdefghijklmnopqrst",
    seq: 9,
    type: "workflow.breakpoint.continued",
    category: "plan",
    visibility: "user",
    createdAt: "2026-08-01T00:00:01.000Z",
    payload: {
      schemaVersion: 1,
      planId: breakpoint.planId,
      manifestSha256: breakpoint.manifestSha256,
      nodeId: breakpoint.nodeId,
      breakpointIndex: breakpoint.breakpointIndex,
      breakpointCount: breakpoint.breakpointCount,
      bindingContextSha256: breakpoint.bindingContextSha256,
      planRevision: breakpoint.planRevision,
      reachedEventSeq: breakpoint.reachedEventSeq,
    },
  };
}

function snapshotFrame(threadId: string, planId: string, events: RunEvent[]) {
  const detail = {
    thread: {
      id: threadId,
      title: "Workflow target",
      agentId: "agent_napier_12345678",
      status: "failed",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
      lastMessage: "",
      eventCount: events.length,
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
    events,
  };
  return {
    type: "snapshot" as const,
    detail,
    detailSha256: sha256(JSON.stringify(detail)),
    detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
    eventBytes: Buffer.byteLength(JSON.stringify(events), "utf8"),
  };
}

function workflowResponse(
  fixture: ReturnType<typeof workflowFixture>,
  override?: string,
): Response {
  const body =
    override ??
    [
      `id: ${String(fixture.eventFrame.event.seq)}`,
      `event: event`,
      `data: ${JSON.stringify(fixture.eventFrame)}`,
      "",
      `event: snapshot`,
      `data: ${JSON.stringify(fixture.snapshot)}`,
      "",
      `event: workflow_result`,
      `data: ${JSON.stringify(fixture.resultFrame)}`,
      "",
    ].join("\n");
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Napier-Workflow-Manifest-SHA256": fixture.manifest.contentSha256,
        "X-Napier-Workflow-Blueprint-SHA256":
          fixture.manifest.blueprint.contentSha256,
        "X-Napier-Workflow-Version": String(fixture.manifest.version),
        "X-Napier-Workflow-Node-Count": String(fixture.manifest.nodeCount),
        "X-Napier-Workflow-Max-Concurrency": "1",
      },
    },
  );
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

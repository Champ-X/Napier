import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  RunEvent,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  projectWorkflowBreakpoint,
  workflowBreakpointManifestMatches,
} from "../src/workflow-breakpoint-view-model";

describe("Workflow breakpoint Workbench projection", () => {
  it("projects one open bound breakpoint and accepts only its exact Manifest", () => {
    const projection = projectWorkflowBreakpoint(
      [plan()],
      [started(), reached()],
    );

    expect(projection).toEqual({
      status: "open",
      breakpoint: expect.objectContaining({
        planId: "plan_abcdefghijklmnopqrst",
        nodeId: "write",
        breakpointIndex: 1,
        breakpointCount: 2,
        reachedEventSeq: 2,
        planRevision: 3,
      }),
    });
    if (projection.status !== "open") throw new Error("Expected breakpoint");
    expect(
      workflowBreakpointManifestMatches(
        projection.breakpoint,
        manifest(["prepare", "write"]),
      ),
    ).toBe(true);
    expect(
      workflowBreakpointManifestMatches(
        projection.breakpoint,
        manifest(["write", "prepare"]),
      ),
    ).toBe(false);
    expect(
      workflowBreakpointManifestMatches(projection.breakpoint, {
        ...manifest(["prepare", "write"]),
        contentSha256: "9".repeat(64),
      }),
    ).toBe(false);
  });

  it("removes a consumed breakpoint and rejects forged continuation evidence", () => {
    expect(
      projectWorkflowBreakpoint([plan()], [started(), reached(), continued()]),
    ).toEqual({ status: "none" });
    expect(
      projectWorkflowBreakpoint(
        [plan()],
        [
          started(),
          reached(),
          {
            ...continued(),
            payload: {
              ...(continued().payload as Record<string, JsonValue>),
              bindingContextSha256: "8".repeat(64),
            },
          },
        ],
      ),
    ).toEqual({ status: "invalid", reason: "evidence_ambiguous" });
    const missingPlan = structuredClone(reached());
    delete (missingPlan.payload as Record<string, JsonValue>)["planId"];
    expect(
      projectWorkflowBreakpoint([plan()], [started(), missingPlan]),
    ).toEqual({ status: "invalid", reason: "evidence_invalid" });
  });

  it("fails visible when the ready Plan revision drifts", () => {
    expect(
      projectWorkflowBreakpoint(
        [{ ...plan(), revision: 4 }],
        [started(), reached()],
      ),
    ).toEqual({ status: "invalid", reason: "plan_drift" });
  });

  it("rejects ambiguous active Plans and a start recorded after the hold", () => {
    expect(
      projectWorkflowBreakpoint(
        [
          plan(),
          {
            ...plan(),
            id: "plan_zyxwvutsrqponmlkjihg",
          },
        ],
        [started(), reached()],
      ),
    ).toEqual({ status: "invalid", reason: "plan_ambiguous" });
    expect(
      projectWorkflowBreakpoint(
        [plan()],
        [{ ...started(), seq: 3 }, reached()],
      ),
    ).toEqual({ status: "invalid", reason: "evidence_ambiguous" });
  });
});

function plan(): ExecutionPlan {
  return {
    id: "plan_abcdefghijklmnopqrst",
    status: "active",
    revision: 3,
    readyStepIds: ["write"],
    steps: [
      { id: "prepare", status: "completed" },
      { id: "write", status: "ready" },
    ],
  } as ExecutionPlan;
}

function manifest(nodeIds: string[]): ExecutionPlanWorkflowManifest {
  return {
    contentSha256: "1".repeat(64),
    nodes: nodeIds.map((id) => ({ id })),
  } as ExecutionPlanWorkflowManifest;
}

function started(): RunEvent {
  return event(1, "workflow.started", {
    schemaVersion: 1,
    planId: "plan_abcdefghijklmnopqrst",
    manifestSha256: "1".repeat(64),
    breakBeforeNodeIds: ["prepare", "write"],
  });
}

function reached(): RunEvent {
  return event(2, "workflow.breakpoint.reached", {
    schemaVersion: 1,
    planId: "plan_abcdefghijklmnopqrst",
    manifestSha256: "1".repeat(64),
    nodeId: "write",
    breakpointIndex: 1,
    breakpointCount: 2,
    bindingContextSha256: "2".repeat(64),
    planRevision: 3,
  });
}

function continued(): RunEvent {
  return event(3, "workflow.breakpoint.continued", {
    ...(reached().payload as Record<string, JsonValue>),
    reachedEventSeq: 2,
  });
}

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `evt_${String(seq).padStart(8, "0")}`,
    threadId: "thread_abcdefghijklmnopqrst",
    runId: "runctl_abcdefghijklmnopqrst",
    seq,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-08-01T00:00:00.000Z",
    payload,
  };
}

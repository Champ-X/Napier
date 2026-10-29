import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "@napier/contracts";
import {
  projectTaskDeliverables,
  taskArtifactBinding,
} from "@napier/contracts/task-narrative";

import { isTaskNarrativeProjection } from "../src/task-narrative-protocol";

describe("Task Narrative protocol", () => {
  it("validates optional recorder identity and time while accepting legacy history", () => {
    const artifact = {
      id: "report",
      path: "report.txt",
      kind: "file",
      description: "Report",
      evidence: "Recorded assertion",
      status: "verified",
      sha256: "a".repeat(64),
      sizeBytes: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const version = {
      planId: "plan_a",
      artifactId: "report",
      source: "recorded_assertion",
      eventId: "event_a",
      eventSeq: 1,
      planRevision: 2,
    };
    const withVersion = (candidate: unknown) => ({
      phase: "ended",
      phaseLabel: "Ended",
      currentAction: "Inspect",
      completedItems: [],
      deliverables: [
        {
          path: artifact.path,
          source: "plan",
          planId: "plan_a",
          planRevision: 2,
          artifact,
          accessibility: "unchecked",
          verification: "integrity_recorded",
          previousVersions: [],
          currentVersion: candidate,
        },
      ],
    });
    expect(isTaskNarrativeProjection(withVersion(version))).toBe(true);
    expect(
      isTaskNarrativeProjection(
        withVersion({
          ...version,
          eventRunId: "run_a",
          eventCreatedAt: "2026-01-01T00:00:00Z",
        }),
      ),
    ).toBe(true);
    for (const invalid of [
      { eventRunId: 2 },
      { eventCreatedAt: 2 },
      { eventCreatedAt: "invalid" },
    ]) {
      expect(
        isTaskNarrativeProjection(withVersion({ ...version, ...invalid })),
      ).toBe(false);
    }
  });

  it("accepts the bounded server projection and rejects malformed items", () => {
    expect(
      isTaskNarrativeProjection({
        phase: "working",
        phaseLabel: "Working",
        currentAction: "Running web search",
        completedItems: ["Read 2 files"],
        metricRunId: "run_1",
      }),
    ).toBe(true);
    expect(
      isTaskNarrativeProjection({
        phase: "working",
        phaseLabel: "Working",
        currentAction: "Invalid",
        completedItems: "not-an-array",
      }),
    ).toBe(false);
  });
  it("validates the execution, acceptance and deliverable facts independently", () => {
    const projection = {
      phase: "ended",
      phaseLabel: "Run ended",
      currentAction: "Inspect",
      completedItems: [],
      execution: "ended",
      objective: { status: "unverified", reason: "No grader", evidence: [] },
      remainingItems: [],
      processItems: [],
      deliverables: [],
    };
    expect(isTaskNarrativeProjection(projection)).toBe(true);
    expect(
      isTaskNarrativeProjection({
        ...projection,
        objective: { status: "accepted" },
      }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({ ...projection, execution: "success" }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({
        ...projection,
        deliverables: [{ path: "fake" }],
      }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({ ...projection, processItems: [2] }),
    ).toBe(false);
  });

  it("validates observation and historical metadata bindings while retaining legacy snapshots", () => {
    const p = {
      id: "plan_a",
      threadId: "thread_a",
      revision: 2,
      status: "active",
      artifacts: [
        {
          id: "report",
          path: "report.txt",
          kind: "file",
          description: "Report",
          status: "verified",
          evidence: "asserted",
          sha256: "a".repeat(64),
          sizeBytes: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    } as ExecutionPlan;
    const entry = projectTaskDeliverables([p])[0]!;
    const value = {
      phase: "ended",
      phaseLabel: "Ended",
      currentAction: "Inspect",
      completedItems: [],
      deliverables: [
        {
          ...entry,
          verification: "integrity_observed",
          observation: {
            source: "workspace",
            status: "matched",
            bindingSha256: taskArtifactBinding(entry),
            sha256: "a".repeat(64),
            sizeBytes: 1,
          },
        },
      ],
    };
    expect(isTaskNarrativeProjection(value)).toBe(true);
    for (const mutate of [
      (v: typeof value) => {
        v.deliverables[0]!.observation.bindingSha256 = "b".repeat(64);
      },
      (v: typeof value) => {
        v.deliverables[0]!.observation.sha256 = "b".repeat(64);
      },
      (v: typeof value) => {
        v.deliverables[0]!.artifact.path = "other.txt";
      },
    ]) {
      const corrupted = structuredClone(value);
      mutate(corrupted);
      expect(isTaskNarrativeProjection(corrupted)).toBe(false);
    }
    expect(
      isTaskNarrativeProjection({
        ...value,
        deliverables: [{ ...entry, verification: "integrity_recorded" }],
      }),
    ).toBe(true);
    expect(
      isTaskNarrativeProjection({
        ...value,
        deliverables: [{ ...entry, history: { status: "complete" } }],
      }),
    ).toBe(false);
    expect(
      isTaskNarrativeProjection({
        ...value,
        deliverables: [
          {
            ...entry,
            previousVersions: [
              {
                planId: p.id,
                artifactId: "report",
                source: "recorded_assertion",
                eventId: "event",
                eventSeq: -1,
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});

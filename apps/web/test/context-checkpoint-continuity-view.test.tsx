import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { ContextCheckpointContinuityLedger } from "../src/ContextCheckpointContinuityLedger";
import { contextCheckpointContinuityViews } from "../src/context-checkpoint-continuity-view";

describe("context checkpoint continuity view", () => {
  it("projects an atomic execution-continuity binding", () => {
    const views = contextCheckpointContinuityViews([checkpointEvent()]);

    expect(views).toEqual([
      expect.objectContaining({
        eventSeq: 45,
        state: "bound",
        fromSeq: 1,
        toSeq: 40,
        retainedFromSeq: 41,
        sourceEventCount: 24,
        continuityEventCount: 8,
        decisionCount: 1,
        openLoopCount: 1,
        artifactCount: 1,
      }),
    ]);
  });

  it("rejects partial or malformed continuity bindings", () => {
    const valid = checkpointEvent();
    const payload = asRecord(valid.payload);
    expect(
      contextCheckpointContinuityViews([
        { ...valid, payload: { ...payload, continuitySha256: undefined } },
        { ...valid, payload: { ...payload, continuityEventCount: -1 } },
        { ...valid, payload: { ...payload, continuitySha256: "not-a-hash" } },
      ]),
    ).toEqual([]);
  });

  it("labels legacy checkpoints without inventing an execution binding", () => {
    const valid = checkpointEvent();
    const {
      continuityProjectionVersion: _version,
      continuityEventCount: _count,
      continuitySha256: _hash,
      ...legacyPayload
    } = asRecord(valid.payload);
    const [legacy] = contextCheckpointContinuityViews([
      { ...valid, payload: legacyPayload },
    ]);
    const text = visibleText(
      ContextCheckpointContinuityLedger({ checkpoints: legacy ? [legacy] : [] }),
    );

    expect(legacy?.state).toBe("legacy_unbound");
    expect(text).toContain("Legacy message-only checkpoint");
    expect(text).toContain("Execution bindingLegacy unavailable");
    expect(text).not.toContain("TOP_SECRET_EXECUTION_STATE");
  });
});

function checkpointEvent(): RunEvent {
  return {
    id: "event_checkpoint_45",
    threadId: "thread_1",
    runId: "run_1",
    seq: 45,
    type: "context.compaction.completed",
    category: "system",
    visibility: "user",
    createdAt: "2026-08-19T00:00:00.000Z",
    payload: {
      schemaVersion: 1,
      checkpointId: "checkpoint_1",
      fromSeq: 1,
      toSeq: 40,
      retainedFromSeq: 41,
      sourceEventCount: 24,
      sourceSha256: "a".repeat(64),
      summarySha256: "b".repeat(64),
      summary: "Continue from the verified handoff.",
      decisions: ["Keep the workspace boundary."],
      openLoops: ["Run final verification."],
      artifacts: ["artifacts/report.md"],
      continuityProjectionVersion: 1,
      continuityEventCount: 8,
      continuitySha256: "c".repeat(64),
    },
  };
}

function asRecord(value: RunEvent["payload"]): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (!value || typeof value !== "object") return "";
  const props = (value as { props?: { children?: unknown } }).props;
  return props ? visibleText(props.children) : "";
}

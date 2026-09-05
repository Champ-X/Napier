import type { JsonObject, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { RunProgressEvidenceProjector } from "../src/run-progress-evidence-projector.js";

const RUN_ID = "run_evidence_causality";
const THREAD_ID = "thread_evidence_causality";
const RESOURCE = sha256("resource");
const DOMAIN = sha256("domain");
const DESCRIPTOR = sha256("descriptor");
const PHASE = sha256("phase");

describe("RunProgressEvidenceProjector causality", () => {
  it("is invariant to event batch partitioning for compound operations", () => {
    const events = compoundOperationEvents();
    const whole = new RunProgressEvidenceProjector(RUN_ID, sha256("task"));
    whole.ingest(events);

    const partitioned = new RunProgressEvidenceProjector(
      RUN_ID,
      sha256("task"),
    );
    partitioned.ingest(events.slice(0, 2));
    partitioned.ingest(events.slice(2, 5));
    partitioned.ingest(events.slice(5));

    expect(partitioned.metrics()).toEqual(whole.metrics());
    expect(whole.metrics()).toMatchObject({
      acquisitionAttemptCount: 1,
      acquisitionAdvanceCountSinceProgress: 1,
      supportCount: 1,
    });
  });

  it("treats the first Run terminal event as the end of progress evidence", () => {
    const progress = {
      availability: "declared",
      coverage: "trusted_declared",
      operation: "acquire",
      scope: "external",
      contribution: "supporting",
      resourceKeySha256: RESOURCE,
      failureDomainKeySha256: DOMAIN,
    };
    const projector = new RunProgressEvidenceProjector(RUN_ID, sha256("task"));
    projector.ingest([
      event(1, "tool.started", {
        callId: "late-parent",
        toolProtocol: { progress },
      }),
      event(2, "run.failed", {
        status: "failed",
        outcome: "blocked_safety",
      }),
    ]);
    projector.ingest([
      event(3, "tool.failed", {
        callId: "late-parent",
        toolProtocol: { progress },
        toolFailure: {
          class: "unknown",
          scope: "invocation",
          disposition: "terminal",
          fatalToSession: false,
          diagnosticSha256: sha256("late failure"),
        },
      }),
    ]);

    expect(projector.metrics()).toMatchObject({
      acquisitionAttemptCount: 0,
      failureFingerprints: new Set(),
      failureDomains: new Set(),
    });
  });
});

function compoundOperationEvents(): RunEvent[] {
  const parentProgress = {
    availability: "declared",
    coverage: "trusted_declared",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKeySha256: RESOURCE,
    failureDomainKeySha256: DOMAIN,
  };
  const child = {
    parentCallId: "parent",
    operationId: "child",
    ordinal: 1,
    mode: "fallback",
    route: "provider",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKeySha256: RESOURCE,
    failureDomainKeySha256: DOMAIN,
    descriptorSha256: DESCRIPTOR,
  };
  return [
    event(1, "tool.started", {
      callId: "parent",
      toolProtocol: { progress: parentProgress },
    }),
    event(2, "tool.admitted", {
      callId: "parent",
      toolProtocol: { progress: parentProgress },
    }),
    event(3, "tool.operation.proposed", {
      ...child,
      phaseStateSha256: PHASE,
    }),
    event(4, "tool.operation.admitted", {
      ...child,
      admission: "admitted",
      phaseStateSha256: PHASE,
    }),
    event(5, "tool.operation.started", {
      ...child,
      phaseStateSha256: PHASE,
    }),
    event(6, "tool.operation.settled", {
      ...child,
      outcome: "succeeded",
      stateSha256: sha256("state"),
      effectSha256: sha256("effect"),
      phaseStateSha256: PHASE,
    }),
    event(7, "tool.completed", {
      callId: "parent",
      toolProtocol: { progress: parentProgress },
    }),
  ];
}

function event(seq: number, type: string, payload: JsonObject): RunEvent {
  return {
    id: `event-${seq}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: "debug",
    visibility: "hidden",
    createdAt: new Date(Date.UTC(2026, 8, 3, 0, 0, seq)).toISOString(),
    payload,
    schemaVersion: 1,
  };
}

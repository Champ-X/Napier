import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  guardRunFailureCircuit,
  failureCircuitKey,
  matchRunFailureCircuits,
  projectRunFailureCircuits,
  resolveRunFailureCircuit,
} from "../src/run-failure-circuit-projection.js";
import type { ToolFailureSemantics } from "../src/tool-failure-semantics.js";

const RUN_ID = "run_failure_circuit";
const TARGET_A = sha256("target:a");
const TARGET_B = sha256("target:b");
const DOMAIN = sha256("origin:example.test");
const OTHER_DOMAIN = sha256("origin:other.test");
const FAILURE_DEFINITION = sha256("failure-definition:v1");
const ACTUAL_PROVIDER_ROUTE = sha256("provider:actual");

describe("run failure circuit projection", () => {
  it("ignores tool outcomes recorded after the Run terminal fence", () => {
    const projection = projectRunFailureCircuits(
      [
        ledgerEvent(1, "run.failed", {
          status: "failed",
          outcome: "blocked_safety",
        }),
        failed(2, "late", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
      ],
      RUN_ID,
    );

    expect(projection.entries).toEqual([]);
    expect(projection.throughSeq).toBe(1);
  });

  it("does not promote a target failure into an origin circuit", () => {
    const targetProjection = projectRunFailureCircuits(
      [
        failed(1, "target-a", TARGET_A, DOMAIN, {
          class: "not_found",
          scope: "target",
          disposition: "terminal",
        }),
      ],
      RUN_ID,
    );

    expect(
      guardRunFailureCircuit(
        targetProjection,
        progress(TARGET_A, DOMAIN),
        time(1),
      ),
    ).toMatchObject({ scope: "target", status: "open", blocks: true });
    expect(
      guardRunFailureCircuit(
        targetProjection,
        progress(TARGET_B, DOMAIN),
        time(1),
      ),
    ).toBeUndefined();

    const originProjection = projectRunFailureCircuits(
      [
        failed(1, "origin-a", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 1 } } },
    );
    expect(
      guardRunFailureCircuit(
        originProjection,
        progress(TARGET_B, DOMAIN),
        time(1),
      ),
    ).toMatchObject({ scope: "origin", status: "open", blocks: true });
  });

  it("keeps route, capability, and session failures in separate domains", () => {
    const projection = projectRunFailureCircuits(
      [
        failed(1, "route", TARGET_A, DOMAIN, {
          class: "rate_limited",
          scope: "route",
          disposition: "retry_after",
          retryAfterMs: 5_000,
        }),
        failed(2, "capability", TARGET_A, DOMAIN, {
          class: "unavailable",
          scope: "capability",
          disposition: "terminal",
        }),
        failed(3, "session", TARGET_A, DOMAIN, {
          class: "session_state",
          scope: "session",
          disposition: "recover_state",
          fatalToSession: true,
        }),
      ],
      RUN_ID,
    );

    expect(projection.entries.map((entry) => entry.scope)).toEqual([
      "session",
      "capability",
      "route",
    ]);
    expect(
      matchRunFailureCircuits(
        projection,
        progress(TARGET_B, DOMAIN),
        time(3),
      ).map(({ scope, status }) => ({ scope, status })),
    ).toEqual([
      { scope: "session", status: "open" },
      { scope: "capability", status: "open" },
      { scope: "route", status: "open" },
    ]);
  });

  it("turns retry-after circuits half-open only after their bounded TTL", () => {
    const first = failed(1, "rate-limit-1", TARGET_A, DOMAIN, {
      class: "rate_limited",
      scope: "route",
      disposition: "retry_after",
      retryAfterMs: 5_000,
    });
    const projection = projectRunFailureCircuits([first], RUN_ID);
    const entry = projection.entries[0]!;

    expect(resolveRunFailureCircuit(entry, time(1, 4_999))).toMatchObject({
      status: "open",
      blocks: true,
      retryAfterMs: 1,
    });
    expect(resolveRunFailureCircuit(entry, time(1, 5_000))).toMatchObject({
      status: "half_open",
      blocks: false,
    });

    const reprojection = projectRunFailureCircuits(
      [
        first,
        failed(
          2,
          "rate-limit-2",
          TARGET_A,
          DOMAIN,
          {
            class: "rate_limited",
            scope: "route",
            disposition: "retry_after",
            retryAfterMs: 4_000,
          },
          5_000,
        ),
      ],
      RUN_ID,
    );
    expect(
      guardRunFailureCircuit(
        reprojection,
        progress(TARGET_A, DOMAIN),
        time(2, 5_500),
      ),
    ).toMatchObject({ status: "open", retryAfterMs: 3_500 });
  });

  it("decays closed pressure and closes open or recover-state circuits on success", () => {
    const oneFailureThenSuccess = projectRunFailureCircuits(
      [
        failed(1, "fail-one", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
        completed(2, "success-one", TARGET_A, DOMAIN),
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 2 } } },
    );
    expect(oneFailureThenSuccess.entries[0]).toMatchObject({
      scope: "origin",
      failureCount: 0,
      successCount: 1,
    });

    const recovered = projectRunFailureCircuits(
      [
        failed(1, "session-fail", TARGET_A, DOMAIN, {
          class: "session_state",
          scope: "session",
          disposition: "recover_state",
          fatalToSession: true,
        }),
        completed(2, "session-recovered", TARGET_A, DOMAIN),
      ],
      RUN_ID,
    );
    expect(recovered.entries[0]).toMatchObject({
      scope: "session",
      failureCount: 0,
      recoveryEpoch: 1,
      recoveryRequired: false,
    });
    expect(
      resolveRunFailureCircuit(recovered.entries[0]!, time(2)),
    ).toMatchObject({ status: "closed", blocks: false });
  });

  it("advances failure windows only for real terminals and replays epochs deterministically", () => {
    const oldFailure = failed(1, "old", TARGET_A, DOMAIN, {
      class: "timeout",
      scope: "origin",
      disposition: "alternate_route",
    });
    const unrelated = ledgerEvent(5, "message.assistant", { text: "progress" });
    const recentFailure = failed(6, "recent", TARGET_A, DOMAIN, {
      class: "timeout",
      scope: "origin",
      disposition: "alternate_route",
    });
    const events = [recentFailure, oldFailure, unrelated];
    const projection = projectRunFailureCircuits(events, RUN_ID, {
      policy: {
        failureWindowEventSpan: 3,
        thresholds: { origin: 2 },
      },
    });
    const replay = projectRunFailureCircuits([...events].reverse(), RUN_ID, {
      policy: {
        failureWindowEventSpan: 3,
        thresholds: { origin: 2 },
      },
    });

    expect(projection).toEqual(replay);
    expect(projection.entries[0]).toMatchObject({
      failureCount: 2,
      openedAtSeq: 6,
    });

    const agedByRealAttempts = projectRunFailureCircuits(
      [
        oldFailure,
        completed(2, "other-1", TARGET_B, OTHER_DOMAIN),
        completed(3, "other-2", TARGET_B, OTHER_DOMAIN),
        completed(4, "other-3", TARGET_B, OTHER_DOMAIN),
        recentFailure,
      ],
      RUN_ID,
      {
        policy: {
          failureWindowEventSpan: 3,
          thresholds: { origin: 2 },
        },
      },
    );
    expect(agedByRealAttempts.entries[0]).toMatchObject({ failureCount: 1 });
    expect(agedByRealAttempts.entries[0]).not.toHaveProperty("openedAtSeq");

    const nextEpoch = projectRunFailureCircuits(
      [
        oldFailure,
        ledgerEvent(2, "run.control.delivered", { text: "new task" }),
        failed(3, "new-epoch", TARGET_A, DOMAIN, {
          class: "not_found",
          scope: "target",
          disposition: "terminal",
        }),
      ],
      RUN_ID,
    );
    expect(nextEpoch).toMatchObject({ epoch: 1, epochStartedAtSeq: 2 });
    expect(nextEpoch.entries).toHaveLength(1);
    expect(nextEpoch.entries[0]).toMatchObject({ epoch: 1, scope: "target" });
  });

  it("honors the first terminal receipt for each call", () => {
    const failure = failed(2, "same-call", TARGET_A, DOMAIN, {
      class: "not_found",
      scope: "target",
      disposition: "terminal",
    });
    const projection = projectRunFailureCircuits(
      [completed(1, "same-call", TARGET_A, DOMAIN), failure],
      RUN_ID,
    );
    expect(projection.entries).toEqual([]);
  });

  it("does not let rejection bookkeeping evict durable failure evidence", () => {
    const events: RunEvent[] = [
      failed(1, "origin-failure", TARGET_A, DOMAIN, {
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
      }),
    ];
    for (let ordinal = 0; ordinal < 30; ordinal += 1) {
      events.push(...rejectedChild(2 + ordinal * 3, `rejected-${ordinal}`));
    }
    const projection = projectRunFailureCircuits(events, RUN_ID, {
      policy: {
        failureWindowEventSpan: 3,
        thresholds: { origin: 1 },
      },
    });
    expect(projection.entries[0]).toMatchObject({
      failureCount: 1,
      lifetimeFailureCount: 1,
      openedAtSeq: 1,
    });
  });

  it("suppresses a parent only after a causally completed child", () => {
    const parentFailure = failed(3, "compound", TARGET_A, DOMAIN, {
      class: "timeout",
      scope: "origin",
      disposition: "alternate_route",
    });
    const proposedOnly = projectRunFailureCircuits(
      [
        ledgerEvent(1, "tool.started", parentFailure.payload as JsonObject),
        childEvent(2, "tool.operation.proposed", "child-proposed", {
          parentCallId: "compound",
        }),
        parentFailure,
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 1 } } },
    );
    expect(proposedOnly.entries[0]).toMatchObject({ openedAtSeq: 3 });

    const futureChild = projectRunFailureCircuits(
      [
        parentFailure,
        ...rejectedChild(4, "future-child", "skipped", "compound"),
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 1 } } },
    );
    expect(futureChild.entries[0]).toMatchObject({ openedAtSeq: 3 });
  });

  it("does not count an execution authority as a second domain failure", () => {
    const events = [
      ...failedChild(1, "provider", "compound"),
      ...failedChild(5, "authority", "compound", "execution_authority"),
      failed(9, "compound", TARGET_A, DOMAIN, {
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
      }),
    ];
    const projection = projectRunFailureCircuits(events, RUN_ID, {
      policy: { thresholds: { origin: 2 } },
    });

    expect(projection.entries[0]).toMatchObject({
      scope: "origin",
      failureCount: 1,
      lifetimeFailureCount: 1,
    });
    expect(projection.entries[0]).not.toHaveProperty("openedAtSeq");
  });

  it("accepts an auto-search child receipt bound to the selected provider", () => {
    const projection = projectRunFailureCircuits(
      typedFailedChild(
        1,
        "provider-selected-from-auto",
        ACTUAL_PROVIDER_ROUTE,
        ACTUAL_PROVIDER_ROUTE,
      ),
      RUN_ID,
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      scope: "route",
      bindingSha256: ACTUAL_PROVIDER_ROUTE,
      lastFailureClass: "network",
    });
  });

  it("fails a same-operation binding mismatch closed at invocation scope", () => {
    const projection = projectRunFailureCircuits(
      typedFailedChild(
        1,
        "forged-provider-binding",
        ACTUAL_PROVIDER_ROUTE,
        sha256("provider:forged"),
      ),
      RUN_ID,
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      scope: "invocation",
      lastFailureClass: "unknown",
      lastDisposition: "terminal",
    });
  });

  it("rejects a typed receipt not bound to the recorded failure definition", () => {
    const events = typedFailedChild(
      1,
      "forged-definition",
      ACTUAL_PROVIDER_ROUTE,
      ACTUAL_PROVIDER_ROUTE,
    );
    const terminal = events.at(-1)!;
    terminal.payload = {
      ...terminal.payload,
      failure: {
        ...(terminal.payload["failure"] as JsonObject),
        failureDefinitionSha256: sha256("unrelated-definition"),
      },
    };
    const projection = projectRunFailureCircuits(events, RUN_ID);

    expect(projection.entries[0]).toMatchObject({
      scope: "invocation",
      lastFailureClass: "unknown",
    });
  });

  it("does not let invalid-declaration evidence claim a shared circuit", () => {
    const events = typedFailedChild(
      1,
      "invalid-declaration-scope",
      ACTUAL_PROVIDER_ROUTE,
      ACTUAL_PROVIDER_ROUTE,
    );
    const terminal = events.at(-1)!;
    terminal.payload = {
      ...terminal.payload,
      failure: {
        ...(terminal.payload["failure"] as JsonObject),
        coverage: "invalid_declared",
        classificationErrorSha256: sha256("invalid resolver output"),
      },
    };

    expect(projectRunFailureCircuits(events, RUN_ID).entries[0]).toMatchObject({
      scope: "invocation",
      lastFailureClass: "unknown",
      lastDisposition: "terminal",
    });
  });

  it("rejects impossible child success transitions and resets identities by epoch", () => {
    const forgedSuccess = projectRunFailureCircuits(
      [
        failed(1, "before", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
        ...rejectedChild(2, "forged", "succeeded"),
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 1 } } },
    );
    expect(forgedSuccess.entries[0]).toMatchObject({
      openedAtSeq: 1,
      successCount: 0,
    });

    const reusedCall = projectRunFailureCircuits(
      [
        failed(1, "same", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
        ledgerEvent(2, "run.control.delivered", { text: "new epoch" }),
        failed(3, "same", TARGET_A, DOMAIN, {
          class: "timeout",
          scope: "origin",
          disposition: "alternate_route",
        }),
      ],
      RUN_ID,
      { policy: { thresholds: { origin: 1 } } },
    );
    expect(reusedCall.entries[0]).toMatchObject({ epoch: 1, openedAtSeq: 3 });
  });
});

function rejectedChild(
  seq: number,
  operationId: string,
  outcome: "skipped" | "succeeded" = "skipped",
  parentCallId = `parent-${operationId}`,
): RunEvent[] {
  return [
    childEvent(seq, "tool.operation.proposed", operationId, {
      parentCallId,
    }),
    childEvent(seq + 1, "tool.operation.admitted", operationId, {
      admission: "rejected",
      admissionSource: "failure_circuit",
      circuitStatus: "open",
      circuitScope: "origin",
      circuitKeySha256: failureCircuitKey("origin", DOMAIN),
      circuitEpoch: 0,
      circuitThroughSeq: seq,
    }),
    childEvent(seq + 2, "tool.operation.settled", operationId, { outcome }),
  ];
}

function failedChild(
  seq: number,
  operationId: string,
  parentCallId: string,
  role?: "execution_authority",
): RunEvent[] {
  return [
    childEvent(seq, "tool.operation.proposed", operationId, {
      parentCallId,
      ...(role ? { role } : {}),
    }),
    childEvent(seq + 1, "tool.operation.admitted", operationId, {
      parentCallId,
      admission: "admitted",
      ...(role ? { role } : {}),
    }),
    childEvent(seq + 2, "tool.operation.started", operationId, {
      parentCallId,
      ...(role ? { role } : {}),
    }),
    childEvent(seq + 3, "tool.operation.settled", operationId, {
      parentCallId,
      outcome: "failed",
      failure: {
        class: "timeout",
        scope: "origin",
        disposition: "alternate_route",
        fatalToSession: false,
        diagnosticSha256: sha256(`diagnostic:${operationId}`),
      },
      ...(role ? { role } : {}),
    }),
  ];
}

function typedFailedChild(
  seq: number,
  operationId: string,
  progressRouteBinding: string,
  receiptRouteBinding: string,
): RunEvent[] {
  const common: JsonObject = {
    parentCallId: "auto-search-parent",
    failureDefinitionSha256: FAILURE_DEFINITION,
    failureBindings: { route: progressRouteBinding },
  };
  return [
    childEvent(seq, "tool.operation.proposed", operationId, common),
    childEvent(seq + 1, "tool.operation.admitted", operationId, {
      ...common,
      admission: "admitted",
    }),
    childEvent(seq + 2, "tool.operation.started", operationId, common),
    childEvent(seq + 3, "tool.operation.settled", operationId, {
      ...common,
      outcome: "failed",
      failure: {
        kind: "napier.tool-failure-semantics",
        schemaVersion: 1,
        coverage: "trusted_declared",
        modeId: "route_network",
        class: "network",
        scope: "route",
        disposition: "alternate_route",
        fatalToSession: false,
        failureDefinitionSha256: FAILURE_DEFINITION,
        bindingSha256: receiptRouteBinding,
        diagnosticSha256: sha256(`diagnostic:${operationId}`),
      },
    }),
  ];
}

function childEvent(
  seq: number,
  type: string,
  operationId: string,
  extra: JsonObject = {},
): RunEvent {
  return ledgerEvent(seq, type, {
    operationId,
    parentCallId: `parent-${operationId}`,
    operation: "acquire",
    contribution: "supporting",
    resourceKeySha256: TARGET_A,
    failureDomainKeySha256: DOMAIN,
    ...extra,
  });
}

function progress(resourceKeySha256: string, failureDomainKeySha256: string) {
  return {
    resourceKeySha256,
    failureDomainKeySha256,
  };
}

function failed(
  seq: number,
  callId: string,
  resourceKeySha256: string,
  failureDomainKeySha256: string,
  failure: Omit<ToolFailureSemantics, "fatalToSession" | "diagnosticSha256"> & {
    fatalToSession?: boolean;
    retryAfterMs?: number;
  },
  elapsedMs = 0,
): RunEvent {
  return ledgerEvent(
    seq,
    "tool.failed",
    {
      callId,
      toolName: "fixture",
      toolProtocol: {
        progress: progressReceipt(resourceKeySha256, failureDomainKeySha256),
      },
      toolFailure: {
        ...failure,
        fatalToSession: failure.fatalToSession ?? false,
        diagnosticSha256: sha256(`diagnostic:${callId}`),
      },
    },
    elapsedMs,
  );
}

function completed(
  seq: number,
  callId: string,
  resourceKeySha256: string,
  failureDomainKeySha256: string,
): RunEvent {
  return ledgerEvent(seq, "tool.completed", {
    callId,
    toolName: "fixture",
    toolProtocol: {
      progress: progressReceipt(resourceKeySha256, failureDomainKeySha256),
    },
  });
}

function progressReceipt(
  resourceKeySha256: string,
  failureDomainKeySha256: string,
): JsonObject {
  return {
    kind: "napier.tool-progress-semantics",
    schemaVersion: 1,
    availability: "declared",
    coverage: "trusted_declared",
    operation: "acquire",
    scope: "external",
    contribution: "supporting",
    resourceKeySha256,
    failureDomainKeySha256,
  };
}

function ledgerEvent(
  seq: number,
  type: string,
  payload: JsonObject,
  elapsedMs = 0,
): RunEvent {
  return {
    id: `event-${String(seq).padStart(3, "0")}-${type}`,
    threadId: "thread_failure_circuit",
    runId: RUN_ID,
    seq,
    type,
    category: "debug",
    visibility: "hidden",
    createdAt: time(seq, elapsedMs),
    payload,
    schemaVersion: 1,
  };
}

function time(seq: number, elapsedMs = 0): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seq) + elapsedMs).toISOString();
}

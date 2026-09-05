import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  DEFAULT_RUN_CONVERGENCE_POLICY,
  type RunConvergenceSnapshot,
} from "../src/run-convergence-policy.js";
import {
  createRunControlMessageDeliveredPayload,
  createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload,
  nextPendingRunControlMessage,
} from "../src/run-control-messages.js";
import { createRunDecisionReceipt } from "../src/run-progress-decision-receipt.js";
import type { RunDirectiveState } from "../src/run-progress-directive-state.js";
import { projectRunDirectiveState } from "../src/run-progress-directive-state.js";
import { projectRunProgressVectorContent } from "../src/run-progress-ledger-projection.js";
import {
  projectValidatedRunProgressLedger,
  projectValidatedVectorChain,
  RunProgressPayloadValidationError,
} from "../src/run-progress-payload-codec.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";

const RUN_ID = "run_codec_test";
const THREAD_ID = "thread_codec_test";
const EMPTY_HASH = sha256(canonicalJson([]));

describe("strict Run progress payload codec", () => {
  it("validates a current vector chain and rejects payloads with valid-looking forged hashes", () => {
    const first = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const second = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
    });
    const events = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      runEvent(3, "turn.completed", {}),
      runEvent(4, "run.progress.vector", second),
    ];

    expect(projectValidatedVectorChain(events, RUN_ID)).toEqual([
      expect.objectContaining({
        sourceSchemaVersion: 2,
        turnIndex: 1,
        eventSeq: 2,
      }),
      expect.objectContaining({
        sourceSchemaVersion: 2,
        turnIndex: 2,
        eventSeq: 4,
        predecessorContentSha256: first.contentSha256,
      }),
    ]);

    const forgedProjection = rehash({ ...first, projectionId: hash("forged") });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", forgedProjection),
          ],
          RUN_ID,
        ),
      "projection_id",
    );

    const tampered = { ...first, stagnantTurnCount: 99 };
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", tampered),
          ],
          RUN_ID,
        ),
      "content_hash",
    );
  });

  it("rejects missing completed-turn bindings, broken predecessors and regressing cursors", () => {
    const first = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const broken = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: hash("not-first"),
      stagnantTurnCount: 2,
    });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", first),
            runEvent(3, "turn.completed", {}),
            runEvent(4, "run.progress.vector", broken),
          ],
          RUN_ID,
        ),
      "vector_chain",
    );

    const regressed = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
      elapsedMs: 50,
    });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", first),
            runEvent(3, "turn.completed", {}),
            runEvent(4, "run.progress.vector", regressed),
          ],
          RUN_ID,
        ),
      "vector_monotonicity",
    );

    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [runEvent(2, "run.progress.vector", first)],
          RUN_ID,
        ),
      "turn_binding",
    );
  });

  it("fails closed in the real tracker and directive recovery paths", async () => {
    const first = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const broken = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: hash("broken-parent"),
      stagnantTurnCount: 2,
    });
    const brokenLedger = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      runEvent(3, "turn.completed", {}),
      runEvent(4, "run.progress.vector", broken),
    ];
    const fakeStore = {
      listRunEvents: async () => brokenLedger,
    };
    await expect(
      RunProgressTracker.create(
        fakeStore as never,
        {
          id: RUN_ID,
          threadId: THREAD_ID,
          startedAt: new Date(0).toISOString(),
        },
        undefined,
        undefined,
        {
          maxTurns: 16,
          maxTotalTokens: 100_000,
          maxCostUsd: 10,
          timeoutMs: 300_000,
        },
      ),
    ).rejects.toMatchObject({ code: "vector_chain", eventSeq: 4 });

    const tampered = { ...first, elapsedMs: first.elapsedMs + 1 };
    expectValidationCode(
      () =>
        projectRunDirectiveState(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", tampered),
          ],
          RUN_ID,
        ),
      "content_hash",
    );
  });

  it("upcasts legacy v1 explicitly without treating evidence/control churn as product progress", () => {
    const legacy = legacyVector({ changedDimensions: ["source"] });
    const decoded = projectValidatedVectorChain(
      [
        runEvent(1, "turn.completed", {}),
        runEvent(2, "run.progress.vector", legacy),
      ],
      RUN_ID,
    )[0]!;

    expect(decoded).toEqual(
      expect.objectContaining({
        sourceSchemaVersion: 1,
        progressed: false,
        productProgressed: false,
        supportProgressed: true,
        supportCount: 1,
        stagnantTurnCount: 1,
      }),
    );

    const upgradeBaseline = legacyVector({ changedDimensions: [] });
    const upgraded = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: upgradeBaseline.contentSha256,
      stagnantTurnCount: 2,
    });
    expect(
      projectValidatedVectorChain(
        [
          runEvent(1, "turn.completed", {}),
          runEvent(2, "run.progress.vector", upgradeBaseline),
          runEvent(3, "turn.completed", {}),
          runEvent(4, "run.progress.vector", upgraded),
        ],
        RUN_ID,
      ).map((vector) => vector.sourceSchemaVersion),
    ).toEqual([1, 2]);

    const currentBeforeDowngrade = currentVector({
      turnIndex: 1,
      turnCompletedSeq: 1,
    });
    const downgraded = rehash({
      ...legacyVector({ changedDimensions: [] }),
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: currentBeforeDowngrade.contentSha256,
    });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", currentBeforeDowngrade),
            runEvent(3, "turn.completed", {}),
            runEvent(4, "run.progress.vector", downgraded),
          ],
          RUN_ID,
        ),
      "vector_chain",
    );

    const unknown = rehash({ ...legacy, schemaVersion: 9 });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", unknown),
          ],
          RUN_ID,
        ),
      "payload_schema",
    );
  });

  it("binds current decisions to the active policy and latest vector", () => {
    const first = currentVector({
      turnIndex: 1,
      turnCompletedSeq: 1,
      elapsedMs: DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs,
    });
    const state = initialState(first);
    const receipt = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: first as RunConvergenceSnapshot,
      },
      state,
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const valid = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      runEvent(3, receipt.type, receipt.payload),
    ];
    expect(
      projectValidatedRunProgressLedger(
        valid,
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).decisions,
    ).toEqual([
      expect.objectContaining({
        sourceGeneration: "current_v1",
        kind: "no_progress_request",
        progressVectorSha256: first.contentSha256,
      }),
    ]);

    const differentPolicy = {
      ...DEFAULT_RUN_CONVERGENCE_POLICY,
      noProgressTurnThreshold:
        DEFAULT_RUN_CONVERGENCE_POLICY.noProgressTurnThreshold + 1,
    };
    const wrongPolicy = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: first as RunConvergenceSnapshot,
      },
      state,
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: differentPolicy,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", first),
            runEvent(3, wrongPolicy.type, wrongPolicy.payload),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "policy_binding",
    );

    const second = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
      elapsedMs: DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs + 100,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", first),
            runEvent(3, "turn.completed", {}),
            runEvent(4, "run.progress.vector", second),
            runEvent(5, receipt.type, receipt.payload),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "vector_binding",
    );
  });

  it("rejects a correctly hashed no-progress request before policy pressure", () => {
    const vector = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const receipt = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: vector as RunConvergenceSnapshot,
      },
      state: initialState(vector),
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });

    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", vector),
            runEvent(3, receipt.type, receipt.payload),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "payload_shape",
    );
  });

  it("rejects decisions from a stale control epoch", () => {
    const first = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const queued = runEvent(
      3,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_12345678",
        mode: "steering",
        text: "Continue from a new operator instruction.",
      }),
    );
    const pending = nextPendingRunControlMessage([queued], RUN_ID, "steering")!;
    const delivered = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 5,
    });
    const second = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 6,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
      elapsedMs: DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs,
    });
    const stale = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: second as RunConvergenceSnapshot,
      },
      state: initialState(second),
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const events = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      queued,
      runEvent(4, "run.control.delivered", delivered),
      runEvent(5, "message.user", createRunControlMessageUserPayload(pending)),
      runEvent(6, "turn.completed", {}),
      runEvent(7, "run.progress.vector", second),
      runEvent(8, stale.type, stale.payload),
    ];
    expect(
      projectValidatedRunProgressLedger(
        events.slice(0, -1),
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).controlEpochId,
    ).toBe(delivered.contentSha256);
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          events,
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          events.filter((event) => event.seq !== 5),
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );
    expectValidationCode(
      () => projectRunDirectiveState(events, RUN_ID),
      "control_epoch_lineage",
    );
  });

  it("validates delivered convergence request ancestry before activation", () => {
    const first = currentVector({ turnIndex: 1, turnCompletedSeq: 1 });
    const request = createRunDecisionReceipt({
      decision: {
        kind: "convergence_request",
        reason: "marginal_yield",
        vector: first as RunConvergenceSnapshot,
      },
      state: initialState(first),
      phase: { attempts: 2, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const requestId = String(request.payload["decisionId"]);
    const second = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 5,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
    });
    const requestedState: RunDirectiveState = {
      controlEpochId: `${RUN_ID}:initial`,
      convergence: {
        phase: "requested",
        directiveId: requestId,
        turnIndex: 1,
        delivered: true,
      },
      noProgress: { phase: "idle" },
      latestVector: second as RunConvergenceSnapshot,
    };
    const activation = createRunDecisionReceipt({
      decision: {
        kind: "convergence_activate",
        vector: second as RunConvergenceSnapshot,
      },
      state: requestedState,
      phase: { attempts: 2, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const events = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      runEvent(3, request.type, request.payload),
      runEvent(4, "run.progress.directive.delivered", {
        text: request.directive!.message,
        runProgressDirectiveId: requestId,
        runProgressDirectiveKind: "convergence",
        textSha256: sha256(request.directive!.message),
      }),
      runEvent(5, "turn.completed", {}),
      runEvent(6, "run.progress.vector", second),
      runEvent(7, activation.type, activation.payload),
    ];
    expect(
      projectValidatedRunProgressLedger(
        events,
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).decisions.map((decision) => decision.kind),
    ).toEqual(["convergence_request", "convergence_activate"]);

    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          events.filter((event) => event.seq !== 4),
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "directive_lineage",
    );

    const wrongDelivery = events.map((event) =>
      event.seq === 4
        ? runEvent(4, "run.progress.directive.delivered", {
            text: "different instruction",
            runProgressDirectiveId: requestId,
            runProgressDirectiveKind: "no_progress",
            textSha256: sha256("different instruction"),
          })
        : event,
    );
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          wrongDelivery,
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "directive_lineage",
    );
  });

  it("binds no-progress outcomes to the delivered request receipt", () => {
    const first = currentVector({
      turnIndex: 1,
      turnCompletedSeq: 1,
      elapsedMs: DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs,
    });
    const request = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: first as RunConvergenceSnapshot,
      },
      state: initialState(first),
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const requestId = String(request.payload["decisionId"]);
    const second = currentVector({
      turnIndex: 2,
      turnCompletedSeq: 5,
      predecessorContentSha256: first.contentSha256,
      stagnantTurnCount: 2,
      elapsedMs: DEFAULT_RUN_CONVERGENCE_POLICY.noProgressElapsedMs + 100,
    });
    const outcome = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_halt",
        vector: second as RunConvergenceSnapshot,
      },
      state: {
        controlEpochId: `${RUN_ID}:initial`,
        convergence: { phase: "open" },
        noProgress: {
          phase: "requested",
          directiveId: requestId,
          turnIndex: 1,
          failureDomainBaseline: 0,
          unclassifiedActivityBaseline: 0,
          rerouteContentSha256: String(request.payload["contentSha256"]),
          delivered: true,
        },
        latestVector: second as RunConvergenceSnapshot,
      },
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy: DEFAULT_RUN_CONVERGENCE_POLICY,
    });
    const events = [
      runEvent(1, "turn.completed", {}),
      runEvent(2, "run.progress.vector", first),
      runEvent(3, request.type, request.payload),
      runEvent(4, "run.progress.directive.delivered", {
        text: request.directive!.message,
        runProgressDirectiveId: requestId,
        runProgressDirectiveKind: "no_progress",
        textSha256: sha256(request.directive!.message),
      }),
      runEvent(5, "turn.completed", {}),
      runEvent(6, "run.progress.vector", second),
      runEvent(7, outcome.type, outcome.payload),
    ];
    expect(
      projectValidatedRunProgressLedger(
        events,
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).decisions.map((decision) => decision.kind),
    ).toEqual(["no_progress_request", "no_progress_halt"]);

    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          events.filter((event) => event.seq !== 4),
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "directive_lineage",
    );
  });

  it("accepts legacy decisions only through the marked compatibility upcaster", () => {
    const vector = legacyVector({ changedDimensions: [] });
    const content = {
      kind: "napier.run-progress-reroute" as const,
      schemaVersion: 1 as const,
      strategy: "summarize_and_converge" as const,
      reason: "turns" as const,
      turnIndex: 1,
      stagnantTurnCount: 1,
      elapsedMs: 100,
      stagnantElapsedMs: 100,
      thresholdTurns: 6,
      thresholdElapsedMs: 180_000,
      progressVectorSha256: vector.contentSha256,
      instructionSha256: hash("instruction"),
      taskIntentSha256: hash("task"),
    };
    const decision = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const projected = projectValidatedRunProgressLedger(
      [
        runEvent(1, "turn.completed", {}),
        runEvent(2, "run.progress.vector", vector),
        runEvent(3, "run.progress.rerouted", decision),
      ],
      RUN_ID,
      DEFAULT_RUN_CONVERGENCE_POLICY,
    );
    expect(projected.decisions).toEqual([
      expect.objectContaining({
        sourceGeneration: "legacy_v1",
        kind: "no_progress_request",
        decisionId: decision.contentSha256,
      }),
    ]);
    expect(projected.directiveState.noProgress).toEqual({ phase: "idle" });
    expect(projected.directiveState.latestVector).toBeUndefined();

    const initialEpoch = `${RUN_ID}:initial`;
    const messageSetSha256 = hash("operator-message-set");
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            runEvent(1, "turn.completed", {}),
            runEvent(2, "run.progress.vector", vector),
            runEvent(3, "run.progress.operator_epoch", {
              kind: "napier.run-progress-operator-epoch",
              schemaVersion: 1,
              parentControlEpochId: initialEpoch,
              messageSetSha256,
              contentSha256: sha256(`${initialEpoch}\0${messageSetSha256}`),
            }),
            runEvent(4, "run.progress.rerouted", decision),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );
  });
});

function currentVector(input: {
  turnIndex: number;
  turnCompletedSeq: number;
  predecessorContentSha256?: string;
  stagnantTurnCount?: number;
  elapsedMs?: number;
}) {
  const planState = {
    revisionTotal: 0,
    planStatusCounts: {},
    stepStatusCounts: {},
    productScore: 0,
    acceptanceScore: 0,
    sha256: EMPTY_HASH,
  };
  const artifactState = {
    artifactCount: 0,
    candidateCount: 0,
    statusCounts: {},
    productScore: 0,
    acceptanceScore: 0,
    sha256: EMPTY_HASH,
  };
  const dimensions = {
    workspace: EMPTY_HASH,
    plan: EMPTY_HASH,
    artifact: EMPTY_HASH,
    source: EMPTY_HASH,
    approval: EMPTY_HASH,
    capability: EMPTY_HASH,
    result: EMPTY_HASH,
  };
  return projectRunProgressVectorContent({
    projectionId: sha256(
      canonicalJson({
        kind: "napier.run-progress-vector",
        schemaVersion: 2,
        runId: RUN_ID,
        turnCompletedSeq: input.turnCompletedSeq,
      }),
    ),
    turnIndex: input.turnIndex,
    turnCompletedSeq: input.turnCompletedSeq,
    elapsedMs: input.elapsedMs ?? input.turnIndex * 100,
    transition: {
      progressed: false,
      productProgressed: false,
      acceptanceProgressed: false,
      supportProgressed: false,
      regressed: false,
      changedDimensions: [],
    },
    stagnantTurnCount: input.stagnantTurnCount ?? input.turnIndex,
    stagnantElapsedMs: input.elapsedMs ?? input.turnIndex * 100,
    acquisitionOnlyTurnCount: 0,
    acquisitionStagnantTurnCount: input.turnIndex,
    workspaceMutationCount: 0,
    supportResourceCount: 0,
    productReceiptCount: 0,
    supportCount: 0,
    acquisitionAttemptCount: 0,
    acquisitionAttemptCountSinceProgress: 0,
    acquisitionAdvanceCountSinceProgress: 0,
    failureDomainCountSinceProgress: 0,
    unclassifiedActivityCountSinceProgress: 0,
    acceptanceReceiptCount: 0,
    deliveryReadiness: "no_product",
    deliveryReadinessBlockerCount: 1,
    productEffectCount: 0,
    marginalProductAdvancedCount: 0,
    marginalProductRegressedCount: 0,
    indeterminateProductEffectCount: 0,
    invalidMarginalEvidenceCount: 0,
    unboundVerificationCount: 0,
    deliveryAttemptCount: 0,
    explicitAcceptanceCount: 0,
    approvalCount: 0,
    capabilityStatusCount: 0,
    userResultCount: 0,
    planCount: 0,
    planState,
    artifactState,
    failureFingerprints: new Set(),
    failureDomains: new Set(),
    dimensions,
    predecessorContentSha256: input.predecessorContentSha256 ?? "",
  });
}

function legacyVector(input: { changedDimensions: string[] }) {
  const content = {
    kind: "napier.run-progress-vector" as const,
    schemaVersion: 1 as const,
    turnIndex: 1,
    turnCompletedSeq: 1,
    elapsedMs: 100,
    progressed: input.changedDimensions.length > 0,
    changedDimensions: input.changedDimensions,
    stagnantTurnCount: input.changedDimensions.length > 0 ? 0 : 1,
    stagnantElapsedMs: input.changedDimensions.length > 0 ? 0 : 100,
    workspaceMutationCount: 0,
    sourceCount: input.changedDimensions.includes("source") ? 1 : 0,
    approvalCount: 0,
    capabilityStatusCount: 0,
    userResultCount: 0,
    planCount: 0,
    planRevisionTotal: 0,
    planStatusCounts: {},
    stepStatusCounts: {},
    artifactCount: 0,
    artifactCandidateCount: 0,
    artifactStatusCounts: {},
    failureFingerprintCount: 0,
    failureFingerprintSetSha256: hash("failure-set"),
    dimensions: {
      workspace: EMPTY_HASH,
      plan: EMPTY_HASH,
      artifact: EMPTY_HASH,
      source: input.changedDimensions.includes("source")
        ? hash("source")
        : EMPTY_HASH,
      approval: EMPTY_HASH,
      capability: EMPTY_HASH,
      result: EMPTY_HASH,
    },
    predecessorContentSha256: "",
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function initialState(vector: JsonObject): RunDirectiveState {
  return {
    controlEpochId: `${RUN_ID}:initial`,
    convergence: { phase: "open" },
    noProgress: { phase: "idle" },
    latestVector: vector as unknown as RunConvergenceSnapshot,
  };
}

function runEvent(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: type === "run.control.delivered" ? "message" : "lifecycle",
    visibility: "debug",
    createdAt: new Date(seq * 1_000).toISOString(),
    payload,
    schemaVersion: 1,
  };
}

function rehash<T extends JsonObject>(value: T): T {
  const { contentSha256: _ignored, ...content } = value;
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  } as T;
}

function expectValidationCode(
  action: () => unknown,
  code: RunProgressPayloadValidationError["code"],
): void {
  try {
    action();
    throw new Error("Expected Run progress validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RunProgressPayloadValidationError);
    expect((error as RunProgressPayloadValidationError).code).toBe(code);
  }
}

function hash(value: string): string {
  return sha256(value);
}

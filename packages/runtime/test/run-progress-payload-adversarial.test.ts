import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  DEFAULT_RUN_CONVERGENCE_POLICY,
  type RunConvergenceSnapshot,
} from "../src/run-convergence-policy.js";
import {
  createRunControlMessageCancelledPayload,
  createRunControlMessageDeliveredPayload,
  createRunControlMessageQueuedPayload,
  createRunControlMessageUserPayload,
  nextPendingRunControlMessage,
} from "../src/run-control-messages.js";
import { createRunDecisionReceipt } from "../src/run-progress-decision-receipt.js";
import type { RunDirectiveState } from "../src/run-progress-directive-state.js";
import {
  projectRunProgressVectorContent,
  type RunProgressDimension,
} from "../src/run-progress-ledger-projection.js";
import {
  projectValidatedRunProgressLedger,
  projectValidatedVectorChain,
  RunProgressPayloadValidationError,
} from "../src/run-progress-payload-codec.js";

const RUN_ID = "run_progress_adversarial";
const THREAD_ID = "thread_progress_adversarial";
const EMPTY_HASH = sha256(canonicalJson([]));

describe("Run progress adversarial replay", () => {
  it("rejects rehashed elapsed and dimension transitions the producer could not derive", () => {
    const first = vector({ turnIndex: 1, turnCompletedSeq: 1 });
    const wrongElapsed = rehash({ ...first, stagnantElapsedMs: 99 });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [completed(1), event(2, "run.progress.vector", wrongElapsed)],
          RUN_ID,
        ),
      "vector_monotonicity",
    );

    const wrongDimensions = rehash({
      ...first,
      changedDimensions: ["source"],
    });
    expectValidationCode(
      () =>
        projectValidatedVectorChain(
          [completed(1), event(2, "run.progress.vector", wrongDimensions)],
          RUN_ID,
        ),
      "vector_monotonicity",
    );
  });

  it("rejects no-progress control bound to a vector that just progressed", () => {
    const policy = {
      ...DEFAULT_RUN_CONVERGENCE_POLICY,
      noProgressTurnThreshold: 0,
      noProgressElapsedMs: 0,
    };
    const progressed = vector({
      turnIndex: 1,
      turnCompletedSeq: 1,
      productProgressed: true,
    });
    const receipt = createRunDecisionReceipt({
      decision: {
        kind: "no_progress_request",
        vector: progressed as RunConvergenceSnapshot,
      },
      state: directiveState(progressed),
      phase: { attempts: 0, advances: 0, failureDomains: 0 },
      taskIntentSha256: hash("task"),
      policy,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            completed(1),
            event(2, "run.progress.vector", progressed),
            event(3, receipt.type, receipt.payload),
          ],
          RUN_ID,
          policy,
        ),
      "payload_shape",
    );
  });

  it("requires vector observations to cross control and operator epoch boundaries", () => {
    const first = vector({ turnIndex: 1, turnCompletedSeq: 1 });
    const late = vector({
      turnIndex: 2,
      turnCompletedSeq: 3,
      predecessorContentSha256: first.contentSha256,
    });
    const queued = event(
      4,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_boundary1",
        mode: "steering",
        text: "Use the new objective from this point onward.",
      }),
    );
    const pending = nextPendingRunControlMessage([queued], RUN_ID, "steering")!;
    const delivered = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 6,
    });
    const controlReceipt = convergenceReceipt(
      late,
      delivered.contentSha256,
      first.contentSha256,
    );
    const controlPrefix = [
      completed(1),
      event(2, "run.progress.vector", first),
      completed(3),
      queued,
      event(5, "run.control.delivered", delivered),
      event(6, "message.user", createRunControlMessageUserPayload(pending)),
      event(7, "run.progress.vector", late),
    ];
    expect(projectValidatedVectorChain(controlPrefix, RUN_ID)).toHaveLength(2);
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            ...controlPrefix,
            event(8, controlReceipt.type, controlReceipt.payload),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );

    const initialEpoch = `${RUN_ID}:initial`;
    const messageSetSha256 = hash("fallback-operator-message");
    const operatorEpochId = sha256(`${initialEpoch}\0${messageSetSha256}`);
    const operatorReceipt = convergenceReceipt(
      late,
      operatorEpochId,
      first.contentSha256,
    );
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            completed(1),
            event(2, "run.progress.vector", first),
            completed(3),
            event(4, "run.progress.operator_epoch", {
              kind: "napier.run-progress-operator-epoch",
              schemaVersion: 1,
              parentControlEpochId: initialEpoch,
              messageSetSha256,
              contentSha256: operatorEpochId,
            }),
            event(5, "run.progress.vector", late),
            event(6, operatorReceipt.type, operatorReceipt.payload),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );
  });

  it("accepts the first completed turn after the active control boundary", () => {
    const first = vector({ turnIndex: 1, turnCompletedSeq: 1 });
    const queued = event(
      3,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_boundary2",
        mode: "steering",
        text: "Continue under this new instruction.",
      }),
    );
    const pending = nextPendingRunControlMessage([queued], RUN_ID, "steering")!;
    const delivered = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 5,
    });
    const current = vector({
      turnIndex: 2,
      turnCompletedSeq: 6,
      predecessorContentSha256: first.contentSha256,
    });
    const receipt = convergenceReceipt(
      current,
      delivered.contentSha256,
      first.contentSha256,
    );
    expect(
      projectValidatedRunProgressLedger(
        [
          completed(1),
          event(2, "run.progress.vector", first),
          queued,
          event(4, "run.control.delivered", delivered),
          event(5, "message.user", createRunControlMessageUserPayload(pending)),
          completed(6),
          event(7, "run.progress.vector", current),
          event(8, receipt.type, receipt.payload),
        ],
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).decisions,
    ).toHaveLength(1);
  });

  it("requires a live control request and consumes it exactly once", () => {
    const queued = event(
      1,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_lifecycle1",
        mode: "steering",
        text: "Change course once.",
      }),
    );
    const pending = nextPendingRunControlMessage([queued], RUN_ID, "steering")!;
    const cancellation = createRunControlMessageCancelledPayload({
      message: pending.message,
      reason: "operator_cancelled",
    });
    expect(
      projectValidatedRunProgressLedger(
        [queued, event(2, "run.control.cancelled", cancellation)],
        RUN_ID,
        DEFAULT_RUN_CONVERGENCE_POLICY,
      ).controlEpochId,
    ).toBe(`${RUN_ID}:initial`);

    const afterCancellation = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 4,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            queued,
            event(2, "run.control.cancelled", cancellation),
            event(3, "run.control.delivered", afterCancellation),
            event(
              4,
              "message.user",
              createRunControlMessageUserPayload(pending),
            ),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );

    const firstDelivery = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 3,
    });
    const duplicateDelivery = createRunControlMessageDeliveredPayload({
      message: pending.message,
      messageEventSeq: 5,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            queued,
            event(2, "run.control.delivered", firstDelivery),
            event(
              3,
              "message.user",
              createRunControlMessageUserPayload(pending),
            ),
            event(4, "run.control.delivered", duplicateDelivery),
            event(
              5,
              "message.user",
              createRunControlMessageUserPayload(pending),
            ),
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );

    const futureQueue = event(
      3,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_future001",
        mode: "steering",
        text: "This request is not durable yet.",
      }),
    );
    const futurePending = nextPendingRunControlMessage(
      [futureQueue],
      RUN_ID,
      "steering",
    )!;
    const premature = createRunControlMessageDeliveredPayload({
      message: futurePending.message,
      messageEventSeq: 2,
    });
    expectValidationCode(
      () =>
        projectValidatedRunProgressLedger(
          [
            event(1, "run.control.delivered", premature),
            event(
              2,
              "message.user",
              createRunControlMessageUserPayload(futurePending),
            ),
            futureQueue,
          ],
          RUN_ID,
          DEFAULT_RUN_CONVERGENCE_POLICY,
        ),
      "control_epoch_lineage",
    );
  });
});

function convergenceReceipt(
  progress: JsonObject,
  controlEpochId: string,
  controlEpochVectorSha256: string,
) {
  return createRunDecisionReceipt({
    decision: {
      kind: "convergence_request",
      reason: "marginal_yield",
      vector: progress as unknown as RunConvergenceSnapshot,
    },
    state: {
      ...directiveState(progress),
      controlEpochId,
      controlEpochVectorSha256,
    },
    phase: { attempts: 2, advances: 0, failureDomains: 0 },
    taskIntentSha256: hash("task"),
    policy: DEFAULT_RUN_CONVERGENCE_POLICY,
  });
}

function directiveState(progress: JsonObject): RunDirectiveState {
  return {
    controlEpochId: `${RUN_ID}:initial`,
    convergence: { phase: "open" },
    noProgress: { phase: "idle" },
    latestVector: progress as unknown as RunConvergenceSnapshot,
  };
}

function vector(input: {
  turnIndex: number;
  turnCompletedSeq: number;
  predecessorContentSha256?: string;
  productProgressed?: boolean;
}) {
  const productProgressed = input.productProgressed ?? false;
  const elapsedMs = input.turnIndex * 100;
  const dimensions = {
    workspace: productProgressed ? hash("workspace-product") : EMPTY_HASH,
    plan: EMPTY_HASH,
    artifact: EMPTY_HASH,
    source: EMPTY_HASH,
    approval: EMPTY_HASH,
    capability: EMPTY_HASH,
    result: EMPTY_HASH,
  };
  const changedDimensions: RunProgressDimension[] = productProgressed
    ? ["workspace"]
    : [];
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
    elapsedMs,
    transition: {
      progressed: productProgressed,
      productProgressed,
      acceptanceProgressed: false,
      supportProgressed: false,
      regressed: false,
      changedDimensions,
    },
    stagnantTurnCount: productProgressed ? 0 : input.turnIndex,
    stagnantElapsedMs: productProgressed ? 0 : elapsedMs,
    acquisitionOnlyTurnCount: 0,
    acquisitionStagnantTurnCount: input.turnIndex,
    workspaceMutationCount: 0,
    supportResourceCount: 0,
    productReceiptCount: productProgressed ? 1 : 0,
    supportCount: 0,
    acquisitionAttemptCount: 0,
    acquisitionAttemptCountSinceProgress: 0,
    acquisitionAdvanceCountSinceProgress: 0,
    failureDomainCountSinceProgress: 0,
    unclassifiedActivityCountSinceProgress: 0,
    acceptanceReceiptCount: 0,
    deliveryReadiness: productProgressed ? "unverified" : "no_product",
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
    planState: {
      revisionTotal: 0,
      planStatusCounts: {},
      stepStatusCounts: {},
      productScore: 0,
      acceptanceScore: 0,
      sha256: EMPTY_HASH,
    },
    artifactState: {
      artifactCount: 0,
      candidateCount: 0,
      statusCounts: {},
      productScore: 0,
      acceptanceScore: 0,
      sha256: EMPTY_HASH,
    },
    failureFingerprints: new Set(),
    failureDomains: new Set(),
    dimensions,
    predecessorContentSha256: input.predecessorContentSha256 ?? "",
  });
}

function completed(seq: number): RunEvent {
  return event(seq, "turn.completed", {});
}

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: type.startsWith("run.control.") ? "message" : "lifecycle",
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

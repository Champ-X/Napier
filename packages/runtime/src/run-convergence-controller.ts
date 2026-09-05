import type { UserMessage } from "@earendil-works/pi-ai";
import type {
  JsonValue,
  RunEvent,
  RunLimits,
  RunRecord,
} from "@napier/contracts";

import {
  retryCasConflict,
  type CasConflictRetryOptions,
} from "./cas-conflict-retry.js";
import { controlMessageEventKey } from "./agent-runtime-utils.js";
import type { EventSink } from "./event-sink.js";
import {
  DEFAULT_RUN_CONVERGENCE_POLICY,
  noProgressReason,
  projectRunAcquisitionPhase,
  runNoProgressMessage,
  type RunConvergencePolicy,
  type RunConvergenceSnapshot,
} from "./run-convergence-policy.js";
import { eventRunProgress } from "./run-convergence-tool-progress.js";
import {
  filterToolsForConvergence,
  progressInteger as integer,
  progressRecord as record,
  RunDirectiveFixedPointGuard,
} from "./run-convergence-controller-support.js";
import { establishRunOperatorEpoch } from "./run-operator-epoch-claim.js";
import { preflightRunTool } from "./run-convergence-preflight.js";
import {
  appendRunDecisionEvent,
  appendRunDirectiveDelivery,
  type RunConvergenceEventStore,
} from "./run-convergence-event-writer.js";
import {
  createRunDecisionReceipt,
  RUN_CONVERGENCE_MESSAGE,
} from "./run-progress-decision-receipt.js";
import {
  nextRunDirectiveDecision,
  projectRunDirectiveState,
  type RunDirectiveState,
} from "./run-progress-directive-state.js";
import { projectValidatedVectorChain } from "./run-progress-payload-codec.js";
import {
  RunNoProgressError,
  type RunNoProgressEvidence,
} from "./run-no-progress-policy.js";
import type { RunEventQueryPort } from "./run-event-query-port.js";
import { ConcurrentRunEventHeadError } from "./sqlite-ledger-errors.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

export type { RunConvergenceSnapshot } from "./run-convergence-policy.js";

interface PendingDirective {
  id: string;
  kind: "convergence" | "no_progress";
  message: UserMessage;
}

export class RunConvergenceController {
  private state: RunDirectiveState;
  private pendingDirective: PendingDirective | undefined;
  private readonly deliveredDirectiveIds = new Set<string>();
  private latestTurnIndex = 0;
  private latestFailureDomainCountSinceProgress = 0;
  private latestAcquisitionAttemptCountSinceProgress = 0;
  private latestAcquisitionAdvanceCountSinceProgress = 0;
  private failureDomainBaseline = 0;
  private acquisitionAttemptBaseline = 0;
  private acquisitionAdvanceBaseline = 0;
  private opaqueAdmissionsSinceClosure = 0;
  private terminalDeliverySinceVector = false;
  private latestVectorHasTerminalDelivery = false;

  constructor(
    private readonly context: {
      store: Pick<RunEventQueryPort, "listRunEvents"> &
        RunConvergenceEventStore;
      run: Pick<RunRecord, "id" | "threadId">;
      limits: RunLimits;
      registry: ToolProtocolRegistry;
      taskIntentSha256: string;
      policy?: Readonly<RunConvergencePolicy>;
      onEvent?: EventSink;
      contentionRetry?: Readonly<CasConflictRetryOptions>;
    },
    events: readonly RunEvent[] = [],
    projectedEvidenceThroughSeq = Number.MAX_SAFE_INTEGER,
  ) {
    this.state = projectRunDirectiveState([], context.run.id, this.policy);
    this.recover(events, projectedEvidenceThroughSeq);
  }

  recover(
    events: readonly RunEvent[],
    projectedEvidenceThroughSeq = Number.MAX_SAFE_INTEGER,
  ): void {
    this.state = projectRunDirectiveState(
      events,
      this.context.run.id,
      this.policy,
    );
    this.ingest(events, true, projectedEvidenceThroughSeq);
    this.refreshPendingDirective();
  }

  ingest(
    events: readonly RunEvent[],
    recovery = false,
    projectedEvidenceThroughSeq = Number.MAX_SAFE_INTEGER,
  ): void {
    if (recovery) this.resetEvidenceProjection();
    const validatedVectorByEventSeq = new Map(
      (recovery && events.some((event) => event.type === "run.progress.vector")
        ? projectValidatedVectorChain(events, this.context.run.id)
        : []
      ).map((vector) => [vector.eventSeq, vector]),
    );
    for (const event of events) {
      if (event.runId !== this.context.run.id) continue;
      const payload = record(event.payload);
      if (event.type === "message.assistant") {
        this.terminalDeliverySinceVector = true;
        continue;
      }
      if (event.type === "run.progress.vector") {
        const vector = validatedVectorByEventSeq.get(event.seq);
        if (vector) {
          if (vector.decisionEligible) this.state.latestVector = vector;
          this.captureVector(vector);
          this.latestVectorHasTerminalDelivery =
            this.terminalDeliverySinceVector;
          this.terminalDeliverySinceVector = false;
        }
        continue;
      }
      if (event.type === "run.progress.convergence_requested") {
        this.opaqueAdmissionsSinceClosure = 0;
        continue;
      }
      if (
        event.type === "tool.admitted" &&
        event.seq <= projectedEvidenceThroughSeq &&
        eventRunProgress(payload)?.coverage === "opaque"
      ) {
        this.opaqueAdmissionsSinceClosure += 1;
        continue;
      }
      if (
        event.type === "run.control.delivered" ||
        event.type === "run.progress.operator_epoch"
      ) {
        this.acquisitionAttemptBaseline =
          this.latestAcquisitionAttemptCountSinceProgress;
        this.acquisitionAdvanceBaseline =
          this.latestAcquisitionAdvanceCountSinceProgress;
        this.failureDomainBaseline = this.latestFailureDomainCountSinceProgress;
        continue;
      }
      if (event.type === "run.progress.convergence_reopened") {
        this.opaqueAdmissionsSinceClosure = 0;
        this.captureReopenBaselines(payload);
        continue;
      }
    }
  }

  async reconcileLatest(): Promise<void> {
    if (this.state.latestVector && this.actionable(this.state.latestVector)) {
      await this.reconcile();
    }
    this.refreshPendingDirective();
    if (!this.latestVectorHasTerminalDelivery) this.throwIfHalted();
  }

  async afterVector(
    vector: RunConvergenceSnapshot,
    terminalDeliveryObserved = false,
  ): Promise<void> {
    this.state.latestVector = vector;
    this.captureVector(vector);
    this.latestVectorHasTerminalDelivery = terminalDeliveryObserved;
    this.terminalDeliverySinceVector = false;
    await this.reconcile();
    this.refreshPendingDirective();
    // A convergence halt forbids another work cycle, but must not discard the
    // concrete best-effort answer that the reroute explicitly requested.
    if (!terminalDeliveryObserved) this.throwIfHalted();
  }

  async steer(
    preRecordedMessages: Map<string, number>,
    external: (mode: "steering") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    const controlEpochBeforeSteer = this.state.controlEpochId;
    const externalMessages = await external("steering");
    if (externalMessages.length > 0) {
      // Production steering normally arrives as run.control.delivered. Keep
      // the controller API safe for other hosts too: a returned operator
      // message must always establish a durable epoch before tools reopen.
      const epoch = await establishRunOperatorEpoch({
        ...this.eventWriteContext(),
        policy: this.policy,
        parentControlEpochId: controlEpochBeforeSteer,
        messages: externalMessages,
        ...(this.context.contentionRetry
          ? { contentionRetry: this.context.contentionRetry }
          : {}),
      });
      this.recover(epoch.events);
      this.pendingDirective = undefined;
      return epoch.inject ? externalMessages : [];
    }
    return this.deliverPendingDirective(preRecordedMessages);
  }

  async preflight(
    _callId: string,
    toolName: string,
    args: unknown,
  ): Promise<{ block: true; reason: string } | undefined> {
    return preflightRunTool({
      store: this.context.store,
      runId: this.context.run.id,
      registry: this.context.registry,
      state: this.state,
      policy: this.policy,
      toolName,
      args,
    });
  }

  toolsForNextTurn<T extends { name: string }>(tools: T[]): T[] {
    return filterToolsForConvergence({
      tools,
      state: this.state,
      registry: this.context.registry,
      policy: this.policy,
      opaqueAdmissionsSinceClosure: this.opaqueAdmissionsSinceClosure,
      latestTurnIndex: this.latestTurnIndex,
    });
  }

  private async reconcile(): Promise<void> {
    const fixedPoint = new RunDirectiveFixedPointGuard();
    while (true) {
      const transition = await retryCasConflict({
        operation: async () => {
          const events = await this.context.store.listRunEvents(
            this.context.run.id,
          );
          this.recover(events);
          const vector = this.state.latestVector;
          if (!vector || !this.actionable(vector)) return undefined;
          const phase = this.acquisitionPhase(vector);
          const decision = nextRunDirectiveDecision({
            state: this.state,
            vector,
            acquisitionPhase: phase,
            limits: this.context.limits,
            policy: this.policy,
          });
          if (!decision) return undefined;
          const stateKey = fixedPoint.prepare(this.state, decision);
          const receipt = createRunDecisionReceipt({
            decision,
            state: this.state,
            phase,
            taskIntentSha256: this.context.taskIntentSha256,
            policy: this.policy,
          });
          await appendRunDecisionEvent({
            ...this.eventWriteContext(),
            expectedRunHeadSeq: runHead(events),
            type: receipt.type,
            payload: receipt.payload,
          });
          return stateKey;
        },
        isConflict: (error) => error instanceof ConcurrentRunEventHeadError,
        exhaustedMessage: "Run progress decision was contended",
        ...(this.context.contentionRetry
          ? { options: this.context.contentionRetry }
          : {}),
      });
      if (!transition) return;
      fixedPoint.commit(transition);
    }
  }

  private actionable(vector: RunConvergenceSnapshot): boolean {
    return (
      !("decisionEligible" in vector) ||
      (vector as RunConvergenceSnapshot & { decisionEligible?: boolean })
        .decisionEligible === true
    );
  }

  private captureVector(vector: RunConvergenceSnapshot): void {
    this.latestTurnIndex = vector.turnIndex;
    this.latestFailureDomainCountSinceProgress =
      vector.failureDomainCountSinceProgress;
    this.latestAcquisitionAttemptCountSinceProgress =
      vector.acquisitionAttemptCountSinceProgress;
    this.latestAcquisitionAdvanceCountSinceProgress =
      vector.acquisitionAdvanceCountSinceProgress;
    if (vector.productProgressed || vector.acceptanceProgressed) {
      this.acquisitionAttemptBaseline = 0;
      this.acquisitionAdvanceBaseline = 0;
      this.failureDomainBaseline = 0;
    }
  }

  private resetEvidenceProjection(): void {
    this.latestTurnIndex = 0;
    this.latestFailureDomainCountSinceProgress = 0;
    this.latestAcquisitionAttemptCountSinceProgress = 0;
    this.latestAcquisitionAdvanceCountSinceProgress = 0;
    this.failureDomainBaseline = 0;
    this.acquisitionAttemptBaseline = 0;
    this.acquisitionAdvanceBaseline = 0;
    this.opaqueAdmissionsSinceClosure = 0;
    this.terminalDeliverySinceVector = false;
    this.latestVectorHasTerminalDelivery = false;
  }

  private captureReopenBaselines(
    payload: Record<string, JsonValue> | undefined,
  ): void {
    this.acquisitionAttemptBaseline =
      integer(payload?.["acquisitionAttemptBaseline"]) ??
      this.acquisitionAttemptBaseline;
    this.acquisitionAdvanceBaseline =
      integer(payload?.["acquisitionAdvanceBaseline"]) ??
      this.acquisitionAdvanceBaseline;
    this.failureDomainBaseline =
      integer(payload?.["failureDomainBaseline"]) ?? this.failureDomainBaseline;
  }

  private acquisitionPhase(vector: RunConvergenceSnapshot) {
    return projectRunAcquisitionPhase(vector, {
      acquisitionAttemptCountSinceProgress: this.acquisitionAttemptBaseline,
      acquisitionAdvanceCountSinceProgress: this.acquisitionAdvanceBaseline,
      failureDomainCount: this.failureDomainBaseline,
    });
  }

  private refreshPendingDirective(): void {
    const noProgress = this.state.noProgress;
    if (noProgress.phase === "requested") {
      const vector = this.state.latestVector;
      if (
        vector &&
        !noProgress.delivered &&
        !this.deliveredDirectiveIds.has(noProgress.directiveId)
      ) {
        this.queueDirective({
          id: noProgress.directiveId,
          kind: "no_progress",
          message: runNoProgressMessage(vector),
        });
        return;
      }
    }
    const convergence = this.state.convergence;
    if (
      convergence.phase === "requested" &&
      !convergence.delivered &&
      !this.deliveredDirectiveIds.has(convergence.directiveId)
    ) {
      this.queueDirective({
        id: convergence.directiveId,
        kind: "convergence",
        message: RUN_CONVERGENCE_MESSAGE,
      });
      return;
    }
    this.pendingDirective = undefined;
  }

  private queueDirective(input: {
    id: string;
    kind: "convergence" | "no_progress";
    message: string;
  }): void {
    if (this.deliveredDirectiveIds.has(input.id)) return;
    this.pendingDirective = {
      id: input.id,
      kind: input.kind,
      message: { role: "user", content: input.message, timestamp: Date.now() },
    };
  }

  private async reloadDirectiveState(): Promise<void> {
    this.state = projectRunDirectiveState(
      await this.context.store.listRunEvents(this.context.run.id),
      this.context.run.id,
      this.policy,
    );
  }

  private async deliverPendingDirective(
    preRecordedMessages: Map<string, number>,
  ): Promise<UserMessage[]> {
    return retryCasConflict({
      operation: async () => {
        const events = await this.context.store.listRunEvents(
          this.context.run.id,
        );
        this.recover(events);
        const pending = this.pendingDirective;
        if (!pending) return [];
        this.pendingDirective = undefined;
        const receipt = await appendRunDirectiveDelivery({
          ...this.eventWriteContext(),
          expectedRunHeadSeq: runHead(events),
          directive: pending,
        });
        if (!receipt.appended) {
          // The ledger event is a delivery claim. Only its atomic winner may
          // inject the control message into a live model session; a replaying
          // controller observes the durable delivery but owns no side effect.
          this.recover(
            await this.context.store.listRunEvents(this.context.run.id),
          );
          return [];
        }
        this.deliveredDirectiveIds.add(pending.id);
        const content = String(pending.message.content);
        const timestamp = Date.parse(receipt.event.createdAt);
        const key = controlMessageEventKey(timestamp, content);
        preRecordedMessages.set(key, (preRecordedMessages.get(key) ?? 0) + 1);
        await this.reloadDirectiveState();
        return [{ ...pending.message, timestamp }];
      },
      isConflict: (error) => error instanceof ConcurrentRunEventHeadError,
      exhaustedMessage: "Run progress directive delivery was contended",
      ...(this.context.contentionRetry
        ? { options: this.context.contentionRetry }
        : {}),
    });
  }

  private throwIfHalted(): void {
    const noProgress = this.state.noProgress;
    const vector = this.state.latestVector;
    if (noProgress.phase !== "halted" || !vector) return;
    const evidence: RunNoProgressEvidence = {
      reason: noProgressReason(vector, this.policy),
      turnIndex: vector.turnIndex,
      stagnantTurnCount: vector.stagnantTurnCount,
      elapsedMs: vector.elapsedMs,
      stagnantElapsedMs: vector.stagnantElapsedMs,
      thresholdTurns: this.policy.noProgressTurnThreshold,
      thresholdElapsedMs: this.policy.noProgressElapsedMs,
      taskIntentSha256: this.context.taskIntentSha256,
      progressVectorSha256: vector.contentSha256,
      rerouteContentSha256: noProgress.rerouteContentSha256,
    };
    throw new RunNoProgressError(evidence);
  }

  private get policy(): Readonly<RunConvergencePolicy> {
    return this.context.policy ?? DEFAULT_RUN_CONVERGENCE_POLICY;
  }

  private eventWriteContext() {
    return {
      store: this.context.store,
      run: this.context.run,
      ...(this.context.onEvent ? { onEvent: this.context.onEvent } : {}),
    };
  }
}

function runHead(events: readonly RunEvent[]): number {
  return events.reduce((head, event) => Math.max(head, event.seq), 0);
}

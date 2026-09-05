import type { UserMessage } from "@earendil-works/pi-ai";
import type {
  JsonObject,
  RunEvent,
  RunLimits,
  RunRecord,
} from "@napier/contracts";

import { retryCasConflict } from "./cas-conflict-retry.js";
import {
  RunConvergenceController,
  type RunConvergenceSnapshot,
} from "./run-convergence-controller.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { RunProgressEvidenceProjector } from "./run-progress-evidence-projector.js";
import type { RunConvergenceEventStore } from "./run-convergence-event-writer.js";
import {
  emptyProgressDimensions,
  progressElapsedMs,
  projectRunProgressHydration,
  projectRunProgressTransition,
  projectRunProgressVectorContent,
  type RunProgressDimensionHashes,
} from "./run-progress-ledger-projection.js";
import { normalizedRunProgressHydrationPayload } from "./run-progress-hydration-source.js";
import {
  projectRunArtifactSnapshotState,
  projectRunPlanSnapshotState,
} from "./run-progress-plan-state.js";
import { projectValidatedVectorChain } from "./run-progress-payload-codec.js";
import { ConcurrentRunEventHeadError } from "./sqlite-ledger-errors.js";
import { ToolProtocolRegistry } from "./tool-protocol-registry.js";

export type { RunProgressDimension } from "./run-progress-ledger-projection.js";

interface RunProgressContext {
  store: RunProgressStore;
  run: Pick<RunRecord, "id" | "threadId" | "startedAt">;
  taskIntentSha256: string;
  onEvent?: EventSink;
}

export interface RunProgressStore extends RunConvergenceEventStore {
  listRunEvents(
    runId: string,
    afterSeq?: number,
    types?: readonly string[],
  ): Promise<RunEvent[]>;
  listRuns(threadId: string): RunRecord[];
}

export class RunProgressTracker {
  private projectedThroughSeq = 0;
  private turnIndex = 0;
  private stagnantTurnCount = 0;
  private acquisitionOnlyTurnCount = 0;
  private acquisitionStagnantTurnCount = 0;
  private firstWorkspaceMutationTurn: number | undefined;
  private firstWorkspaceMutationElapsedMs: number | undefined;
  private lastProgressElapsedMs = 0;
  private previousContentSha256 = "";
  private previousDimensions: RunProgressDimensionHashes =
    emptyProgressDimensions();
  private previousPlanProductScore = 0;
  private previousPlanAcceptanceScore = 0;
  private previousArtifactProductScore = 0;
  private previousArtifactAcceptanceScore = 0;
  private evidence: RunProgressEvidenceProjector;
  private recordTurnTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly context: RunProgressContext,
    private readonly convergence: RunConvergenceController,
  ) {
    this.evidence = new RunProgressEvidenceProjector(
      context.run.id,
      context.taskIntentSha256,
    );
  }

  static async create(
    store: RunProgressStore,
    run: Pick<RunRecord, "id" | "threadId" | "startedAt">,
    onEvent?: EventSink,
    task?: { prompt: string; toolNames: string[] },
    limits?: RunLimits,
    registry?: ToolProtocolRegistry,
  ): Promise<RunProgressTracker> {
    const events = await store.listRunEvents(run.id);
    const runLimits =
      limits ??
      store.listRuns(run.threadId).find((candidate) => candidate.id === run.id)
        ?.limits;
    if (!runLimits) throw new Error("Run progress requires Run limits");
    const toolProtocol = registry ?? new ToolProtocolRegistry([]);
    const taskIntentSha256 = sha256(task?.prompt ?? "");
    const validatedVectors = projectValidatedVectorChain(events, run.id);
    const latestVector = validatedVectors.at(-1);
    const context = {
      store,
      run,
      taskIntentSha256,
      ...(onEvent ? { onEvent } : {}),
    };
    const tracker = new RunProgressTracker(
      context,
      new RunConvergenceController(
        {
          store,
          run,
          limits: runLimits,
          registry: toolProtocol,
          taskIntentSha256,
          ...(onEvent ? { onEvent } : {}),
        },
        events,
        latestVector?.turnCompletedSeq ?? 0,
      ),
    );
    tracker.hydrate(events, latestVector);
    await tracker.catchUpCompletedTurns();
    await tracker.convergence.reconcileLatest();
    return tracker;
  }

  async recordTurn(): Promise<RunEvent> {
    const current = this.recordTurnTail.then(() => this.recordTurnOnce());
    this.recordTurnTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private recordTurnOnce(
    reconciliation: "immediate" | "deferred" = "immediate",
  ): Promise<RunEvent> {
    return retryCasConflict({
      operation: () => this.recordTurnAttempt(reconciliation),
      isConflict: (error) => error instanceof RunProgressVectorHeadConflict,
      exhaustedMessage:
        "Run progress vector could not advance after bounded CAS contention",
    });
  }

  private async recordTurnAttempt(
    reconciliation: "immediate" | "deferred",
  ): Promise<RunEvent> {
    const pending = await this.context.store.listRunEvents(
      this.context.run.id,
      this.projectedThroughSeq,
    );
    const completed = pending.find((event) => event.type === "turn.completed");
    if (!completed) {
      throw new Error("Run progress vector requires a completed turn");
    }
    const expectedRunHeadSeq = pending.reduce(
      (head, event) => Math.max(head, event.seq),
      this.projectedThroughSeq,
    );
    this.turnIndex += 1;
    const events = pending.filter((event) => event.seq <= completed.seq);
    const delta = this.evidence.ingest(events);
    this.convergence.ingest(events);
    const planSnapshots = this.evidence.currentPlanSnapshots();
    const planState = projectRunPlanSnapshotState(planSnapshots);
    const artifactState = projectRunArtifactSnapshotState(planSnapshots);
    const dimensions = this.evidence.dimensions(
      planState.sha256,
      artifactState.sha256,
    );
    const transition = projectRunProgressTransition({
      productAdvanced: delta.productAdvanced,
      productRegressed: delta.productRegressed,
      acceptanceAdvanced: delta.acceptanceAdvanced,
      supportAdvanced: delta.supportAdvanced,
      planState,
      artifactState,
      previousScores: this.previousScores(),
      dimensions,
      previousDimensions: this.previousDimensions,
    });
    if (
      transition.progressed &&
      !delta.productAdvanced &&
      !delta.acceptanceAdvanced
    ) {
      this.evidence.resetAcquisitionWindow();
    }
    const elapsedMs = progressElapsedMs(
      this.context.run.startedAt,
      completed.createdAt,
    );
    this.recordFirstWorkspaceMutation(delta, elapsedMs);
    this.updateStagnation(delta, transition.progressed, elapsedMs);
    const metrics = this.evidence.metrics();
    const payload = projectRunProgressVectorContent({
      projectionId: vectorProjectionId(this.context.run.id, completed.seq),
      turnIndex: this.turnIndex,
      turnCompletedSeq: completed.seq,
      elapsedMs,
      transition,
      stagnantTurnCount: this.stagnantTurnCount,
      stagnantElapsedMs: Math.max(0, elapsedMs - this.lastProgressElapsedMs),
      acquisitionOnlyTurnCount: this.acquisitionOnlyTurnCount,
      acquisitionStagnantTurnCount: this.acquisitionStagnantTurnCount,
      workspaceMutationCount: metrics.workspaceMutationCount,
      supportResourceCount: metrics.supportResourceCount,
      productReceiptCount: metrics.productReceiptCount,
      supportCount: metrics.supportCount,
      acquisitionAttemptCount: metrics.acquisitionAttemptCount,
      acquisitionAttemptCountSinceProgress:
        metrics.acquisitionAttemptCountSinceProgress,
      acquisitionAdvanceCountSinceProgress:
        metrics.acquisitionAdvanceCountSinceProgress,
      failureDomainCountSinceProgress: metrics.failureDomainCountSinceProgress,
      unclassifiedActivityCountSinceProgress:
        metrics.unclassifiedActivityCountSinceProgress,
      acceptanceReceiptCount: metrics.acceptanceReceiptCount,
      deliveryReadiness: metrics.effectReadiness.deliveryReadiness.status,
      deliveryReadinessBlockerCount:
        metrics.effectReadiness.deliveryReadiness.blockers.length,
      productEffectCount: metrics.effectReadiness.effectCount,
      marginalProductAdvancedCount:
        metrics.effectReadiness.marginalAdvancedCount,
      marginalProductRegressedCount:
        metrics.effectReadiness.marginalRegressedCount,
      indeterminateProductEffectCount:
        metrics.effectReadiness.indeterminateEffectCount,
      invalidMarginalEvidenceCount:
        metrics.effectReadiness.invalidMarginalEvidenceCount,
      unboundVerificationCount:
        metrics.effectReadiness.unboundVerificationCount,
      deliveryAttemptCount: metrics.effectReadiness.deliveryAttempts.length,
      explicitAcceptanceCount: metrics.effectReadiness.explicitAcceptanceCount,
      approvalCount: metrics.approvalCount,
      capabilityStatusCount: metrics.capabilityStatusCount,
      userResultCount: metrics.userResultCount,
      planCount: planSnapshots.length,
      planState,
      artifactState,
      failureFingerprints: new Set(metrics.failureFingerprints),
      failureDomains: new Set(metrics.failureDomains),
      dimensions,
      predecessorContentSha256: this.previousContentSha256,
      ...(this.firstWorkspaceMutationTurn !== undefined
        ? {
            firstWorkspaceMutationTurn: this.firstWorkspaceMutationTurn,
            firstWorkspaceMutationElapsedMs:
              this.firstWorkspaceMutationElapsedMs!,
          }
        : {}),
    });
    let event: RunEvent;
    try {
      event = await this.appendVector(payload, expectedRunHeadSeq);
    } catch (error) {
      await this.recoverFromLedger();
      if (error instanceof ConcurrentRunEventHeadError) {
        throw new RunProgressVectorHeadConflict(error);
      }
      throw error;
    }
    this.commitVectorState(completed.seq, payload, planState, artifactState);
    await emitBestEffort(this.context.onEvent, event);
    if (reconciliation === "deferred") return event;
    try {
      await this.convergence.afterVector(
        payload as RunConvergenceSnapshot,
        delta.terminalDeliveryObserved,
      );
    } catch (error) {
      await this.recoverFromLedger();
      throw error;
    }
    return event;
  }

  steer(
    preRecordedMessages: Map<string, number>,
    external: (mode: "steering") => Promise<UserMessage[]>,
  ): Promise<UserMessage[]> {
    return this.convergence.steer(preRecordedMessages, external);
  }

  preflightTool(callId: string, toolName: string, args?: unknown) {
    return this.convergence.preflight(callId, toolName, args);
  }

  observeEvent(event: RunEvent): void {
    this.convergence.ingest([event]);
  }

  toolsForNextTurn<T extends { name: string }>(
    tools: T[] | undefined,
  ): T[] | undefined {
    return tools ? this.convergence.toolsForNextTurn(tools) : undefined;
  }

  private hydrate(
    events: RunEvent[],
    latest = projectValidatedVectorChain(events, this.context.run.id).at(-1),
  ): void {
    const projectedThroughSeq = latest?.turnCompletedSeq ?? 0;
    this.evidence.ingest(
      events.filter((event) => event.seq <= projectedThroughSeq),
    );
    this.projectedThroughSeq = projectedThroughSeq;
    const hydration = projectRunProgressHydration(
      latest ? normalizedRunProgressHydrationPayload(latest) : undefined,
    );
    this.turnIndex = hydration.turnIndex;
    this.stagnantTurnCount = hydration.stagnantTurnCount;
    this.acquisitionOnlyTurnCount = hydration.acquisitionOnlyTurnCount;
    this.acquisitionStagnantTurnCount = hydration.acquisitionStagnantTurnCount;
    this.evidence.restoreWindow(hydration);
    this.previousContentSha256 = hydration.previousContentSha256;
    this.lastProgressElapsedMs = hydration.lastProgressElapsedMs;
    this.firstWorkspaceMutationTurn = hydration.firstWorkspaceMutationTurn;
    this.firstWorkspaceMutationElapsedMs =
      hydration.firstWorkspaceMutationElapsedMs;
    this.hydrateProjectionBaseline(hydration);
  }

  private hydrateProjectionBaseline(
    hydration: ReturnType<typeof projectRunProgressHydration>,
  ): void {
    const snapshots = this.evidence.currentPlanSnapshots();
    const plan = projectRunPlanSnapshotState(snapshots);
    const artifact = projectRunArtifactSnapshotState(snapshots);
    const scores = hydration.previousScores;
    this.previousPlanProductScore = scores?.planProduct ?? plan.productScore;
    this.previousPlanAcceptanceScore =
      scores?.planAcceptance ?? plan.acceptanceScore;
    this.previousArtifactProductScore =
      scores?.artifactProduct ?? artifact.productScore;
    this.previousArtifactAcceptanceScore =
      scores?.artifactAcceptance ?? artifact.acceptanceScore;
    this.previousDimensions =
      hydration.previousDimensions ??
      this.evidence.dimensions(plan.sha256, artifact.sha256);
  }

  private previousScores() {
    return {
      planProduct: this.previousPlanProductScore,
      planAcceptance: this.previousPlanAcceptanceScore,
      artifactProduct: this.previousArtifactProductScore,
      artifactAcceptance: this.previousArtifactAcceptanceScore,
    };
  }

  private recordFirstWorkspaceMutation(
    delta: { productAdvanced: boolean; workspaceProductAdvanced: boolean },
    elapsedMs: number,
  ): void {
    if (
      !delta.productAdvanced ||
      !delta.workspaceProductAdvanced ||
      this.firstWorkspaceMutationTurn !== undefined
    ) {
      return;
    }
    this.firstWorkspaceMutationTurn = this.turnIndex;
    this.firstWorkspaceMutationElapsedMs = elapsedMs;
  }

  private updateStagnation(
    delta: { acquisitionAdvanced: boolean; acquisitionAttempted: boolean },
    progressed: boolean,
    elapsedMs: number,
  ): void {
    this.stagnantTurnCount = progressed ? 0 : this.stagnantTurnCount + 1;
    this.acquisitionStagnantTurnCount = delta.acquisitionAdvanced
      ? 0
      : this.acquisitionStagnantTurnCount + 1;
    const attemptsRemain =
      this.evidence.metrics().acquisitionAttemptCountSinceProgress > 0;
    this.acquisitionOnlyTurnCount = progressed
      ? 0
      : delta.acquisitionAttempted || attemptsRemain
        ? this.acquisitionOnlyTurnCount + 1
        : 0;
    if (progressed) this.lastProgressElapsedMs = elapsedMs;
  }

  private appendVector(
    payload: ReturnType<typeof projectRunProgressVectorContent>,
    expectedRunHeadSeq: number,
  ): Promise<RunEvent> {
    return this.context.store
      .appendEventOnceAtRunHead(
        {
          threadId: this.context.run.threadId,
          runId: this.context.run.id,
          type: "run.progress.vector",
          category: "lifecycle",
          visibility: "debug",
          payload: payload as unknown as JsonObject,
        },
        {
          namespace: "run-progress-vector",
          key: payload.projectionId,
          expectedRunHeadSeq,
        },
      )
      .then((receipt) => receipt.event);
  }

  private async recoverFromLedger(): Promise<void> {
    const events = await this.context.store.listRunEvents(this.context.run.id);
    const latest = projectValidatedVectorChain(events, this.context.run.id).at(
      -1,
    );
    this.resetProjectionState();
    this.hydrate(events, latest);
    this.convergence.recover(events, latest?.turnCompletedSeq ?? 0);
  }

  private resetProjectionState(): void {
    this.projectedThroughSeq = 0;
    this.turnIndex = 0;
    this.stagnantTurnCount = 0;
    this.acquisitionOnlyTurnCount = 0;
    this.acquisitionStagnantTurnCount = 0;
    this.firstWorkspaceMutationTurn = undefined;
    this.firstWorkspaceMutationElapsedMs = undefined;
    this.lastProgressElapsedMs = 0;
    this.previousContentSha256 = "";
    this.previousDimensions = emptyProgressDimensions();
    this.previousPlanProductScore = 0;
    this.previousPlanAcceptanceScore = 0;
    this.previousArtifactProductScore = 0;
    this.previousArtifactAcceptanceScore = 0;
    this.evidence = new RunProgressEvidenceProjector(
      this.context.run.id,
      this.context.taskIntentSha256,
    );
  }

  private commitVectorState(
    completedSeq: number,
    payload: ReturnType<typeof projectRunProgressVectorContent>,
    plan: { productScore: number; acceptanceScore: number },
    artifact: { productScore: number; acceptanceScore: number },
  ): void {
    this.projectedThroughSeq = completedSeq;
    this.previousDimensions = payload.dimensions;
    this.previousContentSha256 = payload.contentSha256;
    this.previousPlanProductScore = plan.productScore;
    this.previousPlanAcceptanceScore = plan.acceptanceScore;
    this.previousArtifactProductScore = artifact.productScore;
    this.previousArtifactAcceptanceScore = artifact.acceptanceScore;
  }

  private async catchUpCompletedTurns(): Promise<void> {
    let recoveredVectors = false;
    for (;;) {
      const pending = await this.context.store.listRunEvents(
        this.context.run.id,
        this.projectedThroughSeq,
      );
      if (!pending.some((event) => event.type === "turn.completed")) break;
      await this.recordTurnOnce("deferred");
      recoveredVectors = true;
    }
    if (recoveredVectors) await this.recoverFromLedger();
  }
}

function vectorProjectionId(runId: string, turnCompletedSeq: number): string {
  return sha256(
    canonicalJson({
      kind: "napier.run-progress-vector",
      schemaVersion: 2,
      runId,
      turnCompletedSeq,
    }),
  );
}

class RunProgressVectorHeadConflict extends Error {
  override readonly name = "RunProgressVectorHeadConflict";

  constructor(conflict: ConcurrentRunEventHeadError) {
    super("Run progress vector head changed during projection", {
      cause: conflict,
    });
  }
}

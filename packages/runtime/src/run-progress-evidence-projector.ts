import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { progressFailureBinding } from "./run-convergence-tool-progress.js";
import {
  observeRunProgressEffect,
  type RunProgressIdentity,
} from "./run-progress-effect-observer.js";
import {
  emptyRunEffectReadinessProjection,
  reduceRunEffectReadiness,
} from "./run-effect-readiness-projection.js";
import {
  runProgressFailureDomainFingerprint,
  runProgressFailureFingerprint,
  runProgressToolInputFingerprint,
} from "./run-progress-failures.js";
import { projectHostProgressEffect } from "./run-progress-host-effects.js";
import {
  addProgressEvidence,
  assistantEvidence,
  hashProgressMap,
  hashProgressSet,
  isApprovalResolution,
  isAcquisitionFailure,
  isCapabilityEvent,
  progressRecord,
  progressText,
  stableEventEvidence,
  stableStateHash,
  stableToolProgress,
  type RunProgressDimensionHashes,
  type StableToolProgress,
} from "./run-progress-ledger-projection.js";
import {
  childObservation,
  childProgressPayload,
  parentTerminalSuppressed,
  runEventObservationId,
} from "./run-progress-evidence-helpers.js";
import {
  emptyRunProgressTurnDelta,
  type RunProgressEvidenceMetrics,
  type RunProgressTurnDelta,
} from "./run-progress-evidence-types.js";
import { RunProgressPlanSnapshotAccumulator } from "./run-progress-plan-snapshot-accumulator.js";
import { RunTerminalProjectionFence } from "./run-terminal-projection-fence.js";
import { acceptFirstToolTerminal } from "./run-tool-terminal-projection.js";
import {
  projectSettledToolOperationProgress,
  type SettledToolOperationProgressObservation,
} from "./tool-operation-journal.js";

export class RunProgressEvidenceProjector {
  private acquisitionAttemptCount = 0;
  private acquisitionAttemptCountSinceProgress = 0;
  private acquisitionAdvanceCountSinceProgress = 0;
  private failureDomainBaselineCount = 0;
  private unclassifiedActivityCountSinceProgress = 0;
  private readonly plans = new RunProgressPlanSnapshotAccumulator();
  private readonly supportStates = new Map<string, string>();
  private readonly productStates = new Map<string, string>();
  private readonly acceptanceStates = new Map<string, string>();
  private readonly supportReceipts = new Set<string>();
  private readonly productReceipts = new Set<string>();
  private readonly workspaceProductReceipts = new Set<string>();
  private readonly acceptanceReceipts = new Set<string>();
  private readonly approvalEvidence = new Set<string>();
  private readonly capabilityEvidence = new Set<string>();
  private readonly resultEvidence = new Set<string>();
  private readonly failureFingerprints = new Set<string>();
  private readonly failureDomains = new Set<string>();
  private readonly acquisitionFailureDomains = new Set<string>();
  private readonly toolInputFingerprints = new Map<string, string>();
  private readonly parentAcquisitionAdmissions = new Set<string>();
  private readonly terminalCallIds = new Set<string>();
  private readonly childAdmissionIds = new Set<string>();
  private readonly childSettlementIds = new Set<string>();
  private readonly childOperationEvents: RunEvent[] = [];
  private readonly terminalFence = new RunTerminalProjectionFence();
  private effectReadiness = emptyRunEffectReadinessProjection();

  constructor(
    private readonly runId: string,
    private readonly taskIntentSha256: string,
  ) {}
  ingest(events: RunEvent[]): RunProgressTurnDelta {
    const delta = emptyRunProgressTurnDelta();
    events = this.terminalFence.accept(events, this.runId);
    this.childOperationEvents.push(
      ...events.filter((event) => event.type.startsWith("tool.operation.")),
    );
    const childProjection = projectSettledToolOperationProgress(
      this.childOperationEvents,
    );
    const childByOperationId = new Map(
      childProjection.observations.map((observation) => [
        observation.operationId,
        observation,
      ]),
    );
    const childObservations = childProjection.observations;
    for (const event of events) {
      this.ingestEvent(event, childByOperationId, childObservations, delta);
    }
    return delta;
  }

  resetAcquisitionWindow(): void {
    this.acquisitionAttemptCountSinceProgress = 0;
    this.acquisitionAdvanceCountSinceProgress = 0;
    this.failureDomainBaselineCount = this.acquisitionFailureDomains.size;
    this.unclassifiedActivityCountSinceProgress = 0;
  }

  restoreWindow(input: {
    acquisitionAttemptCount?: number;
    acquisitionAttemptCountSinceProgress?: number;
    acquisitionAdvanceCountSinceProgress?: number;
    failureDomainCountSinceProgress?: number;
    unclassifiedActivityCountSinceProgress?: number;
  }): void {
    this.acquisitionAttemptCount =
      input.acquisitionAttemptCount ?? this.acquisitionAttemptCount;
    this.acquisitionAttemptCountSinceProgress =
      input.acquisitionAttemptCountSinceProgress ??
      this.acquisitionAttemptCountSinceProgress;
    this.acquisitionAdvanceCountSinceProgress =
      input.acquisitionAdvanceCountSinceProgress ??
      this.acquisitionAdvanceCountSinceProgress;
    this.failureDomainBaselineCount = Math.max(
      0,
      this.acquisitionFailureDomains.size -
        (input.failureDomainCountSinceProgress ??
          this.acquisitionFailureDomains.size),
    );
    this.unclassifiedActivityCountSinceProgress =
      input.unclassifiedActivityCountSinceProgress ??
      this.unclassifiedActivityCountSinceProgress;
  }

  dimensions(plan: string, artifact: string): RunProgressDimensionHashes {
    return {
      workspace: hashProgressMap(this.productStates),
      plan,
      artifact,
      source: hashProgressMap(this.supportStates),
      approval: hashProgressSet(this.approvalEvidence),
      capability: hashProgressSet(this.capabilityEvidence),
      result: hashProgressSet(this.resultEvidence),
    };
  }

  currentPlanSnapshots() {
    return this.plans.current();
  }

  metrics(): RunProgressEvidenceMetrics {
    return {
      acquisitionAttemptCount: this.acquisitionAttemptCount,
      acquisitionAttemptCountSinceProgress:
        this.acquisitionAttemptCountSinceProgress,
      acquisitionAdvanceCountSinceProgress:
        this.acquisitionAdvanceCountSinceProgress,
      failureDomainCountSinceProgress: Math.max(
        0,
        this.acquisitionFailureDomains.size - this.failureDomainBaselineCount,
      ),
      unclassifiedActivityCountSinceProgress:
        this.unclassifiedActivityCountSinceProgress,
      workspaceMutationCount: this.workspaceProductReceipts.size,
      supportResourceCount: this.supportStates.size,
      productReceiptCount: this.productReceipts.size,
      supportCount: this.supportReceipts.size,
      acceptanceReceiptCount: this.acceptanceReceipts.size,
      approvalCount: this.approvalEvidence.size,
      capabilityStatusCount: this.capabilityEvidence.size,
      userResultCount: this.resultEvidence.size,
      effectReadiness: this.effectReadiness,
      failureFingerprints: this.failureFingerprints,
      failureDomains: this.failureDomains,
    };
  }

  private ingestEvent(
    event: RunEvent,
    childByOperationId: Map<string, SettledToolOperationProgressObservation>,
    childObservations: readonly SettledToolOperationProgressObservation[],
    delta: RunProgressTurnDelta,
  ): void {
    const payload = progressRecord(event.payload);
    const child = childObservation(payload, childByOperationId);
    this.recordChildAdmission(event, child, delta);
    this.recordChildSettlement(event, child, delta);
    this.recordHostEffect(event, payload, delta);
    this.plans.ingest(progressText(payload?.["planId"]), payload);
    this.recordToolStart(event, payload);
    this.recordToolAdmission(event, payload);
    this.recordToolTerminal(event, payload, childObservations, delta);
    this.recordGeneralEvidence(event, payload, delta);
  }

  private recordChildAdmission(
    event: RunEvent,
    child: SettledToolOperationProgressObservation | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    if (
      (event.type !== "tool.operation.admitted" &&
        event.type !== "tool.operation.settled") ||
      !child?.acquisitionAttempt ||
      this.childAdmissionIds.has(child.operationId)
    ) {
      return;
    }
    this.childAdmissionIds.add(child.operationId);
    this.acquisitionAttemptCount += 1;
    this.acquisitionAttemptCountSinceProgress += 1;
    delta.acquisitionAttempted = true;
  }

  private recordChildSettlement(
    event: RunEvent,
    child: SettledToolOperationProgressObservation | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    if (
      event.type !== "tool.operation.settled" ||
      !child ||
      this.childSettlementIds.has(child.observationId)
    ) {
      return;
    }
    this.childSettlementIds.add(child.observationId);
    this.applyChildOperation(event, child, delta);
  }

  private recordHostEffect(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    const progress = projectHostProgressEffect(event, payload);
    if (progress)
      this.applyObservedToolProgress(event, progress, payload, delta);
  }

  private recordToolStart(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
  ): void {
    if (event.type !== "tool.started") return;
    const callId = progressText(payload?.["callId"]);
    if (callId && payload) {
      this.toolInputFingerprints.set(
        callId,
        runProgressToolInputFingerprint(payload),
      );
    }
  }

  private recordToolAdmission(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
  ): void {
    if (event.type !== "tool.admitted") return;
    const callId = progressText(payload?.["callId"]);
    const progress = stableToolProgress(payload);
    if (callId && progress?.operation === "acquire") {
      this.parentAcquisitionAdmissions.add(callId);
    }
  }

  private recordToolTerminal(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
    childObservations: readonly SettledToolOperationProgressObservation[],
    delta: RunProgressTurnDelta,
  ): void {
    const first = acceptFirstToolTerminal(event, payload, this.terminalCallIds);
    if (!first || parentTerminalSuppressed(event, payload, childObservations)) {
      return;
    }
    this.recordParentAcquisitionAttempt(payload, delta);
    if (event.type === "tool.failed" || event.type === "tool.blocked") {
      this.recordToolFailure(event, payload);
      return;
    }
    if (event.type !== "tool.completed") return;
    const progress = stableToolProgress(payload);
    if (progress?.coverage === "opaque") {
      this.unclassifiedActivityCountSinceProgress += 1;
    }
    if (progress)
      this.applyObservedToolProgress(event, progress, payload, delta);
  }

  private recordParentAcquisitionAttempt(
    payload: Record<string, JsonValue> | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    const callId = progressText(payload?.["callId"]);
    if (!callId || !this.parentAcquisitionAdmissions.delete(callId)) return;
    this.acquisitionAttemptCount += 1;
    this.acquisitionAttemptCountSinceProgress += 1;
    delta.acquisitionAttempted = true;
  }

  private recordToolFailure(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
  ): void {
    this.failureFingerprints.add(
      runProgressFailureFingerprint(event, payload, this.toolInputFingerprints),
    );
    const domain = runProgressFailureDomainFingerprint(
      event,
      payload,
      this.toolInputFingerprints,
    );
    this.failureDomains.add(domain);
    if (isAcquisitionFailure(event, payload)) {
      this.acquisitionFailureDomains.add(domain);
    }
  }

  private recordGeneralEvidence(
    event: RunEvent,
    payload: Record<string, JsonValue> | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    if (isApprovalResolution(event)) {
      const evidence = stableEventEvidence(event);
      if (evidence) this.approvalEvidence.add(evidence);
    }
    if (isCapabilityEvent(event)) {
      const evidence = stableEventEvidence(event);
      if (evidence) this.capabilityEvidence.add(evidence);
    }
    if (event.type !== "message.assistant") return;
    const evidence = assistantEvidence(payload);
    if (!evidence) return;
    addProgressEvidence(this.resultEvidence, evidence);
    delta.terminalDeliveryObserved = true;
    this.effectReadiness = reduceRunEffectReadiness(this.effectReadiness, {
      kind: "assistant_delivery",
      observationId: runEventObservationId(event),
      contentSha256: evidence,
    });
  }

  private applyChildOperation(
    event: RunEvent,
    observation: SettledToolOperationProgressObservation,
    delta: RunProgressTurnDelta,
  ): void {
    if (observation.failureObserved) {
      this.recordChildFailure(observation);
      return;
    }
    if (observation.outcome !== "succeeded") return;
    const payload = childProgressPayload(observation);
    const progress = stableToolProgress(payload);
    if (progress)
      this.applyObservedToolProgress(event, progress, payload, delta);
  }

  private recordChildFailure(
    observation: SettledToolOperationProgressObservation,
  ): void {
    this.failureFingerprints.add(
      sha256(
        canonicalJson({
          operationId: observation.operationId,
          failure: observation.failure ?? null,
        }),
      ),
    );
    const scope = observation.failure?.scope ?? "invocation";
    const binding =
      scope === "invocation"
        ? observation.progress.resourceKeySha256
        : progressFailureBinding(observation.progress, scope);
    const domain = sha256(canonicalJson({ scope, binding }));
    this.failureDomains.add(domain);
    if (observation.acquisitionFailure) {
      this.acquisitionFailureDomains.add(domain);
    }
  }

  private applyObservedToolProgress(
    event: RunEvent,
    progress: StableToolProgress,
    payload: Record<string, JsonValue> | undefined,
    delta: RunProgressTurnDelta,
  ): void {
    const identity = this.progressIdentity(progress, payload);
    const effect = observeRunProgressEffect({
      event,
      progress,
      payload,
      identity,
      objectiveSha256: this.taskIntentSha256,
      readiness: this.effectReadiness,
    });
    this.effectReadiness = effect.readiness;
    delta.productRegressed ||= effect.productRegressed;
    this.unclassifiedActivityCountSinceProgress +=
      effect.unclassifiedActivityDelta;
    for (const acceptance of effect.derivedAcceptance) {
      this.applyToolProgress(
        acceptance.progress,
        undefined,
        delta,
        acceptance.identity,
      );
    }
    if (effect.handledAsVerification) return;
    this.applyToolProgress(
      progress,
      payload,
      delta,
      identity,
      effect.productSemanticallyAdvanced,
    );
  }

  private applyToolProgress(
    progress: StableToolProgress,
    payload: Record<string, JsonValue> | undefined,
    delta: RunProgressTurnDelta,
    resolvedIdentity?: RunProgressIdentity,
    productSemanticallyAdvanced?: boolean,
  ): void {
    if (progress.contribution === "neutral") return;
    const identity =
      resolvedIdentity ?? this.progressIdentity(progress, payload);
    if (!identity) return;
    const states = this.statesFor(progress);
    const receipts = this.receiptsFor(progress);
    const receipt = sha256(canonicalJson(identity));
    const advanced = !receipts.has(receipt);
    receipts.add(receipt);
    states.set(identity.resourceKeySha256, identity.stateSha256);
    if (progress.contribution === "product" && progress.scope === "workspace") {
      this.workspaceProductReceipts.add(receipt);
    }
    if (!advanced || productSemanticallyAdvanced === false) return;
    this.recordAdvancedProgress(progress, delta);
  }

  private statesFor(progress: StableToolProgress): Map<string, string> {
    if (progress.contribution === "support") return this.supportStates;
    if (progress.contribution === "product") return this.productStates;
    return this.acceptanceStates;
  }

  private receiptsFor(progress: StableToolProgress): Set<string> {
    if (progress.contribution === "support") return this.supportReceipts;
    if (progress.contribution === "product") return this.productReceipts;
    return this.acceptanceReceipts;
  }

  private recordAdvancedProgress(
    progress: StableToolProgress,
    delta: RunProgressTurnDelta,
  ): void {
    if (progress.operation === "acquire") {
      delta.acquisitionAttempted = true;
      delta.acquisitionAdvanced = true;
      this.acquisitionAdvanceCountSinceProgress += 1;
    }
    if (progress.contribution === "support") {
      delta.supportAdvanced = true;
      return;
    }
    this.resetAcquisitionWindow();
    if (progress.contribution === "product") {
      delta.productAdvanced = true;
      delta.workspaceProductAdvanced ||= progress.scope === "workspace";
      return;
    }
    delta.acceptanceAdvanced = true;
  }

  private progressIdentity(
    progress: StableToolProgress,
    payload: Record<string, JsonValue> | undefined,
  ): RunProgressIdentity | undefined {
    const stateSha256 = progress.stateSha256 ?? stableStateHash(payload);
    const callId = progressText(payload?.["callId"]);
    const resourceKeySha256 =
      progress.resourceKeySha256 ??
      (callId ? this.toolInputFingerprints.get(callId) : undefined) ??
      stateSha256;
    return resourceKeySha256 && stateSha256
      ? { resourceKeySha256, stateSha256 }
      : undefined;
  }
}

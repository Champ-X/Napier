import { realpathSync } from "node:fs";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { JsonObject, RunEvent } from "@napier/contracts";
import type { ModelAccountingPhase, ModelCallAttributionV1, ModelCallCaptureBinding, ModelCallMethod } from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, nowIso } from "./ids.js";
import { assertModelPreparationOwner, assertNativeAccountingRun } from "./model-accounting-authority.js";
import { foldModelAccounting } from "./model-accounting-fold.js";
import { freezeModelCallBudgetAllowance } from "./model-call-budget-allowance.js";
import { modelRunBudgetExposure } from "./model-run-budget-exposure.js";
import { ConcurrentStoreUpdateError } from "./sqlite-ledger-errors.js";
import type { ModelAccountingHost } from "./model-accounting-host.js";
import { assertUnsealedAccountingChild, refreshRunAccounting } from "./model-accounting-projection.js";
import { enterPreparedModelCall, issueModelUsagePreparationAuthority, issuePreparedModelCall,
  readModelUsagePreparationAuthority, readModelUndispatchedDriverProof, readPreparedModelCall,
  type ModelUsagePreparationAuthority, type ModelUsagePreparationOwner, type ModelUndispatchedDriverProof,
  type PreparedModelCall, type EnteredModelCall } from "./model-call-attribution.js";
import { readVerifiedModelUsageDelivery, type VerifiedModelUsageDelivery } from "./model-usage-delivery.js";
import { createUndispatchedModelObservation, freezeModelAccountingBasis, validateModelCallAttribution } from "./model-usage-observation.js";
import type { ModelUsageSource } from "./model-usage-source.js";
import { assertChildRunFence } from "./subagent-child-run-fence.js";
import { readModelAttemptReceipt, type ModelAttemptReceiptInput } from "./model-attempt-receipt.js";

export interface ModelAccountingPrepareInput {
  owner: ModelUsagePreparationAuthority;
  method: ModelCallMethod;
  phase: ModelAccountingPhase;
  logicalCallId: string;
  model: Model<Api>;
  capture: ModelCallCaptureBinding;
  route?: ModelCallAttributionV1["route"];
  recovery?: ModelCallAttributionV1["recovery"];
}
export interface ModelUsageReconciliation {
  outcome: "applied" | "duplicate";
  physicalId: string;
  receiptSha256: string;
  accountingRevision: number;
  parentAccountingRevision?: number;
}
export interface ModelAccountingSourceConfiguration {
  source: ModelUsageSource;
  hostWorkspaceId?: string;
  isDeclaredZeroCost?: (model: { provider: string; id: string }) => boolean;
}

/** Native attribution and accounting only. This repository never settles logical execution. */
export class ModelAccountingRepository {
  #configuration?: ModelAccountingSourceConfiguration;
  readonly #host: ModelAccountingHost;
  readonly #persist: (events: RunEvent[], mutation: import("./sqlite-model-accounting.js").LedgerModelAccountingMutation) => Promise<void>;
  constructor(host: ModelAccountingHost,
    persist: (events: RunEvent[], mutation: import("./sqlite-model-accounting.js").LedgerModelAccountingMutation) => Promise<void>) {
    this.#host = host; this.#persist = persist;
  }
  isConfigured(): boolean { return this.#configuration !== undefined; }

  configureSource(input: ModelAccountingSourceConfiguration): void {
    this.#host.assertInitialized();
    if (this.#configuration && (this.#configuration.source.sourceId !== input.source.sourceId ||
      this.#configuration.hostWorkspaceId !== input.hostWorkspaceId)) throw new Error("Model accounting source cannot be rebound");
    const ledgerId = this.workspaceLedgerId();
    for (const delivery of input.source.pending({ ...(input.hostWorkspaceId ? { hostWorkspaceId: input.hostWorkspaceId } : {}), limit: 10_000 })) {
      if (readVerifiedModelUsageDelivery(delivery).attribution.workspaceLedgerId !== ledgerId)
        throw new Error("Pending model usage belongs to another workspace ledger; reconciliation is required");
    }
    this.#configuration = { ...input };
  }

  workspaceLedgerId(): string { this.#host.assertInitialized(); return this.#host.requireLedger().modelAccountingIdentity(); }

  runAuthority(input: { runId: string; token: string }): ModelUsagePreparationAuthority {
    this.#host.assertInitialized();
    const run = this.#host.mutableRun(input.runId);
    return this.#authority({ kind: "run", threadId: run.threadId, ...input });
  }
  childAuthority(input: Extract<ModelUsagePreparationOwner, { kind: "child" }>): ModelUsagePreparationAuthority {
    this.#host.assertInitialized(); return this.#authority(input);
  }
  operationAuthority(input: { operationId: string; operation: ModelAccountingPhase }): ModelUsagePreparationAuthority {
    this.#host.assertInitialized(); return this.#authority({ kind: "operation", ...input });
  }

  async prepare(input: ModelAccountingPrepareInput): Promise<PreparedModelCall> {
    const binding = readModelUsagePreparationAuthority(input.owner, this);
    if (input.capture.admittedModelSha256 !== sha256(canonicalJson(input.model)))
      throw new Error("Model accounting capture differs from admitted model");
    const configuration = this.#config();
    const { token: _token, expectedExecutionRevision: _revision, ...owner } = binding.owner as ModelUsagePreparationOwner &
      { token?: string; expectedExecutionRevision?: number };
    const accountingBasis = freezeModelAccountingBasis(input.model,
      { declaredZeroCost: configuration.isDeclaredZeroCost?.(input.model) === true });
    const content = { kind: "napier.model-call-attribution" as const, schemaVersion: 1 as const,
      physicalId: createId("physical"), workspaceLedgerId: this.workspaceLedgerId(), receiptSourceId: configuration.source.sourceId,
      ...(configuration.hostWorkspaceId ? { hostWorkspaceId: configuration.hostWorkspaceId } : {}),
      owner, method: input.method, phase: input.phase, logicalCallId: input.logicalCallId,
      model: { provider: input.model.provider, id: input.model.id, api: input.model.api },
      capture: structuredClone(input.capture), accountingBasis,
      budgetAllowance: freezeModelCallBudgetAllowance(input.model, input.capture, accountingBasis),
      ...(input.route ? { route: structuredClone(input.route) } : {}),
      ...(input.recovery ? { recovery: structuredClone(input.recovery) } : {}), createdAt: nowIso() };
    const attribution = validateModelCallAttribution({ ...content, contentSha256: sha256(canonicalJson(content)) });
    this.#host.assertInitialized();
    await this.#host.stateQueue.run(async () => {
      assertModelPreparationOwner(this.#host, binding.owner);
      if (binding.owner.kind === "child") {
        const childOwner = binding.owner;
        const reserved = this.#host.requireLedger().listRunEvents(childOwner.runId).find((event) =>
          event.type === "subagent.child.invocation_reserved" && object(event.payload)["invocationId"] === childOwner.childInvocationId);
        if (object(reserved?.payload)["phase"] !== input.phase) throw new Error("Model accounting child phase differs");
        if (input.capture.envelope.turnIndex !== childOwner.invocationIndex - 1)
          throw new Error("Model accounting child capture index differs");
      }
      const events = this.#events(attribution, "model.accounting.prepared", { attribution: json(attribution) });
      if (attribution.owner.kind !== "operation") refreshRunAccounting(this.#host, attribution.owner.runId, events);
      await this.#persist(events, { kind: "prepare", attribution: {
        physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256, attributionJson: canonicalJson(attribution),
        runId: attribution.owner.kind === "operation" ? null : attribution.owner.runId,
        childInvocationId: attribution.owner.kind === "child" ? attribution.owner.childInvocationId : null,
        ...this.#roots(), state: "prepared" } });
    });
    return issuePreparedModelCall({ repository: this, authority: input.owner, attribution });
  }

  async enter(call: PreparedModelCall): Promise<EnteredModelCall> {
    const binding = readPreparedModelCall(call, this);
    const authority = readModelUsagePreparationAuthority(binding.authority, this);
    this.#host.assertInitialized();
    await this.#host.stateQueue.run(async () => {
      assertModelPreparationOwner(this.#host, authority.owner);
      this.#assertAttribution(binding.attribution);
      if (authority.owner.kind !== "operation") this.#assertBudget(authority.owner.runId, binding.attribution);
      const events = this.#events(binding.attribution, "model.accounting.dispatch_intent", reference(binding.attribution));
      if (binding.attribution.owner.kind !== "operation") refreshRunAccounting(this.#host, binding.attribution.owner.runId, events);
      await this.#persist(events, { kind: "enter", physicalId: binding.attribution.physicalId,
        attributionSha256: binding.attribution.contentSha256 });
    });
    return enterPreparedModelCall(call, this);
  }

  async rejectUndispatched(proof: ModelUndispatchedDriverProof, _reason: string): Promise<ModelUsageReconciliation> {
    const binding = readModelUndispatchedDriverProof(proof, this);
    const attribution = binding.attribution;
    if (!attribution) throw new Error("Unprepared child requires logical undispatched closure");
    const source = this.#config().source;
    this.#host.assertInitialized();
    this.#assertAttribution(attribution);
    const claim = this.#host.requireLedger().modelUsageClaim(attribution.physicalId);
    if (claim) {
      if (JSON.parse(claim.receiptJson).terminal !== "undispatched") throw new Error("Final physical receipt conflicts with undispatched proof");
      return this.#result("duplicate", attribution, claim.receiptSha256);
    }
    source.reserve(attribution);
    let delivery = source.pending({ physicalId: attribution.physicalId, limit: 1 })[0];
    if (!delivery) {
      source.record(createUndispatchedModelObservation(attribution, proof));
      delivery = source.pending({ physicalId: attribution.physicalId, limit: 1 })[0];
    }
    if (!delivery) throw new Error("Durable undispatched receipt is unavailable");
    const result = await this.#reconcile(delivery);
    source.acknowledge(delivery);
    return result;
  }

  async closeUndispatchedChildInvocation(proof: ModelUndispatchedDriverProof, reason: string): Promise<void> {
    const binding = readModelUndispatchedDriverProof(proof, this);
    const { owner } = readModelUsagePreparationAuthority(binding.authority, this);
    if (binding.attribution || owner.kind !== "child") throw new Error("Logical undispatched closure requires an unprepared child reservation");
    if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(reason)) throw new Error("Undispatched reason must be a bounded code");
    this.#host.assertInitialized();
    await this.#host.stateQueue.run(async () => {
      if (this.#host.requireLedger().modelChildInvocationClosed(owner.childInvocationId)) return;
      assertChildRunFence(this.#host, owner, { requireParentActive: false, checkRevision: false });
      const events = this.#host.appendEventsToThread(this.#host.mutableThread(owner.threadId), [{
        threadId: owner.threadId, runId: owner.runId, type: "model.accounting.child_undispatched",
        category: "model", visibility: "debug", payload: { childInvocationId: owner.childInvocationId,
          executionId: owner.executionId, taskId: owner.taskId, reason } }]);
      refreshRunAccounting(this.#host, owner.runId, events);
      await this.#persist(events, { kind: "close_child", childInvocationId: owner.childInvocationId, runId: owner.runId });
    });
  }

  reconcile(delivery: VerifiedModelUsageDelivery): Promise<ModelUsageReconciliation> { return this.#reconcile(delivery); }

  async #reconcile(delivery: VerifiedModelUsageDelivery): Promise<ModelUsageReconciliation> {
    readVerifiedModelUsageDelivery(delivery);
    this.#host.assertInitialized();
    return this.#host.stateQueue.run(async () => {
      const { sourceId, attribution, observation } = readVerifiedModelUsageDelivery(delivery);
      if (sourceId !== this.#config().source.sourceId) throw new Error("Model usage delivery source differs");
      this.#assertAttribution(attribution);
      const attempt = this.#host.requireLedger().readModelAttemptView(attribution.physicalId);
      const previous = attempt.claim;
      if (previous) {
        if (previous.attributionSha256 !== attribution.contentSha256 || previous.receiptJson !== canonicalJson(observation))
          throw new Error("Final model accounting claim conflicts; reconciliation is required");
        return this.#result("duplicate", attribution, observation.contentSha256);
      }
      try {
        if (attribution.owner.kind !== "operation") {
          const run = this.#host.mutableRun(attribution.owner.runId);
          assertNativeAccountingRun(this.#host, run);
          assertUnsealedAccountingChild(this.#host, run);
        }
        const events = this.#events(attribution, "model.usage.reconciled", { ...reference(attribution), observation: json(observation) });
        if (attribution.owner.kind !== "operation") refreshRunAccounting(this.#host, attribution.owner.runId, events);
        await this.#persist(events, { kind: "claim", claim: {
          physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256,
          receiptSha256: observation.contentSha256, receiptJson: canonicalJson(observation), eventId: events[0]?.id ?? null } });
        return this.#result("applied", attribution, observation.contentSha256);
      } catch (error) {
        // A different process can commit between the coherent claim read and
        // projection reads. Retry only a proven revision change, never an
        // invalid receipt on a stable ledger, and discard any appended heap event.
        const current = this.#host.requireLedger().readModelAttemptView(attribution.physicalId);
        this.#host.refreshStateFromLedger(true);
        if (attempt.snapshot && current.snapshot && attempt.snapshot.revision !== current.snapshot.revision) {
          throw new ConcurrentStoreUpdateError(attempt.snapshot.revision, current.snapshot.revision);
        }
        throw error;
      }
    });
  }

  async readRunAccounting(runId: string) {
    this.#host.assertInitialized();
    const { snapshot, events } = this.#host.requireLedger().readRunAccountingView(runId);
    if (!snapshot) throw new Error("Workspace accounting snapshot is unavailable");
    const state = JSON.parse(snapshot.stateJson) as ModelAccountingHost["state"];
    const run = state.runs.find((value) => value.id === runId);
    if (!run) throw new Error("Accounting Run is unavailable");
    const tasks = state.subagents.filter((task) => task.runId === runId);
    const result = foldModelAccounting(events, tasks, run.accounting);
    return { workspaceRevision: snapshot.revision, runId, accountingRevision: result.summary.revision,
      usage: result.usage, usageStatus: result.summary.usageStatus, knownBudgetCostUsd: result.summary.knownBudgetCostUsd, summary: result.summary };
  }

  readAttemptReceipt(input: ModelAttemptReceiptInput) {
    this.#host.assertInitialized();
    const configuration = this.#config();
    return readModelAttemptReceipt(input, this, this.#host.requireLedger(), {
      sourceId: configuration.source.sourceId, ...this.#roots(),
      ...(configuration.hostWorkspaceId ? { hostWorkspaceId: configuration.hostWorkspaceId } : {}),
    });
  }

  #authority(owner: ModelUsagePreparationOwner): ModelUsagePreparationAuthority {
    assertModelPreparationOwner(this.#host, owner);
    return issueModelUsagePreparationAuthority({ repository: this, owner });
  }
  #config(): ModelAccountingSourceConfiguration {
    if (!this.#configuration) throw new Error("Native model accounting source is not configured");
    return this.#configuration;
  }
  #roots() { return { dataRootSha256: sha256(realpathSync(this.#host.dataRoot)), workspaceRootSha256: sha256(realpathSync(this.#host.workspaceRoot)) }; }
  #assertAttribution(attribution: ModelCallAttributionV1): void {
    const native = this.#host.requireLedger().modelAttribution(attribution.physicalId), roots = this.#roots(), config = this.#config();
    if (!native || native.attributionJson !== canonicalJson(attribution) || native.dataRootSha256 !== roots.dataRootSha256 ||
        native.workspaceRootSha256 !== roots.workspaceRootSha256 || attribution.workspaceLedgerId !== this.#host.requireLedger().modelAccountingIdentity() ||
        attribution.receiptSourceId !== config.source.sourceId || attribution.hostWorkspaceId !== config.hostWorkspaceId)
      throw new Error("Model usage lacks matching native workspace/source attribution");
  }
  #events(attribution: ModelCallAttributionV1, type: "model.accounting.prepared" | "model.accounting.dispatch_intent" | "model.usage.reconciled", payload: JsonObject): RunEvent[] {
    if (attribution.owner.kind === "operation") return [];
    return this.#host.appendEventsToThread(this.#host.mutableThread(attribution.owner.threadId), [{ threadId: attribution.owner.threadId,
      runId: attribution.owner.runId, type, category: "model", visibility: "debug", payload }]);
  }
  #result(outcome: "applied" | "duplicate", attribution: ModelCallAttributionV1, receiptSha256: string): ModelUsageReconciliation {
    const run = attribution.owner.kind === "operation" ? undefined : this.#host.mutableRun(attribution.owner.runId);
    return { outcome, physicalId: attribution.physicalId, receiptSha256, accountingRevision: run?.accounting?.revision ?? 0,
      ...(run?.parentRunId && run.subagent ? { parentAccountingRevision: this.#host.mutableRun(run.parentRunId).accounting?.revision ?? 0 } : {}) };
  }
  #assertBudget(runId: string, attribution: ModelCallAttributionV1, seen = new Set<string>()): void {
    if (seen.has(runId)) throw new Error("Model budget ancestor lineage contains a cycle");
    seen.add(runId);
    const run = this.#host.mutableRun(runId);
    const allowance = attribution.budgetAllowance;
    if (!allowance) throw new Error("Model invocation requires a fresh native budget allowance");
    const exposure = modelRunBudgetExposure(this.#host, runId);
    if (run.limits) {
      if (exposure.unboundedInvocations || exposure.reservedCostUsd === null)
        throw new Error("Model invocation budget requires reconciliation: unresolved historical usage has no bounded allowance");
      if (allowance.budgetCostUsd === null)
        throw new Error("Model invocation budget is unavailable: unknown price requires a known tariff or explicit zero-cost declaration");
      const tokensExceeded = run.limits.maxTotalTokens > 0 &&
        exposure.accountedTokens + exposure.reservedTokens + allowance.budgetTokens > run.limits.maxTotalTokens;
      if (tokensExceeded || exposure.accountedCostUsd + exposure.reservedCostUsd + allowance.budgetCostUsd > run.limits.maxCostUsd)
        throw new Error(`Model invocation exceeds its current accounted Run budget plus in-flight allowance for ${tokensExceeded ? "tokens" : "cost"} (${allowance.input.policy})`);
    }
    if (run.subagent && run.parentRunId) this.#assertBudget(run.parentRunId, attribution, seen);
  }
}

function json(value: unknown): JsonObject { return JSON.parse(canonicalJson(value)) as JsonObject; }
function reference(attribution: ModelCallAttributionV1): JsonObject {
  return { physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256, accountingMode: "physical_receipt_v1" };
}
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }

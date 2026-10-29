import { DatabaseSync } from "node:sqlite";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { ModelCallAdmissionError, type ModelCallAdmission, type ModelCallLease } from "./model-call-admission.js";
import { readEnteredModelCall, type EnteredModelCall } from "./model-call-attribution.js";
import { bindModelAccountingSource } from "./model-accounting-binding.js";
import { nativeAccountingDestination } from "./model-accounting-destination.js";
import { normalizeModelPhysicalObservation } from "./model-usage-observation.js";
import { ModelUsageReceiptSpool, type ModelUsageSource } from "./model-usage-source.js";
import { readVerifiedModelUsageDelivery, type VerifiedModelUsageDelivery } from "./model-usage-delivery.js";
import type { HostModelAccountingPolicy, HostModelReservation } from "./host-model-accounting-policy.js";

/** Host-lifetime source ownership. Low-level receipt authority never crosses this boundary. */
export class HostModelAccounting<Reservation extends HostModelReservation> {
  readonly #source: ModelUsageReceiptSpool;
  readonly #pending = new Map<string, { workspaceId: string; promise: Promise<void>; done(): void; fail(error: unknown): void }>();
  #closed = false;

  readonly #database: DatabaseSync;
  readonly #policy: HostModelAccountingPolicy<Reservation>;
  private constructor(database: DatabaseSync, policy: HostModelAccountingPolicy<Reservation>) {
    try { DatabaseSync.prototype.prepare.call(database, "SELECT 1").get(); }
    catch (cause) { throw new Error("Host model accounting requires a native SQLite database", { cause }); }
    this.#database = database;
    this.#policy = capturePolicy(policy);
    this.#source = ModelUsageReceiptSpool.attach(database);
  }

  static attach<Reservation extends HostModelReservation>(input: {
    database: DatabaseSync; policy: HostModelAccountingPolicy<Reservation>;
  }): HostModelAccounting<Reservation> {
    return new HostModelAccounting(input.database, input.policy);
  }

  forWorkspace(workspaceId: string): ModelCallAdmission {
    this.#assertWorkspace(workspaceId);
    const source = this.#scopedSource(workspaceId);
    const admission: ModelCallAdmission = Object.freeze({
      reserve: (input: Parameters<ModelCallAdmission["reserve"]>[0]) => {
        if (input.attribution) throw new ModelCallAdmissionError("accounting", { cause: new Error("Native dispatch authority is required") });
        return this.#reserve(workspaceId, input);
      },
      errorCode: (error: unknown) => this.#policy.errorCode(error),
      isDeclaredZeroCost: (model: { provider: string; id: string }) => this.#policy.isDeclaredZeroCost(model),
    });
    bindModelAccountingSource(admission, { source, hostWorkspaceId: workspaceId,
      reserve: (input, call) => this.#reserve(workspaceId, input, call) });
    return admission;
  }

  hasPendingUsage(workspaceId?: string): boolean {
    this.#assertOpen();
    if (workspaceId !== undefined) this.#assertWorkspace(workspaceId);
    return this.#source.pending({ ...(workspaceId ? { hostWorkspaceId: workspaceId } : {}), limit: 1 }).length > 0;
  }

  hasPendingPhysical(workspaceId?: string): boolean {
    return [...this.#pending.values()].some((entry) => workspaceId === undefined || entry.workspaceId === workspaceId);
  }

  async drainWorkspace(workspaceId: string): Promise<void> {
    this.#assertWorkspace(workspaceId);
    while (this.hasPendingPhysical(workspaceId))
      await Promise.all([...this.#pending.values()].filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.promise));
  }

  /** Accepts a native Store identity, not its overridable methods or a projection callback. */
  async reconcileWorkspace(input: { workspaceId: string; store: object }): Promise<void> {
    this.#assertWorkspace(input.workspaceId);
    const destination = nativeAccountingDestination(input.store);
    const source = this.#scopedSource(input.workspaceId);
    // Entire-target identity preflight precedes any ACK; an overlarge target remains pending.
    this.#assertPendingBound(input.workspaceId);
    destination.configureSource({ source, hostWorkspaceId: input.workspaceId,
      isDeclaredZeroCost: (model) => this.#policy.isDeclaredZeroCost(model) });
    const ledgerId = destination.workspaceLedgerId();
    for (let batch = 0; batch < 10; batch += 1) {
      const deliveries = source.pending({ limit: 128 });
      if (!deliveries.length) return;
      const failures: unknown[] = [];
      for (const delivery of deliveries) {
        try {
          if (readVerifiedModelUsageDelivery(delivery).attribution.workspaceLedgerId !== ledgerId)
            throw new Error("Model usage destination ledger changed");
          await destination.reconcile(delivery);
          source.acknowledge(delivery);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Workspace model usage requires reconciliation");
    }
    if (this.hasPendingUsage(input.workspaceId))
      throw new Error("Workspace model usage replay batch limit reached; durable receipts remain pending");
  }

  close(): void {
    if (this.#closed) return;
    if (this.#pending.size) throw new ModelCallAdmissionError("accounting", { cause: new Error("Physical model calls or accounting failures remain pending") });
    this.#source.close();
    this.#closed = true;
  }

  #reserve(workspaceId: string, input: Parameters<ModelCallAdmission["reserve"]>[0], call?: EnteredModelCall): ModelCallLease {
    this.#assertOpen();
    input.options?.signal?.throwIfAborted();
    const attribution = input.attribution;
    if (attribution) {
      if (!call || readEnteredModelCall(call).attribution !== attribution ||
          attribution.hostWorkspaceId !== workspaceId || attribution.receiptSourceId !== this.#source.sourceId ||
          attribution.method !== input.method || attribution.model.provider !== input.model.provider ||
          attribution.model.id !== input.model.id || attribution.model.api !== input.model.api)
        throw new ModelCallAdmissionError("accounting");
    }
    const reservation = this.#transaction(() => {
      const result = synchronous(this.#policy.reserve(workspaceId, input));
      if (result.workspaceId !== workspaceId || (attribution && result.id !== attribution.physicalId))
        throw new ModelCallAdmissionError("accounting");
      if (attribution) this.#source.reserve(attribution);
      return result;
    });
    let done!: () => void, fail!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
    void promise.catch(() => undefined);
    this.#pending.set(reservation.id, { workspaceId, promise, done, fail });
    let settled = false, observation: ModelPhysicalObservationV1 | undefined;
    return { settle: (message?: AssistantMessage) => {
      if (settled) return;
      try {
        observation ??= attribution ? normalizeModelPhysicalObservation({ attribution,
          ...(message ? { message } : {}), terminal: message ? "response" : "rejected" }) : undefined;
        this.#transaction(() => {
          if (observation) this.#source.record(observation);
          synchronous(this.#policy.settle(reservation, observation
            ? { kind: "attributed", observation: structuredClone(observation) }
            : { kind: "legacy", ...(message ? { message } : {}) }));
        });
        settled = true;
        this.#completePhysical(reservation.id);
      } catch (error) {
        this.#pending.get(reservation.id)?.fail(new ModelCallAdmissionError("accounting", { cause: error }));
        throw error;
      }
    } };
  }

  #scopedSource(workspaceId: string): ModelUsageSource {
    const scoped = (attribution: ModelCallAttributionV1 | undefined): ModelCallAttributionV1 => {
      this.#assertOpen();
      if (!attribution || attribution.hostWorkspaceId !== workspaceId || attribution.receiptSourceId !== this.#source.sourceId)
        throw new Error("Model usage source workspace mismatch");
      return attribution;
    };
    return Object.freeze({
      sourceId: this.#source.sourceId,
      reserve: (attribution: ModelCallAttributionV1) => this.#transaction(() => this.#source.reserve(scoped(attribution))),
      attribution: (physicalId: string) => {
        this.#assertOpen();
        const value = this.#source.attribution(physicalId);
        return value?.hostWorkspaceId === workspaceId ? value : undefined;
      },
      record: (observation: ModelPhysicalObservationV1) => {
        const attribution = scoped(this.#source.attribution(observation.physicalId));
        if (observation.terminal !== "undispatched" || observation.usageStatus !== "known_zero_undispatched")
          throw new Error("Physical model observations require their host admission lease");
        const result = this.#transaction(() => {
          // Keep the privately authorized original object through source validation.
          const recorded = this.#source.record(observation);
          synchronous(this.#policy.undispatched(structuredClone(attribution), structuredClone(observation), recorded));
          return recorded;
        });
        this.#completePhysical(attribution.physicalId);
        return result;
      },
      pending: (filter: Parameters<ModelUsageSource["pending"]>[0] = {}) => {
        this.#assertOpen();
        if (filter.hostWorkspaceId !== undefined && filter.hostWorkspaceId !== workspaceId)
          throw new Error("Model usage source workspace mismatch");
        if (filter.limit === 10_000) this.#assertPendingBound(workspaceId);
        return this.#source.pending({ ...filter, hostWorkspaceId: workspaceId });
      },
      acknowledge: (delivery: VerifiedModelUsageDelivery) => {
        const { attribution, observation } = readVerifiedModelUsageDelivery(delivery);
        scoped(attribution);
        this.#transaction(() => {
          this.#source.acknowledge(delivery);
          synchronous(this.#policy.acknowledge(structuredClone(attribution), structuredClone(observation)));
        });
      },
    });
  }

  #assertPendingBound(workspaceId: string): void {
    const count = this.#database.prepare(`SELECT count(*) AS amount FROM model_usage_receipts r
      JOIN model_usage_reservations a ON a.physical_id=r.physical_id
      WHERE r.acknowledged_at IS NULL AND a.host_workspace_id=?`).get(workspaceId)?.["amount"];
    if (Number(count) > 10_000) throw new Error("Workspace model usage identity preflight limit reached; durable receipts remain pending");
  }

  #completePhysical(id: string): void { this.#pending.get(id)?.done(); this.#pending.delete(id); }
  #assertWorkspace(workspaceId: string): void {
    this.#assertOpen();
    if (!/^workspace_[a-f0-9]{64}$/u.test(workspaceId)) throw new Error("Invalid model admission workspace");
  }
  #assertOpen(): void {
    if (this.#closed) throw new ModelCallAdmissionError("closed");
    synchronous(this.#policy.assertOpen());
  }
  #transaction<T>(operation: () => T): T {
    this.#assertOpen();
    if (this.#database.isTransaction) throw new Error("Host model accounting requires its own synchronous transaction");
    this.#database.exec("BEGIN IMMEDIATE");
    try { const result = synchronous(operation()); this.#database.exec("COMMIT"); return result; }
    catch (error) { this.#database.exec("ROLLBACK"); throw error; }
  }
}

function synchronous<T>(value: T): T {
  if (value && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function") {
    void Promise.resolve(value).catch(() => undefined);
    throw new Error("Host model accounting policy must be synchronous");
  }
  return value;
}

function capturePolicy<Reservation extends HostModelReservation>(policy: HostModelAccountingPolicy<Reservation>): HostModelAccountingPolicy<Reservation> {
  for (const key of ["assertOpen", "reserve", "settle", "undispatched", "acknowledge", "errorCode", "isDeclaredZeroCost"] as const) {
    if (typeof policy[key] !== "function" || Object.prototype.toString.call(policy[key]) === "[object AsyncFunction]")
      throw new Error("Host model accounting policy must be synchronous");
  }
  return Object.freeze({
    assertOpen: policy.assertOpen.bind(policy), reserve: policy.reserve.bind(policy), settle: policy.settle.bind(policy),
    undispatched: policy.undispatched.bind(policy), acknowledge: policy.acknowledge.bind(policy),
    errorCode: policy.errorCode.bind(policy), isDeclaredZeroCost: policy.isDeclaredZeroCost.bind(policy),
  });
}

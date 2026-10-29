import { randomUUID } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModelRegistry } from "@napier/runtime/model";
import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import {
  ModelUsageReceiptSpool, normalizeModelPhysicalObservation, readVerifiedModelUsageDelivery,
  type ModelUsageSource, type VerifiedModelUsageDelivery,
} from "@napier/runtime/internal";
import {
  modelCallAccounting, modelCallAllowance, modelPhysicalAccounting, USD_NANOS, workspaceModelBudgetPolicy,
  type WorkspaceModelBudgetOptions, type WorkspaceModelBudgetPolicy,
} from "./workspace-model-budget.js";
import { validWorkspaceRuntimeId } from "./workspace-runtime-identity.js";
import { workspaceModelUsageSource } from "./workspace-model-usage-source.js";

type ModelCallAdmission = NonNullable<ConstructorParameters<typeof ModelRegistry>[1]>;
type ModelCallLease = ReturnType<ModelCallAdmission["reserve"]>;
class WorkspaceModelAdmissionError extends Error {
  constructor(readonly code: "capacity" | "budget" | "accounting" | "closed", options?: ErrorOptions) {
    super(`Workspace model admission: ${code}`, options);
    this.name = "WorkspaceModelAdmissionError";
  }
}

interface Totals {
  invocations: number; active: number; uncertain: number; unknown_cost: number;
  tokens: number; cost: number; observed_tokens: number; observed_cost: number;
}

/** Shared by every workspace and every server using this state home. A failed or
 * lost call never refunds its allowance merely because its local owner exited. */
export class WorkspaceModelAdmission {
  private readonly ownerId = randomUUID();
  private readonly pending = new Map<string, { workspaceId: string; promise: Promise<void>; done(): void; fail(error: Error): void }>();
  private closed = false;
  private readonly usageSpool: ModelUsageReceiptSpool;

  private constructor(private readonly db: DatabaseSync, private readonly policy: WorkspaceModelBudgetPolicy) {
    this.usageSpool = ModelUsageReceiptSpool.attach(db);
  }

  static async open(stateHome: string, options: WorkspaceModelBudgetOptions = {}): Promise<WorkspaceModelAdmission> {
    const policy = workspaceModelBudgetPolicy(options);
    await mkdir(stateHome, { recursive: true, mode: 0o700 });
    const filename = path.join(stateHome, "model-admission.sqlite");
    const file = await open(filename, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return undefined;
    });
    await file?.close();
    if (!(await lstat(filename)).isFile()) throw new Error("Invalid model admission ledger file");
    const db = new DatabaseSync(filename);
    try {
      db.exec(`PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS model_budget_policies(epoch TEXT PRIMARY KEY, policy_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS model_admission_hosts(owner_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, maximum INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS model_invocations(
          id TEXT PRIMARY KEY, epoch TEXT NOT NULL, workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL, pid INTEGER NOT NULL,
          method TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL,
          reserved_tokens INTEGER NOT NULL, reserved_cost INTEGER, charged_tokens INTEGER NOT NULL, charged_cost INTEGER,
          observed_tokens INTEGER, observed_cost INTEGER, allowance_json TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT);
        CREATE INDEX IF NOT EXISTS model_invocations_epoch ON model_invocations(epoch);
        CREATE INDEX IF NOT EXISTS model_invocations_active ON model_invocations(state, owner_id);`);
      const admission = new WorkspaceModelAdmission(db, policy);
      admission.transaction(() => {
        admission.reconcileDeadOwners();
        const { maxConcurrent: _capacity, ...budget } = policy;
        const encoded = JSON.stringify(budget);
        const previous = db.prepare("SELECT policy_json FROM model_budget_policies WHERE epoch=?").get(policy.epoch);
        if (previous && previous["policy_json"] !== encoded) throw new Error("Model budget policy changed; use an explicit new budget epoch to renew its allowance");
        db.prepare("INSERT OR IGNORE INTO model_budget_policies VALUES(?,?)").run(policy.epoch, encoded);
        db.prepare("INSERT INTO model_admission_hosts VALUES(?,?,?)").run(admission.ownerId, process.pid, policy.maxConcurrent);
      });
      return admission;
    } catch (error) { db.close(); throw error; }
  }

  forWorkspace(workspaceId: string): ModelCallAdmission {
    if (!validWorkspaceRuntimeId(workspaceId)) throw new Error("Invalid model admission workspace");
    return {
      reserve: (input) => this.reserve(workspaceId, input),
      errorCode: (error) => error instanceof WorkspaceModelAdmissionError ? error.code : undefined,
      usageSource: this.usageSource(workspaceId),
      hostWorkspaceId: workspaceId,
      isDeclaredZeroCost: (model) => this.policy.zeroCostModels.includes(`${model.provider}/${model.id}`),
    };
  }

  usageSource(workspaceId: string): ModelUsageSource {
    if (!validWorkspaceRuntimeId(workspaceId)) throw new Error("Invalid model admission workspace");
    return workspaceModelUsageSource({
      source: this.usageSpool, workspaceId, assertOpen: () => this.assertOpen(),
      transaction: (operation) => this.transaction(operation),
      undispatched: (attribution, observation) => this.recordUndispatched(attribution, observation),
      acknowledge: (delivery) => this.acknowledgeUsage(delivery),
    });
  }

  hasPendingUsage(workspaceId: string): boolean {
    this.assertOpen();
    if (!validWorkspaceRuntimeId(workspaceId)) throw new Error("Invalid model admission workspace");
    return this.usageSpool.pending({ hostWorkspaceId: workspaceId, limit: 1 }).length > 0;
  }

  hasPending(workspaceId: string): boolean {
    return [...this.pending.values()].some((entry) => entry.workspaceId === workspaceId);
  }

  async drainWorkspace(workspaceId: string): Promise<void> {
    while (this.hasPending(workspaceId)) {
      await Promise.all([...this.pending.values()].filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.promise));
    }
  }

  snapshot() {
    this.assertOpen();
    return this.transaction(() => {
      this.reconcileDeadOwners();
      const totals = this.totals();
      return {
        policy: { ...this.policy, zeroCostModels: [...this.policy.zeroCostModels] },
        effectiveMaxConcurrent: this.maximum(), activeInvocations: this.activeCount(),
        budgetInvocations: totals.invocations, uncertainInvocations: totals.uncertain,
        unknownCostInvocations: totals.unknown_cost, chargedTokens: totals.tokens,
        chargedCostUsd: totals.unknown_cost > 0 ? null : totals.cost / USD_NANOS,
        knownChargedCostUsd: totals.cost / USD_NANOS, observedTokens: totals.observed_tokens,
        observedCostUsd: totals.observed_cost / USD_NANOS,
        usageProjectionPending: this.usageSpool.pending({ limit: 1 }).length > 0,
      };
    });
  }

  close(): void {
    if (this.closed) return;
    if (this.pending.size) throw new WorkspaceModelAdmissionError("accounting", { cause: new Error("Physical model calls or accounting failures remain pending") });
    this.db.prepare("DELETE FROM model_admission_hosts WHERE owner_id=?").run(this.ownerId);
    this.db.close(); this.closed = true;
  }

  private reserve(workspaceId: string, input: Parameters<ModelCallAdmission["reserve"]>[0]): ModelCallLease {
    this.assertOpen();
    input.options?.signal?.throwIfAborted();
    const allowance = modelCallAllowance(input.model, input.options, this.policy);
    const attribution = input.attribution ? structuredClone(input.attribution) : undefined;
    if (attribution && (attribution.hostWorkspaceId !== workspaceId ||
        attribution.receiptSourceId !== this.usageSpool.sourceId || attribution.method !== input.method ||
        attribution.model.provider !== input.model.provider || attribution.model.id !== input.model.id ||
        attribution.model.api !== input.model.api)) throw new WorkspaceModelAdmissionError("accounting");
    const id = attribution?.physicalId ?? randomUUID();
    this.transaction(() => {
      this.reconcileDeadOwners();
      if (this.activeCount() >= this.maximum()) throw new WorkspaceModelAdmissionError("capacity");
      const totals = this.totals();
      if ((this.policy.maxInvocations !== null && totals.invocations + 1 > this.policy.maxInvocations) ||
          (this.policy.maxTokens !== null && totals.tokens + allowance.tokens > this.policy.maxTokens) ||
          (this.policy.maxCostNanos !== null && (allowance.costNanos === null || totals.unknown_cost > 0 ||
            totals.cost + allowance.costNanos > this.policy.maxCostNanos))) throw new WorkspaceModelAdmissionError("budget");
      if (attribution) this.usageSpool.reserve(attribution);
      this.db.prepare(`INSERT INTO model_invocations(
        id,epoch,workspace_id,owner_id,pid,method,provider,model,state,reserved_tokens,reserved_cost,
        charged_tokens,charged_cost,allowance_json,created_at) VALUES(?,?,?,?,?,?,?,?, 'active',?,?,?,?,?,?)`).run(
        id, this.policy.epoch, workspaceId, this.ownerId, process.pid, input.method, input.model.provider, input.model.id,
        allowance.tokens, allowance.costNanos, allowance.tokens, allowance.costNanos, JSON.stringify(allowance), new Date().toISOString());
    });
    let done!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
    void promise.catch(() => undefined);
    this.pending.set(id, { workspaceId, promise, done, fail });
    let settled = false;
    let observation: ModelPhysicalObservationV1 | undefined;
    let physicalAccounting: ReturnType<typeof modelCallAccounting> | undefined;
    return { settle: (message) => {
      if (settled) return;
      try {
        observation ??= attribution ? normalizeModelPhysicalObservation({ attribution,
          ...(message ? { message } : {}), terminal: message ? "response" : "rejected" }) : undefined;
        physicalAccounting ??= observation ? modelPhysicalAccounting(observation, allowance) : modelCallAccounting(message, allowance);
        const observed = { ...physicalAccounting,
          known: physicalAccounting.known && (!observation || observation.usageStatus === "known") };
        // Unknown/error terminals retain the full reserve and any higher observed
        // usage. Overruns remain debt; admission will reject further excess work.
        // Attributed observations retain conservative debt until the workspace
        // has committed their accounting claim and acknowledged this outbox.
        const tokens = observed.known && !attribution ? observed.tokens! : Math.max(allowance.tokens, observed.tokens ?? 0);
        const cost = observed.known && !attribution ? observed.costNanos! : allowance.costNanos === null ? null : Math.max(allowance.costNanos, observed.costNanos ?? 0);
        this.transaction(() => {
          if (observation) this.usageSpool.record(observation);
          const changed = this.db.prepare(`UPDATE model_invocations SET state=?,charged_tokens=?,charged_cost=?,
            observed_tokens=?,observed_cost=?,settled_at=? WHERE id=? AND owner_id=? AND state='active'`).run(
            observed.known ? "settled" : "uncertain", tokens, cost, observed.tokens, observed.costNanos,
            new Date().toISOString(), id, this.ownerId).changes;
          if (changed !== 1) throw new WorkspaceModelAdmissionError("accounting");
        });
        settled = true;
        this.pending.get(id)?.done(); this.pending.delete(id);
      } catch (error) {
        this.pending.get(id)?.fail(new WorkspaceModelAdmissionError("accounting", { cause: error }));
        throw error;
      }
    } };
  }

  private recordUndispatched(attribution: ModelCallAttributionV1, observation: ModelPhysicalObservationV1): "inserted" | "duplicate" {
    this.assertOpen();
    const result = this.transaction(() => {
      const recorded = this.usageSpool.record(observation);
      const row = this.db.prepare("SELECT owner_id,state FROM model_invocations WHERE id=? AND workspace_id=?")
        .get(attribution.physicalId, attribution.hostWorkspaceId!);
      if (row && (row["owner_id"] !== this.ownerId || row["state"] !== "active")) {
        if (recorded !== "duplicate") throw new WorkspaceModelAdmissionError("accounting");
      } else if (row) {
        this.db.prepare(`UPDATE model_invocations SET state='settled',observed_tokens=0,observed_cost=0,settled_at=?
          WHERE id=? AND owner_id=? AND state='active'`).run(observation.observedAt, attribution.physicalId, this.ownerId);
      }
      return recorded;
    });
    this.pending.get(attribution.physicalId)?.done();
    this.pending.delete(attribution.physicalId);
    return result;
  }

  private acknowledgeUsage(delivery: VerifiedModelUsageDelivery): void {
    this.assertOpen();
    const { attribution, observation } = readVerifiedModelUsageDelivery(delivery);
    this.transaction(() => {
      this.usageSpool.acknowledge(delivery);
      if (observation.usageStatus === "known" || observation.usageStatus === "known_zero_undispatched") {
        this.db.prepare(`UPDATE model_invocations SET charged_tokens=observed_tokens,charged_cost=observed_cost
          WHERE id=? AND workspace_id=? AND state='settled' AND observed_tokens IS NOT NULL AND observed_cost IS NOT NULL`)
          .run(attribution.physicalId, attribution.hostWorkspaceId!);
      }
    });
  }

  private totals(): Totals {
    const row = this.db.prepare(`SELECT count(*) AS invocations, coalesce(sum(state='active'),0) AS active,
      coalesce(sum(state='uncertain'),0) AS uncertain, coalesce(sum(charged_cost IS NULL),0) AS unknown_cost,
      coalesce(sum(charged_tokens),0) AS tokens, coalesce(sum(charged_cost),0) AS cost,
      coalesce(sum(observed_tokens),0) AS observed_tokens, coalesce(sum(observed_cost),0) AS observed_cost
      FROM model_invocations WHERE epoch=?`).get(this.policy.epoch) as unknown as Totals;
    if (Object.values(row).some((value) => !Number.isSafeInteger(value) || value < 0)) throw new WorkspaceModelAdmissionError("accounting");
    return row;
  }

  private activeCount(): number {
    return Number(this.db.prepare("SELECT count(*) AS amount FROM model_invocations WHERE state='active'").get()!["amount"]);
  }

  private maximum(): number {
    return Number(this.db.prepare("SELECT min(maximum) AS amount FROM model_admission_hosts").get()!["amount"]);
  }

  private reconcileDeadOwners(): void {
    const owners = this.db.prepare("SELECT DISTINCT owner_id,pid FROM model_admission_hosts").all();
    for (const owner of owners) {
      if (processMayBeAlive(Number(owner["pid"]))) continue;
      this.db.prepare("UPDATE model_invocations SET state='uncertain',settled_at=? WHERE owner_id=? AND state='active'")
        .run(new Date().toISOString(), String(owner["owner_id"]));
      this.db.prepare("DELETE FROM model_admission_hosts WHERE owner_id=?").run(String(owner["owner_id"]));
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new WorkspaceModelAdmissionError("closed");
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function processMayBeAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

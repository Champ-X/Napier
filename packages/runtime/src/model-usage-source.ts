import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ModelCallAttributionV1,
  ModelPhysicalObservationV1,
} from "@napier/contracts/model-accounting";
import { canonicalJson } from "./ed25519.js";
import {
  modelUsageDeliveryIssuer,
  readVerifiedModelUsageDelivery,
  type VerifiedModelUsageDelivery,
} from "./model-usage-delivery.js";
import {
  assertUndispatchedObservationAuthority,
  validateModelCallAttribution,
  validateModelPhysicalObservation,
} from "./model-usage-observation.js";

export interface ModelUsagePendingFilter {
  workspaceLedgerId?: string;
  hostWorkspaceId?: string;
  physicalId?: string;
  limit?: number;
}
export interface ModelUsageSource {
  readonly sourceId: string;
  reserve(attribution: ModelCallAttributionV1): "inserted" | "duplicate";
  attribution(physicalId: string): ModelCallAttributionV1 | undefined;
  record(observation: ModelPhysicalObservationV1): "inserted" | "duplicate";
  pending(filter?: ModelUsagePendingFilter): VerifiedModelUsageDelivery[];
  acknowledge(delivery: VerifiedModelUsageDelivery): void;
}

/** Source durability is distinct from workspace projection. Acknowledgement follows the Store commit. */
export class ModelUsageReceiptSpool implements ModelUsageSource {
  readonly sourceId: string;
  private closed = false;
  private readonly issue: ReturnType<typeof modelUsageDeliveryIssuer>;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly ownsDatabase: boolean,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS model_usage_source_meta(id INTEGER PRIMARY KEY CHECK(id=1),source_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_usage_reservations(physical_id TEXT PRIMARY KEY,workspace_ledger_id TEXT NOT NULL,
        host_workspace_id TEXT,attribution_sha256 TEXT NOT NULL,attribution_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_usage_receipts(physical_id TEXT PRIMARY KEY,observation_sha256 TEXT NOT NULL,
        observation_json TEXT NOT NULL,acknowledged_at TEXT);
      CREATE INDEX IF NOT EXISTS model_usage_workspace ON model_usage_reservations(workspace_ledger_id,host_workspace_id);
      CREATE INDEX IF NOT EXISTS model_usage_pending ON model_usage_receipts(acknowledged_at);`);
    this.write(() =>
      db
        .prepare(
          "INSERT OR IGNORE INTO model_usage_source_meta(id,source_id) VALUES(1,?)",
        )
        .run(randomUUID()),
    );
    const sourceId = db
      .prepare("SELECT source_id FROM model_usage_source_meta WHERE id=1")
      .get()?.["source_id"];
    if (
      typeof sourceId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/u.test(sourceId)
    )
      throw new Error("Model usage source identity is invalid");
    this.sourceId = sourceId;
    this.issue = modelUsageDeliveryIssuer(sourceId, (physicalId) =>
      this.readReceipt(physicalId),
    );
  }

  /** Caller owns this connection and its transaction. No nested BEGIN or caller COMMIT occurs. */
  static attach(db: DatabaseSync): ModelUsageReceiptSpool {
    return new ModelUsageReceiptSpool(db, false);
  }

  static async open(filename: string): Promise<ModelUsageReceiptSpool> {
    const target = path.resolve(filename);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const file = await open(target, "wx", 0o600).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        return undefined;
      },
    );
    await file?.close();
    const info = await lstat(target);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await realpath(target)) !==
        path.join(await realpath(path.dirname(target)), path.basename(target))
    )
      throw new Error("Model usage spool must be a regular native file");
    const db = new DatabaseSync(target);
    try {
      db.exec(
        "PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
      );
      return new ModelUsageReceiptSpool(db, true);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  reserve(input: ModelCallAttributionV1): "inserted" | "duplicate" {
    const attribution = validateModelCallAttribution(input);
    if (attribution.receiptSourceId !== this.sourceId)
      throw new Error("Model usage source differs from attribution");
    return this.write(() => {
      const previous = this.attribution(attribution.physicalId);
      if (previous) {
        if (canonicalJson(previous) !== canonicalJson(attribution))
          throw new Error("Model usage attribution conflict");
        return "duplicate";
      }
      this.db
        .prepare("INSERT INTO model_usage_reservations VALUES(?,?,?,?,?)")
        .run(
          attribution.physicalId,
          attribution.workspaceLedgerId,
          attribution.hostWorkspaceId ?? null,
          attribution.contentSha256,
          canonicalJson(attribution),
        );
      return "inserted";
    });
  }

  attribution(physicalId: string): ModelCallAttributionV1 | undefined {
    this.assertOpen();
    const row = this.db
      .prepare(
        "SELECT workspace_ledger_id,host_workspace_id,attribution_sha256,attribution_json FROM model_usage_reservations WHERE physical_id=?",
      )
      .get(physicalId);
    if (!row) return undefined;
    const value = validateModelCallAttribution(
      JSON.parse(String(row["attribution_json"])),
    );
    if (
      value.physicalId !== physicalId ||
      value.contentSha256 !== row["attribution_sha256"] ||
      value.receiptSourceId !== this.sourceId ||
      value.workspaceLedgerId !== row["workspace_ledger_id"] ||
      (value.hostWorkspaceId ?? null) !== row["host_workspace_id"]
    )
      throw new Error("Model usage source reservation is inconsistent");
    return value;
  }

  record(input: ModelPhysicalObservationV1): "inserted" | "duplicate" {
    return this.write(() => {
      const attribution = this.attribution(input.physicalId);
      if (!attribution)
        throw new Error("Model usage receipt lacks its native reservation");
      const observation = validateModelPhysicalObservation(input, attribution);
      const previous = this.db
        .prepare(
          "SELECT physical_id FROM model_usage_receipts WHERE physical_id=?",
        )
        .get(observation.physicalId);
      if (previous) {
        if (
          canonicalJson(
            this.readReceipt(observation.physicalId).observation,
          ) !== canonicalJson(observation)
        )
          throw new Error("Final model usage receipt is immutable");
        return "duplicate";
      }
      if (observation.terminal === "undispatched")
        assertUndispatchedObservationAuthority(input, observation);
      this.db
        .prepare("INSERT INTO model_usage_receipts VALUES(?,?,?,NULL)")
        .run(
          observation.physicalId,
          observation.contentSha256,
          canonicalJson(observation),
        );
      return "inserted";
    });
  }

  pending(filter: ModelUsagePendingFilter = {}): VerifiedModelUsageDelivery[] {
    this.assertOpen();
    const limit = filter.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new Error("Model usage delivery limit is invalid");
    const clauses = ["r.acknowledged_at IS NULL"],
      values: string[] = [];
    for (const [value, column] of [
      [filter.workspaceLedgerId, "a.workspace_ledger_id"],
      [filter.hostWorkspaceId, "a.host_workspace_id"],
      [filter.physicalId, "a.physical_id"],
    ])
      if (value !== undefined) {
        clauses.push(`${column}=?`);
        values.push(value);
      }
    return this.db
      .prepare(
        `SELECT a.physical_id,r.observation_sha256,r.observation_json FROM model_usage_receipts r
      JOIN model_usage_reservations a ON a.physical_id=r.physical_id WHERE ${clauses.join(" AND ")}
      ORDER BY a.physical_id LIMIT ?`,
      )
      .all(...values, limit)
      .map((row) => {
        const attribution = this.attribution(String(row["physical_id"]))!;
        const observation = validateModelPhysicalObservation(
          JSON.parse(String(row["observation_json"])),
          attribution,
        );
        if (observation.contentSha256 !== row["observation_sha256"])
          throw new Error("Model usage receipt digest differs");
        return this.issue(attribution, observation);
      });
  }

  acknowledge(delivery: VerifiedModelUsageDelivery): void {
    const { sourceId, attribution, observation } =
      readVerifiedModelUsageDelivery(delivery);
    if (sourceId !== this.sourceId)
      throw new Error("Model usage acknowledgement source differs");
    this.write(() => {
      const stored = this.readReceipt(attribution.physicalId);
      if (
        canonicalJson(stored.attribution) !== canonicalJson(attribution) ||
        canonicalJson(stored.observation) !== canonicalJson(observation)
      )
        throw new Error("Model usage acknowledgement binding differs");
      this.db
        .prepare(
          "UPDATE model_usage_receipts SET acknowledged_at=coalesce(acknowledged_at,?) WHERE physical_id=?",
        )
        .run(new Date().toISOString(), attribution.physicalId);
    });
  }

  close(): void {
    if (this.closed) return;
    if (this.ownsDatabase) this.db.close();
    this.closed = true;
  }
  private readReceipt(physicalId: string) {
    const attribution = this.attribution(physicalId);
    const row = this.db
      .prepare(
        "SELECT observation_sha256,observation_json FROM model_usage_receipts WHERE physical_id=?",
      )
      .get(physicalId);
    if (!attribution || !row)
      throw new Error("Native model usage source receipt is missing");
    const observation = validateModelPhysicalObservation(
      JSON.parse(String(row["observation_json"])),
      attribution,
    );
    if (observation.contentSha256 !== row["observation_sha256"])
      throw new Error("Native model usage source receipt changed");
    return { sourceId: this.sourceId, attribution, observation };
  }
  private assertOpen(): void {
    if (this.closed) throw new Error("Model usage source is closed");
    if (
      this.sourceId &&
      this.db
        .prepare("SELECT source_id FROM model_usage_source_meta WHERE id=1")
        .get()?.["source_id"] !== this.sourceId
    )
      throw new Error("Model usage source identity changed");
  }
  private write<T>(operation: () => T): T {
    this.assertOpen();
    if (this.db.isTransaction) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

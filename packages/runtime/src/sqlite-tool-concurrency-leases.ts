import type { DatabaseSync } from "node:sqlite";

import {
  ToolConcurrencyDurableLeaseFencedError,
  type ClaimDurableToolConcurrencyLeaseInput,
  type DurableToolConcurrencyClaimResult,
  type DurableToolConcurrencyLease,
  type DurableToolConcurrencyLeaseToken,
  type DurableToolConcurrencyRequirement,
  type InspectDurableToolConcurrencyLeaseInput,
  type RenewDurableToolConcurrencyLeaseInput,
  type ToolConcurrencyLeaseBackend,
} from "./tool-concurrency-lease-backend.js";
import {
  toolConcurrencyModesConflict,
  toolConcurrencyRequirementCovers,
  toolConcurrencyResourcesOverlap,
} from "./tool-concurrency-model.js";

interface LeaseRow {
  lease_id: string;
  owner_id: string;
  operation_id: string;
  generation: number;
  acquired_at_ms: number;
  heartbeat_at_ms: number;
  expires_at_ms: number;
}

interface ResourceRow {
  lease_id: string;
  resource_key_json: string;
  mode: DurableToolConcurrencyRequirement["mode"];
}

export class SqliteToolConcurrencyLeaseBackend implements ToolConcurrencyLeaseBackend {
  constructor(private readonly database: DatabaseSync) {}

  claim(
    input: ClaimDurableToolConcurrencyLeaseInput,
  ): DurableToolConcurrencyClaimResult {
    validateClaim(input);
    return transaction(this.database, () => {
      deleteExpired(this.database, input.nowMs);
      const existing = readLeaseById(this.database, input.leaseId);
      if (existing) return replayClaim(existing, input);

      const ancestors = new Map(
        input.ancestorLeases.map((lease) => [lease.leaseId, lease]),
      );
      for (const ancestor of ancestors.values()) {
        requireCurrentLease(this.database, ancestor, input.nowMs);
      }
      let retryAtMs = Number.POSITIVE_INFINITY;
      for (const held of listActiveLeases(this.database, input.nowMs)) {
        if (!leaseConflicts(held, input.requirements, ancestors)) continue;
        retryAtMs = Math.min(retryAtMs, held.expiresAtMs);
      }
      if (Number.isFinite(retryAtMs)) {
        return { status: "blocked", retryAtMs };
      }

      const generation = nextGeneration(this.database);
      this.database
        .prepare(
          `INSERT INTO tool_concurrency_leases (
             lease_id, owner_id, operation_id, generation,
             acquired_at_ms, heartbeat_at_ms, expires_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.leaseId,
          input.ownerId,
          input.operationId,
          generation,
          input.nowMs,
          input.nowMs,
          input.expiresAtMs,
        );
      const insertResource = this.database.prepare(
        `INSERT INTO tool_concurrency_lease_resources
           (lease_id, resource_key_json, mode)
         VALUES (?, ?, ?)`,
      );
      for (const requirement of input.requirements) {
        insertResource.run(
          input.leaseId,
          JSON.stringify(requirement.key),
          requirement.mode,
        );
      }
      return {
        status: "acquired",
        lease: {
          leaseId: input.leaseId,
          ownerId: input.ownerId,
          operationId: input.operationId,
          generation,
          requirements: cloneRequirements(input.requirements),
          acquiredAtMs: input.nowMs,
          heartbeatAtMs: input.nowMs,
          expiresAtMs: input.expiresAtMs,
        },
      };
    });
  }

  renew(
    input: RenewDurableToolConcurrencyLeaseInput,
  ): DurableToolConcurrencyLease {
    validateInspection(input);
    validateExpiry(input.nowMs, input.expiresAtMs);
    return transaction(this.database, () => {
      deleteExpired(this.database, input.nowMs);
      const result = this.database
        .prepare(
          `UPDATE tool_concurrency_leases
           SET heartbeat_at_ms = ?, expires_at_ms = ?
           WHERE lease_id = ? AND owner_id = ? AND generation = ?
             AND expires_at_ms > ?`,
        )
        .run(
          input.nowMs,
          input.expiresAtMs,
          input.lease.leaseId,
          input.lease.ownerId,
          input.lease.generation,
          input.nowMs,
        );
      if (Number(result.changes) !== 1) throw fenced(input.lease);
      return requireCurrentLease(this.database, input.lease, input.nowMs);
    });
  }

  assertCurrent(
    input: InspectDurableToolConcurrencyLeaseInput,
  ): DurableToolConcurrencyLease {
    validateInspection(input);
    return transaction(this.database, () => {
      deleteExpired(this.database, input.nowMs);
      return requireCurrentLease(this.database, input.lease, input.nowMs);
    });
  }

  release(input: InspectDurableToolConcurrencyLeaseInput): void {
    validateInspection(input);
    transaction(this.database, () => {
      deleteExpired(this.database, input.nowMs);
      const result = this.database
        .prepare(
          `DELETE FROM tool_concurrency_leases
           WHERE lease_id = ? AND owner_id = ? AND generation = ?
             AND expires_at_ms > ?`,
        )
        .run(
          input.lease.leaseId,
          input.lease.ownerId,
          input.lease.generation,
          input.nowMs,
        );
      if (Number(result.changes) !== 1) throw fenced(input.lease);
    });
  }
}

function replayClaim(
  existing: DurableToolConcurrencyLease,
  input: ClaimDurableToolConcurrencyLeaseInput,
): DurableToolConcurrencyClaimResult {
  if (
    existing.ownerId !== input.ownerId ||
    existing.operationId !== input.operationId ||
    requirementsIdentity(existing.requirements) !==
      requirementsIdentity(input.requirements)
  ) {
    throw new Error("Tool concurrency lease ID collision");
  }
  return { status: "acquired", lease: existing };
}

function leaseConflicts(
  held: DurableToolConcurrencyLease,
  requested: readonly DurableToolConcurrencyRequirement[],
  ancestors: ReadonlyMap<string, DurableToolConcurrencyLeaseToken>,
): boolean {
  for (const requestedRequirement of requested) {
    for (const heldRequirement of held.requirements) {
      if (
        !toolConcurrencyResourcesOverlap(
          requestedRequirement.key,
          heldRequirement.key,
        ) ||
        !toolConcurrencyModesConflict(
          requestedRequirement.mode,
          heldRequirement.mode,
        )
      ) {
        continue;
      }
      if (
        ancestors.has(held.leaseId) &&
        toolConcurrencyRequirementCovers(
          { ...heldRequirement, displayKey: "" },
          { ...requestedRequirement, displayKey: "" },
        )
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function listActiveLeases(
  database: DatabaseSync,
  nowMs: number,
): DurableToolConcurrencyLease[] {
  const rows = database
    .prepare(
      `SELECT lease_id, owner_id, operation_id, generation,
              acquired_at_ms, heartbeat_at_ms, expires_at_ms
       FROM tool_concurrency_leases
       WHERE expires_at_ms > ?
       ORDER BY generation`,
    )
    .all(nowMs) as unknown as LeaseRow[];
  return rows.map((row) => hydrateLease(database, row));
}

function readLeaseById(
  database: DatabaseSync,
  leaseId: string,
): DurableToolConcurrencyLease | undefined {
  const row = database
    .prepare(
      `SELECT lease_id, owner_id, operation_id, generation,
              acquired_at_ms, heartbeat_at_ms, expires_at_ms
       FROM tool_concurrency_leases
       WHERE lease_id = ?`,
    )
    .get(leaseId) as unknown as LeaseRow | undefined;
  return row ? hydrateLease(database, row) : undefined;
}

function requireCurrentLease(
  database: DatabaseSync,
  token: DurableToolConcurrencyLeaseToken,
  nowMs: number,
): DurableToolConcurrencyLease {
  const row = database
    .prepare(
      `SELECT lease_id, owner_id, operation_id, generation,
              acquired_at_ms, heartbeat_at_ms, expires_at_ms
       FROM tool_concurrency_leases
       WHERE lease_id = ? AND owner_id = ? AND operation_id = ?
         AND generation = ? AND expires_at_ms > ?`,
    )
    .get(
      token.leaseId,
      token.ownerId,
      token.operationId,
      token.generation,
      nowMs,
    ) as unknown as LeaseRow | undefined;
  if (!row) throw fenced(token);
  return hydrateLease(database, row);
}

function hydrateLease(
  database: DatabaseSync,
  row: LeaseRow,
): DurableToolConcurrencyLease {
  const resources = database
    .prepare(
      `SELECT lease_id, resource_key_json, mode
       FROM tool_concurrency_lease_resources
       WHERE lease_id = ?
       ORDER BY resource_key_json`,
    )
    .all(row.lease_id) as unknown as ResourceRow[];
  return {
    leaseId: row.lease_id,
    ownerId: row.owner_id,
    operationId: row.operation_id,
    generation: row.generation,
    requirements: resources.map((resource) => ({
      key: parseResourceKey(resource.resource_key_json),
      mode: resource.mode,
    })),
    acquiredAtMs: row.acquired_at_ms,
    heartbeatAtMs: row.heartbeat_at_ms,
    expiresAtMs: row.expires_at_ms,
  };
}

function nextGeneration(database: DatabaseSync): number {
  const current = database
    .prepare(
      `SELECT generation
       FROM tool_concurrency_lease_generation
       WHERE singleton = 1`,
    )
    .get() as { generation: number } | undefined;
  const generation = (current?.generation ?? 0) + 1;
  database
    .prepare(
      `UPDATE tool_concurrency_lease_generation
       SET generation = ?
       WHERE singleton = 1`,
    )
    .run(generation);
  return generation;
}

function deleteExpired(database: DatabaseSync, nowMs: number): void {
  database
    .prepare("DELETE FROM tool_concurrency_leases WHERE expires_at_ms <= ?")
    .run(nowMs);
}

function validateClaim(input: ClaimDurableToolConcurrencyLeaseInput): void {
  validateTokenText(input.leaseId, "lease ID", 128);
  validateTokenText(input.ownerId, "owner ID", 256);
  validateTokenText(input.operationId, "operation ID", 512, 1);
  validateTimestamp(input.nowMs, "claim time");
  validateExpiry(input.nowMs, input.expiresAtMs);
  if (input.requirements.length < 1 || input.requirements.length > 32) {
    throw new Error("Tool concurrency lease requires 1 to 32 resources");
  }
  const keys = new Set<string>();
  for (const requirement of input.requirements) {
    validateRequirement(requirement);
    const key = JSON.stringify(requirement.key);
    if (keys.has(key))
      throw new Error("Tool concurrency resource is duplicated");
    keys.add(key);
  }
  const ancestors = new Set<string>();
  for (const lease of input.ancestorLeases) {
    validateLeaseToken(lease);
    if (ancestors.has(lease.leaseId)) {
      throw new Error("Tool concurrency ancestor lease is duplicated");
    }
    ancestors.add(lease.leaseId);
  }
}

function validateInspection(
  input:
    | InspectDurableToolConcurrencyLeaseInput
    | RenewDurableToolConcurrencyLeaseInput,
): void {
  validateLeaseToken(input.lease);
  validateTimestamp(input.nowMs, "lease inspection time");
}

function validateLeaseToken(token: DurableToolConcurrencyLeaseToken): void {
  validateTokenText(token.leaseId, "lease ID", 128);
  validateTokenText(token.ownerId, "owner ID", 256);
  validateTokenText(token.operationId, "operation ID", 512, 1);
  if (!Number.isSafeInteger(token.generation) || token.generation < 1) {
    throw new Error("Tool concurrency lease generation is invalid");
  }
}

function validateRequirement(
  requirement: DurableToolConcurrencyRequirement,
): void {
  if (
    requirement.mode !== "safe" &&
    requirement.mode !== "serialized" &&
    requirement.mode !== "exclusive"
  ) {
    throw new Error("Tool concurrency resource mode is invalid");
  }
  if (requirement.key.length > 32) {
    throw new Error("Tool concurrency resource depth exceeds 32");
  }
  for (const part of requirement.key) {
    if (
      typeof part !== "string" ||
      part.length < 1 ||
      part.length > 256 ||
      part.trim() !== part
    ) {
      throw new Error("Tool concurrency resource key is invalid");
    }
  }
  if (JSON.stringify(requirement.key).length > 2_048) {
    throw new Error("Tool concurrency resource key is too large");
  }
}

function validateTokenText(
  value: string,
  label: string,
  maximum: number,
  minimum = 3,
): void {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    throw new Error(`Tool concurrency ${label} is invalid`);
  }
}

function validateTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Tool concurrency ${label} is invalid`);
  }
}

function validateExpiry(nowMs: number, expiresAtMs: number): void {
  validateTimestamp(expiresAtMs, "lease expiry");
  if (expiresAtMs <= nowMs) {
    throw new Error("Tool concurrency lease expiry must be in the future");
  }
}

function parseResourceKey(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((part) => typeof part === "string")
  ) {
    throw new Error("Persisted tool concurrency resource key is invalid");
  }
  return parsed;
}

function requirementsIdentity(
  requirements: readonly DurableToolConcurrencyRequirement[],
): string {
  return JSON.stringify(
    requirements
      .map((requirement) => [requirement.key, requirement.mode] as const)
      .sort(([left], [right]) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
  );
}

function cloneRequirements(
  requirements: readonly DurableToolConcurrencyRequirement[],
): DurableToolConcurrencyRequirement[] {
  return requirements.map((requirement) => ({
    key: [...requirement.key],
    mode: requirement.mode,
  }));
}

function fenced(
  lease: DurableToolConcurrencyLeaseToken,
): ToolConcurrencyDurableLeaseFencedError {
  return new ToolConcurrencyDurableLeaseFencedError(
    lease.leaseId,
    lease.ownerId,
    lease.generation,
  );
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the transactional failure rather than a redundant rollback.
    }
    throw error;
  }
}

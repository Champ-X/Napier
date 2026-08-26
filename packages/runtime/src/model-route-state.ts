import type {
  CredentialReference,
  CredentialAvailability,
} from "@napier/contracts";
import type {
  ModelRouteCandidate,
  ModelRouteCredentialHealth,
  ModelRouteCredentialPool,
  RouteFailureClass,
} from "@napier/contracts/model-route";
import { sha256 } from "./ed25519.js";

const IDENTIFIER = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[^\u0000-\u0020\u007f<>]{1,200}$/u;
const SLOT_ID = /^slot_[a-f0-9]{20}$/u;
const FAILURE_CLASSES = new Set<RouteFailureClass>([
  "rate_limited",
  "provider_server",
  "network",
  "context",
  "authentication",
  "billing",
  "tool_dialect",
  "cancelled",
  "unknown",
]);
const HEALTH_STATES = new Set<ModelRouteCredentialHealth>([
  "unknown",
  "healthy",
  "cooling_down",
  "unavailable",
]);

export interface PersistedModelRouteHealth {
  key: string;
  providerId: string;
  modelId: string;
  credentialSlotId?: string;
  endpointProfileId?: string;
  health: ModelRouteCredentialHealth;
  consecutiveFailures: number;
  failureClass?: RouteFailureClass;
  cooldownUntil?: string;
  providerHint?: string;
  retryAfterMs?: number;
  updatedAt: string;
}

export interface PersistedModelRouteCursor {
  poolId: string;
  nextIndex: number;
  updatedAt: string;
}

export interface ModelRouteState {
  credentials: CredentialReference[];
  modelRouteHealth: PersistedModelRouteHealth[];
  modelRouteCursors: PersistedModelRouteCursor[];
}

interface ModelRouteStateHost {
  assertReady(): void;
  read(): ModelRouteState;
  mutate<T>(operation: (state: ModelRouteState) => T): Promise<T>;
}

export interface ModelRouteFailureUpdate {
  failureClass: RouteFailureClass;
  cooldownUntil?: string;
  providerHint?: string;
  retryAfterMs?: number;
}

export class ModelRouteStateRepository {
  constructor(private readonly host: ModelRouteStateHost) {}

  health(candidate: ModelRouteCandidate): PersistedModelRouteHealth | undefined {
    this.host.assertReady();
    const record = this.host
      .read()
      .modelRouteHealth.find((item) => item.key === routeCandidateStateKey(candidate));
    return record ? structuredClone(record) : undefined;
  }

  async reserveCredential(
    pool: ModelRouteCredentialPool,
    target?: { modelId: string; endpointProfileId?: string },
  ): Promise<CredentialReference> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const referenceIds =
        pool.credentialReferenceIds ??
        state.credentials
          .filter((reference) => reference.providerId === pool.providerId)
          .map((reference) => reference.id);
      const configured = referenceIds.map((referenceId) => {
        const reference = state.credentials.find(
          (candidate) => candidate.id === referenceId,
        );
        if (!reference || reference.providerId !== pool.providerId) {
          throw new Error(
            `Model route credential pool member is unavailable: ${referenceId}`,
          );
        }
        return reference;
      });
      const active = configured.filter(
        (reference) =>
          reference.status === "active" &&
          credentialHealth(reference.availability) !== "unavailable",
      );
      const now = Date.now();
      const available = target
        ? active.filter((reference) => {
            const health = state.modelRouteHealth.find(
              (record) =>
                record.key ===
                routeCandidateStateKey({
                  providerId: pool.providerId,
                  modelId: target.modelId,
                  credentialSlotId: modelRouteCredentialSlotId(reference.id),
                  ...(target.endpointProfileId
                    ? { endpointProfileId: target.endpointProfileId }
                    : {}),
                }),
            );
            return (
              health?.health !== "unavailable" &&
              (!health?.cooldownUntil || Date.parse(health.cooldownUntil) <= now)
            );
          })
        : active;
      if (available.length === 0) {
        throw new Error(`Model route credential pool has no available slot: ${pool.id}`);
      }
      let cursor = state.modelRouteCursors.find(
        (candidate) => candidate.poolId === pool.id,
      );
      const index = (cursor?.nextIndex ?? 0) % available.length;
      const timestamp = new Date().toISOString();
      if (!cursor) {
        cursor = { poolId: pool.id, nextIndex: 0, updatedAt: timestamp };
        state.modelRouteCursors.push(cursor);
      }
      cursor.nextIndex = (index + 1) % available.length;
      cursor.updatedAt = timestamp;
      return structuredClone(available[index]!);
    });
  }

  async recordFailure(
    candidate: ModelRouteCandidate,
    update: ModelRouteFailureUpdate,
  ): Promise<PersistedModelRouteHealth> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const key = routeCandidateStateKey(candidate);
      const prior = state.modelRouteHealth.find((item) => item.key === key);
      const record: PersistedModelRouteHealth = {
        key,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        ...(candidate.credentialSlotId
          ? { credentialSlotId: candidate.credentialSlotId }
          : {}),
        ...(candidate.endpointProfileId
          ? { endpointProfileId: candidate.endpointProfileId }
          : {}),
        health: update.cooldownUntil ? "cooling_down" : "unavailable",
        consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
        failureClass: update.failureClass,
        ...(update.cooldownUntil ? { cooldownUntil: update.cooldownUntil } : {}),
        ...(update.providerHint ? { providerHint: update.providerHint } : {}),
        ...(update.retryAfterMs !== undefined
          ? { retryAfterMs: update.retryAfterMs }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      upsertHealth(state.modelRouteHealth, record);
      return structuredClone(record);
    });
  }

  async recordSuccess(
    candidate: ModelRouteCandidate,
  ): Promise<PersistedModelRouteHealth> {
    this.host.assertReady();
    return this.host.mutate((state) => {
      const record: PersistedModelRouteHealth = {
        key: routeCandidateStateKey(candidate),
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        ...(candidate.credentialSlotId
          ? { credentialSlotId: candidate.credentialSlotId }
          : {}),
        ...(candidate.endpointProfileId
          ? { endpointProfileId: candidate.endpointProfileId }
          : {}),
        health: "healthy",
        consecutiveFailures: 0,
        updatedAt: new Date().toISOString(),
      };
      upsertHealth(state.modelRouteHealth, record);
      return structuredClone(record);
    });
  }
}

export function validatePersistedModelRouteState(state: ModelRouteState): void {
  validatePersistedModelRouteHealth(state.modelRouteHealth);
  validatePersistedModelRouteCursors(state.modelRouteCursors);
}

function validatePersistedModelRouteHealth(
  records: PersistedModelRouteHealth[],
): void {
  const healthKeys = new Set<string>();
  for (const record of records) {
    assertExactKeys(record, "Model route health", [
      "key",
      "providerId",
      "modelId",
      "credentialSlotId",
      "endpointProfileId",
      "health",
      "consecutiveFailures",
      "failureClass",
      "cooldownUntil",
      "providerHint",
      "retryAfterMs",
      "updatedAt",
    ]);
    if (
      !IDENTIFIER.test(record.providerId) ||
      !MODEL_ID.test(record.modelId) ||
      (record.credentialSlotId !== undefined &&
        !SLOT_ID.test(record.credentialSlotId)) ||
      (record.endpointProfileId !== undefined &&
        !IDENTIFIER.test(record.endpointProfileId)) ||
      !HEALTH_STATES.has(record.health) ||
      !Number.isSafeInteger(record.consecutiveFailures) ||
      record.consecutiveFailures < 0 ||
      (record.failureClass !== undefined &&
        !FAILURE_CLASSES.has(record.failureClass)) ||
      (record.cooldownUntil !== undefined &&
        !validTimestamp(record.cooldownUntil)) ||
      (record.providerHint !== undefined &&
        !/^[A-Za-z0-9._:/ -]{1,120}$/u.test(record.providerHint)) ||
      (record.retryAfterMs !== undefined &&
        (!Number.isSafeInteger(record.retryAfterMs) ||
          record.retryAfterMs < 0 ||
          record.retryAfterMs > 300_000)) ||
      !validTimestamp(record.updatedAt) ||
      record.key !== routeCandidateStateKey(record) ||
      healthKeys.has(record.key)
    ) {
      throw new Error(`Invalid persisted Model route health: ${record.key}`);
    }
    healthKeys.add(record.key);
  }
}

function validatePersistedModelRouteCursors(
  cursors: PersistedModelRouteCursor[],
): void {
  const poolIds = new Set<string>();
  for (const cursor of cursors) {
    assertExactKeys(cursor, "Model route cursor", [
      "poolId",
      "nextIndex",
      "updatedAt",
    ]);
    if (
      !IDENTIFIER.test(cursor.poolId) ||
      !Number.isSafeInteger(cursor.nextIndex) ||
      cursor.nextIndex < 0 ||
      !validTimestamp(cursor.updatedAt) ||
      poolIds.has(cursor.poolId)
    ) {
      throw new Error(`Invalid persisted Model route cursor: ${cursor.poolId}`);
    }
    poolIds.add(cursor.poolId);
  }
}

export function routeCandidateStateKey(
  candidate: Pick<
    ModelRouteCandidate,
    "providerId" | "modelId" | "endpointProfileId" | "credentialSlotId"
  >,
): string {
  return [
    candidate.providerId,
    candidate.modelId,
    candidate.endpointProfileId ?? "default",
    candidate.credentialSlotId ?? "ambient",
  ].join("/");
}

export function modelRouteCredentialSlotId(referenceId: string): string {
  return `slot_${sha256(referenceId).slice(0, 20)}`;
}

export function credentialHealth(
  availability: CredentialAvailability | undefined,
): ModelRouteCredentialHealth {
  if (availability === "available") return "healthy";
  if (availability === "missing" || availability === "error") {
    return "unavailable";
  }
  return "unknown";
}

function upsertHealth(
  records: PersistedModelRouteHealth[],
  next: PersistedModelRouteHealth,
): void {
  const index = records.findIndex((record) => record.key === next.key);
  if (index === -1) records.push(next);
  else records[index] = next;
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertExactKeys(
  value: unknown,
  label: string,
  allowed: readonly string[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  const keys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} has unsupported field: ${unknown}`);
}

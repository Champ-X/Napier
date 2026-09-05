import { randomUUID } from "node:crypto";

import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  operationHash,
  operationNonNegativeInteger,
  operationObject,
  operationText,
  type BoundToolOperationDescriptor,
} from "./tool-operation-binding.js";
import type {
  ToolOperationExecutionLease,
  ToolOperationExecutionLeaseDisposition,
  ToolOperationJournalOptions,
} from "./tool-operation-model.js";

/** Covers the 600s outer tool deadline plus a two-minute scheduling grace. */
export const DEFAULT_TOOL_OPERATION_LEASE_DURATION_MS = 720_000;
const MAX_TOOL_OPERATION_LEASE_DURATION_MS = 60 * 60 * 1_000;

export interface ToolOperationLeaseIssuer {
  ownerSha256: string;
  durationMs: number;
}

export function toolOperationLeaseIssuer(
  options: ToolOperationJournalOptions,
): ToolOperationLeaseIssuer {
  const ownerId = options.executionLease?.ownerId ?? randomUUID();
  if (!ownerId.trim() || ownerId.length > 1_024) {
    throw new Error(
      "Tool operation execution lease ownerId must contain 1-1024 characters",
    );
  }
  const durationMs =
    options.executionLease?.durationMs ??
    DEFAULT_TOOL_OPERATION_LEASE_DURATION_MS;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > MAX_TOOL_OPERATION_LEASE_DURATION_MS
  ) {
    throw new Error(
      `Tool operation execution lease durationMs must be an integer between 1 and ${String(MAX_TOOL_OPERATION_LEASE_DURATION_MS)}`,
    );
  }
  return {
    ownerSha256: sha256(
      canonicalJson({
        kind: "napier.tool-operation-execution-owner",
        schemaVersion: 1,
        ownerId,
      }),
    ),
    durationMs,
  };
}

export function initialExecutionLease(
  issuer: ToolOperationLeaseIssuer,
  acquiredAtMs: number,
): ToolOperationExecutionLease {
  return executionLease(issuer, 1, acquiredAtMs, "initial");
}

export function takeoverExecutionLease(
  issuer: ToolOperationLeaseIssuer,
  previousGeneration: number,
  acquiredAtMs: number,
  disposition: "unstarted_takeover" | "safe_started_takeover",
): ToolOperationExecutionLease {
  if (previousGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Tool operation execution lease generation is exhausted");
  }
  return {
    ...executionLease(
      issuer,
      previousGeneration + 1,
      acquiredAtMs,
      disposition,
    ),
    previousGeneration,
  };
}

export function renewedExecutionLease(
  issuer: ToolOperationLeaseIssuer,
  current: ToolOperationExecutionLease,
  acquiredAtMs: number,
): ToolOperationExecutionLease {
  return executionLease(issuer, current.generation, acquiredAtMs, "renewal");
}

export function executionLeaseFields(
  lease: ToolOperationExecutionLease,
): Record<string, JsonValue> {
  return {
    executionLeaseOwnerSha256: lease.ownerSha256,
    executionLeaseGeneration: lease.generation,
    executionLeaseAcquiredAtMs: lease.acquiredAtMs,
    executionLeaseExpiresAtMs: lease.expiresAtMs,
    executionLeaseDisposition: lease.disposition,
    ...(lease.previousGeneration !== undefined
      ? { executionLeasePreviousGeneration: lease.previousGeneration }
      : {}),
  };
}

export function executionLeaseTokenFields(
  lease: ToolOperationExecutionLease,
): Record<string, JsonValue> {
  return {
    executionLeaseOwnerSha256: lease.ownerSha256,
    executionLeaseGeneration: lease.generation,
  };
}

export function executionLeaseFromPayload(
  value: unknown,
): ToolOperationExecutionLease | undefined {
  const payload = operationObject(value);
  const ownerSha256 = operationHash(payload?.["executionLeaseOwnerSha256"]);
  const generation = positiveInteger(payload?.["executionLeaseGeneration"]);
  const acquiredAtMs = operationNonNegativeInteger(
    payload?.["executionLeaseAcquiredAtMs"],
  );
  const expiresAtMs = operationNonNegativeInteger(
    payload?.["executionLeaseExpiresAtMs"],
  );
  const disposition = executionLeaseDisposition(
    operationText(payload?.["executionLeaseDisposition"]),
  );
  const previousGeneration = operationNonNegativeInteger(
    payload?.["executionLeasePreviousGeneration"],
  );
  if (
    !ownerSha256 ||
    !generation ||
    acquiredAtMs === undefined ||
    expiresAtMs === undefined ||
    expiresAtMs <= acquiredAtMs ||
    !disposition ||
    (disposition === "initial" &&
      (generation !== 1 || previousGeneration !== undefined)) ||
    ((disposition === "unstarted_takeover" ||
      disposition === "safe_started_takeover") &&
      previousGeneration !== generation - 1) ||
    (disposition === "renewal" && previousGeneration !== undefined)
  ) {
    return undefined;
  }
  return {
    ownerSha256,
    generation,
    acquiredAtMs,
    expiresAtMs,
    disposition,
    ...(previousGeneration !== undefined ? { previousGeneration } : {}),
  };
}

export function executionLeaseTokenFromPayload(
  value: unknown,
): Pick<ToolOperationExecutionLease, "ownerSha256" | "generation"> | undefined {
  const payload = operationObject(value);
  const ownerSha256 = operationHash(payload?.["executionLeaseOwnerSha256"]);
  const generation = positiveInteger(payload?.["executionLeaseGeneration"]);
  return ownerSha256 && generation ? { ownerSha256, generation } : undefined;
}

export function executionLeaseExpired(
  lease: ToolOperationExecutionLease,
  asOfMs: number,
): boolean {
  return asOfMs >= lease.expiresAtMs;
}

export function sameExecutionLease(
  left: ToolOperationExecutionLease | undefined,
  right: ToolOperationExecutionLease | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.generation === right.generation &&
    left.ownerSha256 === right.ownerSha256,
  );
}

/** Progress labels never imply replay safety; the descriptor must opt in. */
export function allowsStartedExecutionTakeover(
  binding: BoundToolOperationDescriptor,
): boolean {
  return binding.descriptor.startedTakeover === "idempotent";
}

function executionLease(
  issuer: ToolOperationLeaseIssuer,
  generation: number,
  acquiredAtMs: number,
  disposition: ToolOperationExecutionLeaseDisposition,
): ToolOperationExecutionLease {
  const expiresAtMs = acquiredAtMs + issuer.durationMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new Error("Tool operation execution lease expiry is out of range");
  }
  return {
    ownerSha256: issuer.ownerSha256,
    generation,
    acquiredAtMs,
    expiresAtMs,
    disposition,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1
    ? Number(value)
    : undefined;
}

function executionLeaseDisposition(
  value: string | undefined,
): ToolOperationExecutionLeaseDisposition | undefined {
  return value === "initial" ||
    value === "renewal" ||
    value === "unstarted_takeover" ||
    value === "safe_started_takeover"
    ? value
    : undefined;
}

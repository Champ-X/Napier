import { randomBytes, timingSafeEqual } from "node:crypto";

import type { RunRecord } from "@napier/contracts";

import type { SqliteLedger } from "./sqlite-ledger.js";
import { nowIso } from "./ids.js";
import { persistRunLeaseRenewal } from "./store-persistence.js";
import { storeSha256 as sha256 } from "./store-hashing.js";
import type { StorePersistenceMonitor } from "./store-observability.js";

export interface RunLeaseOptions {
  ownerId: string;
  ttlMs: number;
}

interface PersistedLeaseRun extends RunRecord {
  leaseTokenSha256?: string;
}

export function createRunLeaseBinding(options: RunLeaseOptions): {
  token: string;
  binding: {
    tokenSha256: string;
    summary: NonNullable<RunRecord["lease"]>;
  };
} {
  const ttlMs = validateRunLeaseTtl(options.ttlMs);
  const ownerId = normalizeLeaseOwner(options.ownerId);
  const token = randomBytes(32).toString("base64url");
  const acquiredAt = nowIso();
  return {
    token,
    binding: {
      tokenSha256: sha256(token),
      summary: {
        ownerId,
        acquiredAt,
        heartbeatAt: acquiredAt,
        expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString(),
        revision: 1,
      },
    },
  };
}

export function renewNormalizedRunLease(input: {
  run: PersistedLeaseRun;
  token: string;
  ttlMs: number;
  workspaceRevision: number;
  ledger: SqliteLedger;
  monitor: StorePersistenceMonitor;
}): RunRecord {
  assertToken(input.run.leaseTokenSha256, input.token);
  if (!input.run.lease || input.run.status !== "running") {
    throw new Error("Run lease is not active");
  }
  if (Date.parse(input.run.lease.expiresAt) <= Date.now()) {
    throw new Error("Run lease has expired");
  }
  const heartbeatAt = nowIso();
  const normalized = persistRunLeaseRenewal({
    runId: input.run.id,
    tokenSha256: input.run.leaseTokenSha256!,
    expectedRevision: input.run.lease.revision,
    heartbeatAt,
    expiresAt: new Date(Date.parse(heartbeatAt) + input.ttlMs).toISOString(),
    workspaceRevision: input.workspaceRevision,
    ledger: input.ledger,
    monitor: input.monitor,
  });
  input.run.lease = structuredClone(normalized.lease);
  const output = structuredClone(input.run);
  delete output.leaseTokenSha256;
  return output;
}

export function validateRunLeaseTtl(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 10 * 60_000) {
    throw new Error("Lease TTL must be an integer from 5000 to 600000 ms");
  }
  return value;
}

function assertToken(expectedSha256: string | undefined, token: string): void {
  if (!expectedSha256 || !token) throw new Error("Lease token is required");
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Lease token is invalid");
  }
}

export function normalizeLeaseOwner(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_.:-]{2,127}$/u.test(normalized)) {
    throw new Error("Lease owner ID is invalid");
  }
  return normalized;
}

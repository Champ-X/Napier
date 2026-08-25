import { randomBytes, timingSafeEqual } from "node:crypto";

import { storeSha256 as sha256 } from "./store-hashing.js";

const MINIMUM_LEASE_TTL_MS = 5_000;
const MAXIMUM_LEASE_TTL_MS = 10 * 60_000;

export function createRepositoryLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

export function assertRepositoryLeaseToken(
  expectedSha256: string | undefined,
  token: string | undefined,
  label = "Lease token",
): void {
  if (!expectedSha256 || !token) throw new Error(`${label} is required`);
  const expected = Buffer.from(expectedSha256, "hex");
  const actual = Buffer.from(sha256(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error(`${label} is invalid`);
  }
}

export function validateRepositoryLeaseTtl(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MINIMUM_LEASE_TTL_MS ||
    value > MAXIMUM_LEASE_TTL_MS
  ) {
    throw new Error("Lease TTL must be an integer from 5000 to 600000 ms");
  }
  return value;
}

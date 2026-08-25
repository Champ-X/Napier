import { describe, expect, it } from "vitest";

import {
  assertRepositoryLeaseToken,
  createRepositoryLeaseToken,
  validateRepositoryLeaseTtl,
} from "../src/repository-lease.js";
import { storeSha256 } from "../src/store-hashing.js";

describe("repository lease primitives", () => {
  it("creates opaque tokens and verifies only their hash binding", () => {
    const token = createRepositoryLeaseToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(() =>
      assertRepositoryLeaseToken(storeSha256(token), token),
    ).not.toThrow();
    expect(() =>
      assertRepositoryLeaseToken(storeSha256(token), `${token}x`),
    ).toThrow("Lease token is invalid");
    expect(() => assertRepositoryLeaseToken(undefined, token)).toThrow(
      "Lease token is required",
    );
  });

  it("keeps the shared lease TTL boundary closed", () => {
    expect(validateRepositoryLeaseTtl(5_000)).toBe(5_000);
    expect(validateRepositoryLeaseTtl(600_000)).toBe(600_000);
    for (const invalid of [4_999, 600_001, 5_000.5]) {
      expect(() => validateRepositoryLeaseTtl(invalid)).toThrow(
        "Lease TTL must be an integer from 5000 to 600000 ms",
      );
    }
  });
});

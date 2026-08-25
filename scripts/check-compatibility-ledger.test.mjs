import { describe, expect, it } from "vitest";

import { auditCompatibilityLedger } from "./check-compatibility-ledger.mjs";

describe("Compatibility Ledger gate", () => {
  it("binds compatibility paths to owners, telemetry, fixtures, migrations, and rollback", async () => {
    await expect(auditCompatibilityLedger()).resolves.toEqual({
      ok: true,
      errors: [],
      entryCount: 8,
      metricCount: 8,
    });
  });
});

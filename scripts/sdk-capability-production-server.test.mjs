import { describe, expect, it } from "vitest";

import { runBoundProductionServerTrace } from "./sdk-capability-production-server-harness.mjs";

describe("SDK capability production-server trace", () => {
  it("calls the genuinely bound production server through the built SDK package", async () => {
    const receipt = await runBoundProductionServerTrace();
    expect(receipt.listener).toMatchObject({
      loopback: true,
      ephemeralNonzeroPort: true,
    });
    expect(receipt.sdk).toMatchObject({
      externalProcess: true,
      builtPackageSubpath: true,
      globalFetch: true,
      integrityVerified: true,
      agentId: "agent_napier",
      agentRevision: 1,
      driftState: "current",
      ownership: "recommended",
    });
    expect(receipt.storeNonMutation).toBe(true);
    expect(receipt.child).toMatchObject({
      startupBounded: true,
      outputBounded: true,
      gracefulZeroExit: true,
      forcedCleanup: false,
    });
    expect(receipt.child.totalOutputBytes).toBeLessThanOrEqual(
      receipt.child.maximumOutputBytes,
    );
    expect(receipt.example).toMatchObject({
      timeoutBounded: true,
      outputBounded: true,
      gracefulZeroExit: true,
      forcedCleanup: false,
    });
    expect(receipt.example.totalOutputBytes).toBeLessThanOrEqual(
      receipt.example.maximumOutputBytes,
    );
    expect(receipt.portClosed).toBe(true);
    expect(receipt.postExitSdkRequestFailed).toBe(true);
    expect(receipt.cleanup).toEqual({ rootValidated: true, removed: true });
  }, 30_000);
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  productionSdkServerEnvironment,
  runBoundProductionServerTrace,
} from "./sdk-capability-production-server-harness.mjs";
import { verifyProductionServerTrace } from "./sdk-capability-parity-receipts.mjs";

describe("SDK capability production-server trace", () => {
  it("keeps the version 1 production receipt shape readable", async () => {
    const receipt = JSON.parse(
      await readFile(
        path.resolve(
          "docs/artifacts/sdk-capability-parity-stage7/production-server-trace.json",
        ),
        "utf8",
      ),
    );
    delete receipt.workspaceRegistryIsolated;
    receipt.schemaVersion = 1;
    receipt.allowlistedEnvironmentKeys =
      receipt.allowlistedEnvironmentKeys.filter(
        (key) => key !== "NAPIER_STATE_HOME",
      );

    expect(receipt.schemaVersion).toBe(1);
    expect(() =>
      verifyProductionServerTrace(receipt, {
        files: {
          "apps/server/dist/index.js": receipt.serverEntrySha256,
          "packages/sdk/dist/management.js": receipt.sdkManagementEntrySha256,
        },
      }),
    ).not.toThrow();
  });

  it("isolates the machine-level workspace registry inside the trace root", () => {
    const root = path.resolve("/tmp/napier-sdk-production-contract");
    const environment = productionSdkServerEnvironment(root);

    expect(environment.NAPIER_STATE_HOME).toBe(path.join(root, "state"));
    expect(environment.NAPIER_WORKSPACE).toBe(path.join(root, "workspace"));
    expect(environment.NAPIER_STATE_HOME).toBe(environment.NAPIER_HOME);
  });

  it("calls the genuinely bound production server through the built SDK package", async () => {
    const receipt = await runBoundProductionServerTrace();
    expect(receipt.schemaVersion).toBe(2);
    expect(receipt.allowlistedEnvironmentKeys).toContain("NAPIER_STATE_HOME");
    expect(receipt.workspaceRegistryIsolated).toBe(true);
    expect(() =>
      verifyProductionServerTrace(receipt, {
        files: {
          "apps/server/dist/index.js": receipt.serverEntrySha256,
          "packages/sdk/dist/management.js": receipt.sdkManagementEntrySha256,
        },
      }),
    ).not.toThrow();
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

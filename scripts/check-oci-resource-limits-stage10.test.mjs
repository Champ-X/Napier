import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { validateOciResourceLimitsEvidence } from "./check-oci-resource-limits.mjs";
import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-resource-limits-stage10.json",
  import.meta.url,
);

describe("OCI resource limits Stage 10 evidence", () => {
  it("binds dynamic daemon enforcement and fail-closed drift without private data", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-resource-limits-stage10");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.observedProductionProcess.platform, "linux/arm64");
    assert.equal(value.observedProductionProcess.cgroupVersion, 2);
    assert.equal(value.observedProductionProcess.pidsMax, 256);
    assert.equal(value.observedProductionProcess.memoryMaxBytes, 1_073_741_824);
    assert.equal(value.observedProductionProcess.memorySwapMaxBytes, 0);
    assert.equal(value.observedProductionProcess.cpuQuotaMicros, 200_000);
    assert.equal(value.observedProductionProcess.cpuPeriodMicros, 100_000);
    assert.equal(value.observedProductionProcess.rootReadOnly, true);
    assert.equal(value.observedProductionProcess.workspaceReadOnly, true);
    assert.equal(
      value.observedProductionProcess.temporaryFileSystemBytes,
      67_108_864,
    );
    assert.equal(
      value.observedProductionProcess.homeFileSystemBytes,
      67_108_864,
    );
    assert.equal(
      value.observedProductionProcess.temporaryFileSystemRestricted,
      true,
    );
    assert.equal(
      value.observedProductionProcess.homeFileSystemRestricted,
      true,
    );
    assert.equal(value.observedProductionProcess.capabilitiesDropped, true);
    assert.equal(value.observedProductionProcess.noNewPrivileges, true);
    assert.equal(value.observedProductionProcess.networkInterfaceCount, 1);
    assert.equal(
      value.observedProductionProcess.doctorResourceProductionCall,
      true,
    );
    assert.equal(value.failureInjection.removedMemorySwapLimit, true);
    assert.equal(
      value.failureInjection.observedMemorySwapMaxBytes,
      1_073_741_824,
    );
    assert.equal(value.failureInjection.verifierRejectedDrift, true);
    assert.equal(
      value.failureInjection.doctorFailureCode,
      "sandbox_resources_unavailable",
    );
    assert.equal(value.retention.credentialValues, false);
    assert.equal(value.retention.rawDockerOutput, false);
    assert.equal(value.retention.rawDoctorReport, false);
    assert.equal(value.retention.rawDaemonEndpoint, false);
    assert.equal(value.retention.numericHostUserIds, false);
    assert.equal(value.retention.workspacePaths, false);
    assert.equal(value.scope.sliceComplete, true);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /unix:\/\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });

  it("rejects image and resource-policy drift", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const provenance = JSON.parse(
      await readFile(
        new URL(
          "../docs/artifacts/sandbox-image-provenance-0.1.0.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(validateOciResourceLimitsEvidence(value, provenance), []);

    const tampered = structuredClone(value);
    tampered.observedProductionProcess.memorySwapMaxBytes = 1;
    assert.deepEqual(validateOciResourceLimitsEvidence(tampered, provenance), [
      "OCI resource limits evidence shape is invalid",
    ]);
  });
});

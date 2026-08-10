import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-pty-cleanup-stage3.json",
  import.meta.url,
);

describe("OCI PTY and cleanup Stage 3 evidence", () => {
  it("binds PTY lifecycle cleanup while retaining real-host fail-closed status", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-pty-cleanup-stage3");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledProductionPath.externalDaemonUsed, false);
    assert.equal(value.controlledProductionPath.realNodePtyUsed, true);
    assert.equal(value.controlledProductionPath.realGuardianWorkerUsed, true);
    assert.equal(value.controlledProductionPath.immutableImageIdUsed, true);
    assert.equal(
      value.controlledProductionPath.containerOwnsCleanupIdentity,
      false,
    );
    assert.equal(
      value.controlledProductionPath.dockerAutoRemoveReliedOn,
      false,
    );
    assert.equal(
      value.controlledProductionPath.shellDoctorProductionProbe,
      "ready",
    );
    assert.equal(value.controlledProductionPath.ptyResizeSignalRelayed, true);
    assert.equal(
      value.controlledProductionPath.parentSigkillCleanupObserved,
      true,
    );
    assert.equal(value.controlledProductionPath.cleanupFailureExitCode, 75);
    assert.equal(
      value.controlledProductionPath.cleanupFailureReportedAsSuccess,
      false,
    );
    assert.equal(value.actualHost.containerServerReachable, false);
    assert.equal(
      value.actualHost.shellDoctorCode,
      "shell_provider_unavailable",
    );
    assert.equal(value.actualHost.sandboxDoctorCode, "sandbox_unavailable");
    assert.equal(value.actualHost.codingSendBoundary, "blocked");
    assert.equal(value.scope.s1Complete, false);
    assert.equal(value.retention.credentialValues, false);
    assert.equal(value.retention.rawDockerOutput, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /\/tmp\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
    assert.doesNotMatch(serialized, /napier-[a-f0-9]{32}/u);
  });
});

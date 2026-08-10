import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-user-identity-stage4.json",
  import.meta.url,
);

describe("OCI user and daemon identity Stage 4 evidence", () => {
  it("binds local daemon and numeric host identity without overstating real-host readiness", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-user-identity-stage4");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledProductionPath.externalDaemonUsed, false);
    assert.equal(
      value.controlledProductionPath.localDaemonEndpointRequired,
      true,
    );
    assert.equal(
      value.controlledProductionPath.remoteSshEndpointRejected,
      true,
    );
    assert.equal(
      value.controlledProductionPath.remoteTcpEndpointRejected,
      true,
    );
    assert.equal(
      value.controlledProductionPath.remoteNamedPipeEndpointRejected,
      true,
    );
    assert.equal(value.controlledProductionPath.daemonEndpointHashBound, true);
    assert.equal(
      value.controlledProductionPath.numericHostUserIdentityBound,
      true,
    );
    assert.equal(
      value.controlledProductionPath.identityRevalidatedBeforeReuse,
      true,
    );
    assert.equal(
      value.controlledProductionPath.runtimeReceiptChangesWithUserIdentity,
      true,
    );
    assert.equal(
      value.controlledProductionPath.controlledWriteOwnerMatchedHost,
      true,
    );
    assert.equal(value.actualHost.containerServerReachable, false);
    assert.equal(
      value.actualHost.shellDoctorCode,
      "shell_provider_unavailable",
    );
    assert.equal(value.actualHost.sandboxDoctorCode, "sandbox_unavailable");
    assert.equal(value.actualHost.codingSendBoundary, "blocked");
    assert.equal(value.retention.rawDaemonEndpoint, false);
    assert.equal(value.retention.numericHostUserIds, false);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /unix:\/\//u);
    assert.doesNotMatch(serialized, /npipe:\/\//u);
    assert.doesNotMatch(serialized, /ssh:\/\//u);
    assert.doesNotMatch(serialized, /tcp:\/\//u);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /\/tmp\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});

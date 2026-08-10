import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-runtime-identity-stage2.json",
  import.meta.url,
);

describe("OCI runtime identity Stage 2 evidence", () => {
  it("binds immutable production identity while keeping incomplete PTY fail closed", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-runtime-identity-stage2");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledAdapter.externalDaemonUsed, false);
    assert.equal(
      value.controlledAdapter.mutableImageReferenceUse,
      "inspect_only",
    );
    assert.equal(
      value.controlledAdapter.productionRunReference,
      "immutable_image_id",
    );
    assert.equal(value.controlledAdapter.containerClientExecutableBound, true);
    assert.equal(value.controlledAdapter.dockerClientEnvironmentIsolated, true);
    assert.equal(
      value.controlledAdapter.commandEnvironmentRelay,
      "mode_0600_env_file",
    );
    assert.equal(value.controlledAdapter.nodeArgvStatus, "succeeded");
    assert.equal(value.controlledAdapter.nodeDoctorProductionProbe, "ready");
    assert.equal(
      value.controlledAdapter.requestedMutableReferencePassedToRun,
      false,
    );
    assert.equal(
      value.controlledAdapter.shellPtyStatus,
      "provider_incompatible",
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
  });
});

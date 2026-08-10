import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-python-runtime-stage5.json",
  import.meta.url,
);

describe("OCI Python runtime Stage 5 evidence", () => {
  it("binds the production Python command and Kernel without overstating host readiness", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-python-runtime-stage5");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledProductionPath.externalDaemonUsed, false);
    assert.equal(value.controlledProductionPath.immutableImageIdUsed, true);
    assert.deepEqual(value.controlledProductionPath.isolatedPythonFlags, [
      "-I",
      "-B",
      "-S",
    ]);
    assert.equal(
      value.controlledProductionPath.kernelBootstrapImportsVerified,
      true,
    );
    assert.equal(value.controlledProductionPath.hostPythonPathsMounted, false);
    assert.equal(value.controlledProductionPath.interpreterVersionFloor, "3.9");
    assert.equal(value.controlledProductionPath.runCommandStatus, "succeeded");
    assert.equal(
      value.controlledProductionPath.persistentKernelStateObserved,
      true,
    );
    assert.equal(
      value.controlledProductionPath.kernelSourceRetainedInLedger,
      false,
    );
    assert.equal(
      value.controlledProductionPath.pythonDoctorProductionProbe,
      "ready",
    );
    assert.equal(value.actualHost.containerServerReachable, false);
    assert.equal(
      value.actualHost.pythonDoctorCode,
      "python_provider_unavailable",
    );
    assert.equal(value.actualHost.codingSendBoundary, "blocked");
    assert.equal(value.retention.pythonExecutablePath, false);
    assert.equal(value.retention.pythonSource, false);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /\/tmp\//u);
    assert.doesNotMatch(serialized, /unix:\/\//u);
    assert.doesNotMatch(serialized, /values =/u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});

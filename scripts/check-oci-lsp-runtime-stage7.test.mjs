import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-lsp-runtime-stage7.json",
  import.meta.url,
);

describe("OCI LSP runtime Stage 7 evidence", () => {
  it("binds real LSP execution without overstating host readiness", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-lsp-runtime-stage7");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledProductionPath.externalDaemonUsed, false);
    assert.equal(value.controlledProductionPath.immutableImageIdUsed, true);
    assert.equal(
      value.controlledProductionPath.numericExecutionUserUsedForProbe,
      true,
    );
    assert.equal(
      value.controlledProductionPath.controlledClientExecutedRealLspProtocol,
      true,
    );
    assert.equal(
      value.controlledProductionPath.runtimeIdentityRecordedInResourceReceipt,
      true,
    );
    assert.equal(
      value.controlledProductionPath.publicGenericLspCommandExposed,
      false,
    );
    assert.equal(value.controlledProductionPath.persistentSessionReused, true);
    assert.equal(value.controlledProductionPath.workspaceRootReadOnly, true);
    assert.equal(value.controlledProductionPath.hostRuntimeMountsAdded, false);
    assert.equal(value.controlledProductionPath.missingImageLspRejected, true);
    assert.equal(
      value.controlledProductionPath.malformedImageLspIdentityRejected,
      true,
    );
    assert.equal(
      value.controlledProductionPath.hostAssetOverrideRejected,
      true,
    );
    assert.equal(
      value.controlledProductionPath.lspDoctorProductionProbe,
      "ready",
    );
    assert.equal(value.actualHost.containerServerReachable, false);
    assert.equal(value.actualHost.lspProductionProbeReached, false);
    assert.equal(value.actualHost.lspDoctorCode, "lsp_provider_unavailable");
    assert.equal(value.actualHost.sandboxDoctorCode, "sandbox_unavailable");
    assert.equal(value.actualHost.codingSendBoundary, "blocked");
    assert.equal(value.verification.architectureCycles, 0);
    assert.equal(value.retention.languageServerPath, false);
    assert.equal(value.retention.typescriptServerPath, false);
    assert.equal(value.retention.sourceContent, false);
    assert.equal(value.retention.diagnosticMessage, false);
    assert.equal(value.scope.sliceComplete, true);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /\/tmp\//u);
    assert.doesNotMatch(serialized, /unix:\/\//u);
    assert.doesNotMatch(serialized, /const value: string/u);
    assert.doesNotMatch(serialized, /not assignable to type/u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});

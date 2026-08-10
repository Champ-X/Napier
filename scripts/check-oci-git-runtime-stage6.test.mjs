import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/oci-git-runtime-stage6.json",
  import.meta.url,
);

describe("OCI Git runtime Stage 6 evidence", () => {
  it("binds fixed Git operations without overstating host readiness", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.oci-git-runtime-stage6");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.controlledProductionPath.externalDaemonUsed, false);
    assert.equal(value.controlledProductionPath.immutableImageIdUsed, true);
    assert.equal(
      value.controlledProductionPath.numericExecutionUserUsedForProbe,
      true,
    );
    assert.equal(value.controlledProductionPath.gitVersionProbeExecuted, true);
    assert.equal(
      value.controlledProductionPath.runtimeIdentityRecordedInResourceReceipt,
      true,
    );
    assert.equal(
      value.controlledProductionPath.publicGenericGitCommandExposed,
      false,
    );
    assert.equal(value.controlledProductionPath.workspaceRootReadOnly, true);
    assert.equal(value.controlledProductionPath.privateGitStateOnlyWritable, true);
    assert.equal(value.controlledProductionPath.privateIndexCreated, true);
    assert.equal(value.controlledProductionPath.repositoryIndexModified, false);
    assert.equal(
      value.controlledProductionPath.sandboxReadinessRequiresGitProductionCall,
      true,
    );
    assert.equal(value.actualHost.containerServerReachable, false);
    assert.equal(value.actualHost.gitProductionProbeReached, false);
    assert.equal(value.actualHost.sandboxDoctorCode, "sandbox_unavailable");
    assert.equal(value.actualHost.codingSendBoundary, "blocked");
    assert.equal(value.verification.architectureCycles, 0);
    assert.equal(value.retention.repositoryPaths, false);
    assert.equal(value.retention.repositoryRefs, false);
    assert.equal(value.retention.repositoryContent, false);
    assert.equal(value.scope.sliceComplete, true);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /\/tmp\//u);
    assert.doesNotMatch(serialized, /unix:\/\//u);
    assert.doesNotMatch(serialized, /refs\/(?:heads|tags)\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});

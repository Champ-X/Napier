import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/shell-sandbox-stage1-dogfood.json",
  import.meta.url,
);

describe("Shell and Sandbox Stage 1 dogfood evidence", () => {
  it("binds production readiness and real-model Shell PTY evidence without secrets", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;
    assert.equal(value.kind, "napier.shell-sandbox-stage1-dogfood");
    assert.equal(value.schemaVersion, 1);
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(
      value.defaultProvider.shellDoctorCode,
      "shell_provider_unavailable",
    );
    assert.equal(
      value.defaultProvider.sandboxDoctorCode,
      "sandbox_unavailable",
    );
    assert.equal(value.defaultProvider.containerServerReachable, false);
    assert.equal(
      value.explicitHostDirectProvider.shellDoctorCode,
      "shell_ready",
    );
    assert.equal(value.explicitHostDirectProvider.isolation, "none");
    assert.equal(value.modelDogfood.status, "completed");
    assert.equal(value.modelDogfood.sessionRuntime, "shell");
    assert.equal(value.modelDogfood.ioMode, "pty");
    assert.equal(value.modelDogfood.sessionStatus, "succeeded");
    assert.equal(value.modelDogfood.workspaceDeltaStatus, "unchanged");
    assert.equal(value.modelDogfood.workspaceChangedFileCount, 0);
    assert.deepEqual(value.modelDogfood.observedCommands, [
      "node --version",
      "npm --version",
      "git --version",
    ]);
    assert.match(
      value.modelDogfood.sandboxLabelObservedByModel,
      /host-direct/u,
    );
    assert.match(
      value.modelDogfood.isolationWarningObservedByModel,
      /does not enforce/u,
    );
    assert.equal(value.retention.credentialValues, false);
    assert.equal(value.retention.rawProviderPayload, false);
    assert.equal(value.retention.rawJsonl, false);
    assert.equal(value.scope.s1Complete, false);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});

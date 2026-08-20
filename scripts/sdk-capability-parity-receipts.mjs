import assert from "node:assert/strict";

const STATE_SUMMARIES = [
  ["stale", "agent_napier", 1, "stale", "unknown_legacy"],
  ["current", "agent_napier", 2, "current", "recommended"],
  ["custom_unmanaged", null, 3, "custom_unmanaged", "unmanaged"],
  ["broken", "agent_napier", 3, "broken", "unmanaged"],
];
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_OUTPUT_BYTES = 64 * 1024;

export function verifyFourStateParity(value) {
  exactKeys(value, [
    "schemaVersion",
    "storeIdentitySha256",
    "setupBoundaries",
    "states",
    "cleanup",
  ]);
  assert.equal(value.schemaVersion, 1);
  sha256(value.storeIdentitySha256);
  assert.equal(denseArray(value.setupBoundaries), true);
  assert.equal(value.setupBoundaries.length, 4);
  const [migration, restore, imported, broken] = value.setupBoundaries;
  exactKeys(migration, ["action", "restartCount", "after"]);
  exactKeys(restore, ["action", "restartCount", "before", "after"]);
  exactKeys(imported, [
    "action",
    "restartCount",
    "importedAgentId",
    "before",
    "after",
  ]);
  exactKeys(broken, [
    "action",
    "restartCount",
    "profileSha256Before",
    "profileSha256After",
    "removedLedgerFiles",
    "before",
    "after",
  ]);
  assert.deepEqual(
    value.setupBoundaries.map(({ action, restartCount }) => ({
      action,
      restartCount,
    })),
    [
      { action: "settle_pre_search_migration", restartCount: 1 },
      { action: "public_restore_recommended", restartCount: 1 },
      { action: "public_update_export_import", restartCount: 1 },
      { action: "bracketed_broken_fixture_patch", restartCount: 2 },
    ],
  );
  assert.match(imported.importedAgentId, /^agent_[a-f0-9]{20}$/u);
  sha256(broken.profileSha256Before);
  assert.equal(broken.profileSha256After, broken.profileSha256Before);
  assert.deepEqual(broken.removedLedgerFiles, [
    "ledger.sqlite",
    "ledger.sqlite-shm",
    "ledger.sqlite-wal",
  ]);
  assert.equal(denseArray(value.states), true);
  assert.equal(value.states.length, STATE_SUMMARIES.length);
  const stateDigests = [];
  for (const [index, state] of value.states.entries()) {
    exactKeys(state, [
      "name",
      "agentId",
      "agentRevision",
      "driftState",
      "ownership",
      "projectionSha256",
      "serializedProjectionSha256",
      "entriesDeepEqual",
      "reads",
    ]);
    const [name, agentId, revision, drift, ownership] = STATE_SUMMARIES[index];
    assert.equal(state.name, name);
    assert.equal(state.agentId, agentId ?? imported.importedAgentId);
    assert.equal(state.agentRevision, revision);
    assert.equal(state.driftState, drift);
    assert.equal(state.ownership, ownership);
    sha256(state.projectionSha256);
    sha256(state.serializedProjectionSha256);
    assert.equal(state.entriesDeepEqual, true);
    exactKeys(state.reads, ["cli", "web", "sdk"]);
    const surfaces = [state.reads.cli, state.reads.web, state.reads.sdk];
    for (const surface of surfaces) {
      exactKeys(surface, ["before", "after", "unchanged"]);
      digestRecord(surface.before);
      digestRecord(surface.after);
      assert.equal(surface.unchanged, true);
      assert.deepEqual(surface.after, surface.before);
    }
    assert.deepEqual(surfaces[1].before, surfaces[0].before);
    assert.deepEqual(surfaces[2].before, surfaces[0].before);
    stateDigests.push(surfaces[0].before);
  }
  for (const boundary of value.setupBoundaries) {
    if (boundary.before) digestRecord(boundary.before);
    digestRecord(boundary.after);
  }
  assert.deepEqual(migration.after, stateDigests[0]);
  assert.deepEqual(restore.before, stateDigests[0]);
  assert.deepEqual(restore.after, stateDigests[1]);
  assert.deepEqual(imported.before, stateDigests[1]);
  assert.deepEqual(imported.after, stateDigests[2]);
  assert.deepEqual(broken.before, stateDigests[2]);
  assert.deepEqual(broken.after, stateDigests[3]);
  exactKeys(value.cleanup, ["removed"]);
  assert.equal(value.cleanup.removed, true);
}

export function verifyProductionServerTrace(value, identity) {
  const traceKeys = [
    "schemaVersion",
    "serverEntrySha256",
    "sdkManagementEntrySha256",
    "allowlistedEnvironmentKeys",
    "listener",
    "child",
    "example",
    "sdk",
  ];
  if (value.schemaVersion >= 2) traceKeys.push("workspaceRegistryIsolated");
  traceKeys.push(
    "storeNonMutation",
    "portClosed",
    "postExitSdkRequestFailed",
    "cleanup",
    "storeDigests",
  );
  exactKeys(value, traceKeys);
  assert.ok(value.schemaVersion === 1 || value.schemaVersion === 2);
  assert.equal(
    value.serverEntrySha256,
    identity.files["apps/server/dist/index.js"],
  );
  assert.equal(
    value.sdkManagementEntrySha256,
    identity.files["packages/sdk/dist/management.js"],
  );
  const environmentKeys = ["LANG", "NAPIER_HOME", "NAPIER_PORT"];
  if (value.schemaVersion >= 2) environmentKeys.push("NAPIER_STATE_HOME");
  environmentKeys.push("NAPIER_WORKSPACE", "NODE_ENV", "TMPDIR", "TZ");
  assert.deepEqual(value.allowlistedEnvironmentKeys, environmentKeys);
  exactKeys(value.listener, [
    "loopback",
    "ephemeralNonzeroPort",
    "announcedOriginSha256",
  ]);
  assert.equal(value.listener.loopback, true);
  assert.equal(value.listener.ephemeralNonzeroPort, true);
  sha256(value.listener.announcedOriginSha256);
  processReceipt(value.child, true);
  processReceipt(value.example, false);
  exactKeys(value.sdk, [
    "externalProcess",
    "builtPackageSubpath",
    "globalFetch",
    "integrityVerified",
    "agentId",
    "agentRevision",
    "driftState",
    "ownership",
    "projectionSha256",
  ]);
  assert.deepEqual(
    { ...value.sdk, projectionSha256: "digest" },
    {
      externalProcess: true,
      builtPackageSubpath: true,
      globalFetch: true,
      integrityVerified: true,
      agentId: "agent_napier",
      agentRevision: 1,
      driftState: "current",
      ownership: "recommended",
      projectionSha256: "digest",
    },
  );
  sha256(value.sdk.projectionSha256);
  if (value.schemaVersion >= 2) {
    assert.equal(value.workspaceRegistryIsolated, true);
  }
  assert.equal(value.storeNonMutation, true);
  assert.equal(value.portClosed, true);
  assert.equal(value.postExitSdkRequestFailed, true);
  exactKeys(value.cleanup, ["rootValidated", "removed"]);
  assert.deepEqual(value.cleanup, { rootValidated: true, removed: true });
  exactKeys(value.storeDigests, ["before", "after"]);
  digestRecord(value.storeDigests.before);
  digestRecord(value.storeDigests.after);
  assert.deepEqual(value.storeDigests.after, value.storeDigests.before);
}

function processReceipt(value, server) {
  exactKeys(value, [
    server ? "startupBounded" : "timeoutBounded",
    "outputBounded",
    "gracefulZeroExit",
    "forcedCleanup",
    "stdoutBytes",
    "stderrBytes",
    "totalOutputBytes",
    "maximumOutputBytes",
  ]);
  assert.equal(value[server ? "startupBounded" : "timeoutBounded"], true);
  assert.equal(value.outputBounded, true);
  assert.equal(value.gracefulZeroExit, true);
  assert.equal(value.forcedCleanup, false);
  assert.equal(value.maximumOutputBytes, MAX_OUTPUT_BYTES);
  assert.ok(Number.isSafeInteger(value.stdoutBytes));
  assert.ok(Number.isSafeInteger(value.stderrBytes));
  assert.ok(value.stdoutBytes >= 0);
  assert.ok(value.stderrBytes >= 0);
  assert.equal(value.totalOutputBytes, value.stdoutBytes + value.stderrBytes);
  assert.ok(Number.isSafeInteger(value.totalOutputBytes));
  assert.ok(value.totalOutputBytes >= 0);
  assert.ok(value.totalOutputBytes <= value.maximumOutputBytes);
}

function digestRecord(value) {
  exactKeys(value, [
    "rawWorkspaceSha256",
    "logicalStoreSha256",
    "eventManifestSha256",
  ]);
  for (const digest of Object.values(value)) sha256(digest);
}

function exactKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value), keys);
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function sha256(value) {
  assert.equal(typeof value, "string");
  assert.match(value, SHA256);
}

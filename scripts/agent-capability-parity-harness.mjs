import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { runCli } from "../apps/cli/dist/cli.js";
import { createApp, createServices } from "../apps/server/dist/app.js";
import { createNapierManagementClient } from "../packages/sdk/dist/management.js";

const FIXTURE_ROOT = path.resolve(
  "packages/runtime/test/fixtures/capability-contract-v1/pre-search",
);
const BROKEN_RECOMMENDATION_SHA256 = "f".repeat(64);

export async function runFourStateCapabilityParity() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sdk-capability-parity-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const requestedDataRoot = path.join(root, "state");
  const receipt = {
    schemaVersion: 1,
    storeIdentitySha256: "",
    setupBoundaries: [],
    states: [],
    cleanup: { removed: false },
  };
  try {
    await mkdir(workspaceRoot);
    await cp(FIXTURE_ROOT, requestedDataRoot, { recursive: true });
    const dataRoot = await realpath(requestedDataRoot);
    receipt.storeIdentitySha256 = sha256Text(dataRoot);
    await withServices(workspaceRoot, dataRoot, async () => undefined);
    receipt.setupBoundaries.push({
      action: "settle_pre_search_migration",
      restartCount: 1,
      after: await storeDigests(dataRoot),
    });

    receipt.states.push(
      await readState({
        name: "stale",
        agentId: "agent_napier",
        expectedRevision: 1,
        expectedDriftState: "stale",
        expectedOwnership: "unknown_legacy",
        workspaceRoot,
        dataRoot,
        cwd: root,
      }),
    );

    const restoreBefore = await storeDigests(dataRoot);
    await restoreRecommended(workspaceRoot, dataRoot);
    receipt.setupBoundaries.push({
      action: "public_restore_recommended",
      restartCount: 1,
      before: restoreBefore,
      after: await storeDigests(dataRoot),
    });
    receipt.states.push(
      await readState({
        name: "current",
        agentId: "agent_napier",
        expectedRevision: 2,
        expectedDriftState: "current",
        expectedOwnership: "recommended",
        workspaceRoot,
        dataRoot,
        cwd: root,
      }),
    );

    const importBefore = await storeDigests(dataRoot);
    const importedAgentId = await customizeAndImport(workspaceRoot, dataRoot);
    assert.match(importedAgentId, /^agent_[a-f0-9]{20}$/u);
    receipt.setupBoundaries.push({
      action: "public_update_export_import",
      restartCount: 1,
      importedAgentId,
      before: importBefore,
      after: await storeDigests(dataRoot),
    });
    receipt.states.push(
      await readState({
        name: "custom_unmanaged",
        agentId: importedAgentId,
        expectedRevision: 3,
        expectedDriftState: "custom_unmanaged",
        expectedOwnership: "unmanaged",
        workspaceRoot,
        dataRoot,
        cwd: root,
      }),
    );

    const brokenBefore = await storeDigests(dataRoot);
    const profileSha256Before = await agentProfileSha256(
      dataRoot,
      "agent_napier",
    );
    const profileSha256After = await patchBrokenBinding(dataRoot);
    assert.equal(profileSha256After, profileSha256Before);
    await withServices(workspaceRoot, dataRoot, async () => undefined);
    receipt.setupBoundaries.push({
      action: "bracketed_broken_fixture_patch",
      restartCount: 2,
      profileSha256Before,
      profileSha256After,
      removedLedgerFiles: [
        "ledger.sqlite",
        "ledger.sqlite-shm",
        "ledger.sqlite-wal",
      ],
      before: brokenBefore,
      after: await storeDigests(dataRoot),
    });
    const broken = await readState({
      name: "broken",
      agentId: "agent_napier",
      expectedRevision: 3,
      expectedDriftState: "broken",
      expectedOwnership: "unmanaged",
      workspaceRoot,
      dataRoot,
      cwd: root,
    });
    assert.equal(
      await agentProfileSha256(dataRoot, "agent_napier"),
      profileSha256After,
    );
    receipt.states.push(broken);
    return receipt;
  } finally {
    await rm(root, { recursive: true, force: true });
    receipt.cleanup.removed = await access(root).then(
      () => false,
      () => true,
    );
  }
}

async function readState(input) {
  const cliRead = await immutableRead(input.dataRoot, async () =>
    runCapabilityCli(input),
  );
  let webRead;
  let sdkRead;
  await withServices(input.workspaceRoot, input.dataRoot, async (services) => {
    const app = createApp(services);
    webRead = await immutableRead(input.dataRoot, async () => {
      const response = await app.request(
        `/api/agents/${input.agentId}/capabilities`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(
        response.headers.get("x-napier-content-sha256-mode"),
        "body",
      );
      const body = await response.text();
      assert.equal(
        response.headers.get("x-napier-content-sha256"),
        sha256Text(body),
      );
      const projection = JSON.parse(body);
      assert.equal(
        response.headers.get("x-napier-agent-capability-projection-sha256"),
        projection.projectionSha256,
      );
      return projection;
    });
    sdkRead = await immutableRead(input.dataRoot, async () =>
      createNapierManagementClient({
        baseUrl: "http://127.0.0.1",
        fetch: (request, init) => app.fetch(new Request(request, init)),
      }).getEffectiveAgentCapabilities({ agentId: input.agentId }),
    );
  });
  assert.deepEqual(webRead.value, cliRead.value);
  assert.deepEqual(sdkRead.value, cliRead.value);
  const projection = cliRead.value;
  assert.equal(projection.agentId, input.agentId);
  assert.equal(projection.agentRevision, input.expectedRevision);
  assert.equal(projection.driftState, input.expectedDriftState);
  assert.equal(projection.ownership, input.expectedOwnership);
  return {
    name: input.name,
    agentId: input.agentId,
    agentRevision: projection.agentRevision,
    driftState: projection.driftState,
    ownership: projection.ownership,
    projectionSha256: projection.projectionSha256,
    serializedProjectionSha256: sha256Text(JSON.stringify(projection)),
    entriesDeepEqual: true,
    reads: {
      cli: cliRead.digests,
      web: webRead.digests,
      sdk: sdkRead.digests,
    },
  };
}

async function restoreRecommended(workspaceRoot, dataRoot) {
  await withServices(workspaceRoot, dataRoot, async (services) => {
    const app = createApp(services);
    const previewResponse = await app.request(
      "/api/agents/agent_napier/capabilities",
    );
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    const response = await app.request(
      "/api/agents/agent_napier/capabilities/restore",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: preview.agentRevision,
          diffSha256: preview.restorePreview.diffSha256,
        }),
      },
    );
    assert.equal(response.status, 200);
    const restored = await response.json();
    assert.equal(restored.previousRevision, 1);
    assert.equal(restored.projection.agentRevision, 2);
  });
}

async function customizeAndImport(workspaceRoot, dataRoot) {
  return withServices(workspaceRoot, dataRoot, async (services) => {
    const app = createApp(services);
    const update = await app.request("/api/agents/agent_napier", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabledSkills: ["custom-skill"] }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.revision, 3);
    const state = JSON.parse(
      await readFile(path.join(dataRoot, "workspace.json")),
    );
    const sourceThread = state.threads.find(
      (thread) => thread.agentId === "agent_napier",
    );
    assert.ok(sourceThread);
    const exported = await app.request(
      `/api/threads/${sourceThread.id}/fixture`,
    );
    assert.equal(exported.status, 200);
    const bundle = await exported.json();
    const imported = await app.request("/api/threads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle }),
    });
    assert.equal(imported.status, 201);
    const detail = await imported.json();
    assert.equal(detail.agent.revision, 3);
    assert.notEqual(detail.agent.id, "agent_napier");
    assert.equal(detail.thread.agentId, detail.agent.id);
    return detail.agent.id;
  });
}

async function patchBrokenBinding(dataRoot) {
  for (const name of [
    "ledger.sqlite",
    "ledger.sqlite-shm",
    "ledger.sqlite-wal",
  ]) {
    await rm(path.join(dataRoot, name), { force: true });
  }
  const workspacePath = path.join(dataRoot, "workspace.json");
  const state = JSON.parse(await readFile(workspacePath, "utf8"));
  const agent = state.agents.find(
    (candidate) => candidate.id === "agent_napier",
  );
  assert.equal(agent.revision, 3);
  const binding = state.agentCapabilityBindings.find(
    (candidate) =>
      candidate.agentId === "agent_napier" && candidate.agentRevision === 3,
  );
  assert.ok(binding);
  binding.contractVersion = 2;
  binding.recommendationSha256 = BROKEN_RECOMMENDATION_SHA256;
  await writeFile(workspacePath, `${JSON.stringify(state, null, 2)}\n`);
  return sha256Text(canonicalJson(agent));
}

async function runCapabilityCli(input) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const exitCode = await runCli(
    [
      "capabilities",
      "--workspace",
      input.workspaceRoot,
      "--data-root",
      input.dataRoot,
      "--agent",
      input.agentId,
      "--jsonl",
    ],
    { cwd: input.cwd, env: {}, stdout, stderr },
  );
  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  const result = JSON.parse(stdout.text());
  assert.equal(result.action, "status");
  assert.ok(result.projection);
  return result.projection;
}

async function immutableRead(dataRoot, operation) {
  const before = await storeDigests(dataRoot);
  const value = await operation();
  const after = await storeDigests(dataRoot);
  assert.deepEqual(after, before);
  return { value, digests: { before, after, unchanged: true } };
}

async function withServices(workspaceRoot, dataRoot, operation) {
  const services = await createServices({ workspaceRoot, dataRoot, env: {} });
  try {
    return await operation(services);
  } finally {
    await services.shutdownLocalRuntime();
  }
}

async function storeDigests(dataRoot) {
  const workspaceBytes = await readFile(path.join(dataRoot, "workspace.json"));
  const workspace = JSON.parse(workspaceBytes.toString("utf8"));
  const eventManifest = [];
  await collectEventFiles(dataRoot, dataRoot, eventManifest);
  eventManifest.sort((left, right) => left.path.localeCompare(right.path));
  return {
    rawWorkspaceSha256: sha256Bytes(workspaceBytes),
    logicalStoreSha256: sha256Text(canonicalJson(workspace)),
    eventManifestSha256: sha256Text(canonicalJson(eventManifest)),
  };
}

async function collectEventFiles(root, current, output) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectEventFiles(root, absolute, output);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        sha256: sha256Bytes(await readFile(absolute)),
      });
    }
  }
}

async function agentProfileSha256(dataRoot, agentId) {
  const state = JSON.parse(
    await readFile(path.join(dataRoot, "workspace.json"), "utf8"),
  );
  const agent = state.agents.find((candidate) => candidate.id === agentId);
  assert.ok(agent);
  return sha256Text(canonicalJson(agent));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

class CaptureWritable extends Writable {
  chunks = [];

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
} from "../packages/runtime/dist/index.js";
import { createAgentProfileRevision } from "../packages/runtime/dist/agents.js";
import {
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256,
} from "../packages/runtime/dist/default-agent-capability-contract.js";
import {
  removeWebUiE2eRoot,
  startProductionWebServer,
  startWebUiBrowser,
} from "./web-ui-e2e-runtime.mjs";

const execFileAsync = promisify(execFile);
const CLI_ENTRY = path.resolve("apps/cli/dist/index.js");
const MAX_OUTPUT_BYTES = 1024 * 1024;

export async function runProfileUpgradeAcceptance(repoRoot) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-web-ui-e2e-"));
  await Promise.all(
    ["state", "workspace", "tmp", "browser-profile", "home"].map((name) =>
      mkdir(path.join(root, name), { recursive: true, mode: 0o700 }),
    ),
  );
  let server;
  let browser;
  try {
    await seedV2Override(path.join(root, "workspace"), path.join(root, "state"));
    const cli = await runCliArm(repoRoot, root);
    await seedV2Override(path.join(root, "workspace"), path.join(root, "state"));
    server = await startProductionWebServer(root);
    browser = await startWebUiBrowser(root);
    const web = await runWebArm(browser.browser, server.origin, root);
    await browser.close();
    browser = undefined;
    await server.close();
    server = undefined;
    const unmanaged = await runUnmanagedArm(repoRoot, root);
    return {
      cli,
      web,
      unmanaged,
      cleanup: {
        serverClosed: true,
        browserClosed: true,
        taskRootRemoved: true,
      },
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await removeWebUiE2eRoot(root);
  }
}

async function runCliArm(repoRoot, root) {
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const before = await inspectState(workspaceRoot, dataRoot);
  const preview = await runJsonCli(repoRoot, root, [
    "capabilities",
    "--workspace",
    workspaceRoot,
    "--data-root",
    dataRoot,
    "--upgrade-recommended",
    "--jsonl",
  ]);
  const upgrade = preview.value.projection.upgradePreview;
  assert.equal(preview.code, 0);
  assert.equal(preview.value.action, "upgrade_preview");
  assertUpgradePreview(upgrade);
  const applied = await runJsonCli(repoRoot, root, [
    "capabilities",
    "--workspace",
    workspaceRoot,
    "--data-root",
    dataRoot,
    "--upgrade-recommended",
    "--expected-revision",
    String(upgrade.agentRevision),
    "--diff-sha256",
    upgrade.diffSha256,
    "--apply",
    "--jsonl",
  ]);
  assert.equal(applied.code, 0);
  assert.equal(applied.value.action, "upgraded");
  const stale = await runJsonCli(
    repoRoot,
    root,
    [
      "capabilities",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--upgrade-recommended",
      "--expected-revision",
      String(upgrade.agentRevision),
      "--diff-sha256",
      upgrade.diffSha256,
      "--apply",
      "--jsonl",
    ],
    { allowFailure: true },
  );
  assert.notEqual(stale.code, 0);
  const after = await inspectState(workspaceRoot, dataRoot);
  assertUpgraded(before, after);
  return acceptanceProjection(before, after, upgrade, {
    entry: "built_cli",
    stalePreviewRejected: true,
  });
}

async function runWebArm(browser, origin, root) {
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const before = await inspectState(workspaceRoot, dataRoot);
  const context = browser.contexts()[0];
  assert.ok(context);
  const consoleErrors = [];
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#inspector-group-inspect").click();
  const card = page.locator("#agent-capability-contract-review");
  await card.waitFor({ state: "visible" });
  await card.getByText("Safe contract upgrade diff").waitFor();
  await card.getByText("enabledSkills").waitFor();
  await card.locator("details").first().locator("summary").click();
  await card.getByText("skill_load").waitFor();
  const preview = await fetch(`${origin}/api/agents/agent_napier/capabilities`, {
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());
  assertUpgradePreview(preview.upgradePreview);
  await card.locator('input[type="checkbox"]').check();
  await card.getByRole("button", {
    name: "Upgrade while preserving overrides",
  }).click();
  await card.getByText(/v3 · current · explicit_overrides/u).waitFor();
  const horizontalOverflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  await page.close();
  const after = await inspectState(workspaceRoot, dataRoot);
  assertUpgraded(before, after);
  assert.equal(consoleErrors.length, 0);
  assert.equal(horizontalOverflowPx, 0);
  return acceptanceProjection(before, after, preview.upgradePreview, {
    entry: "production_web",
    stalePreviewRejected: false,
    consoleErrorCount: consoleErrors.length,
    horizontalOverflowPx,
  });
}

async function runUnmanagedArm(repoRoot, root) {
  const workspaceRoot = path.join(root, "workspace-unmanaged");
  const dataRoot = path.join(root, "state-unmanaged");
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  await seedUnmanaged(workspaceRoot, dataRoot);
  const before = await inspectState(workspaceRoot, dataRoot);
  const result = await runJsonCli(
    repoRoot,
    root,
    [
      "capabilities",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--upgrade-recommended",
      "--jsonl",
    ],
    { allowFailure: true },
  );
  assert.notEqual(result.code, 0);
  const after = await inspectState(workspaceRoot, dataRoot);
  assert.equal(after.profileSha256, before.profileSha256);
  assert.equal(after.revisionCount, before.revisionCount);
  return {
    entry: "built_cli",
    driftState: before.projection.driftState,
    ownership: before.projection.ownership,
    upgradePreviewAbsent: before.projection.upgradePreview === undefined,
    rejected: true,
    profileUnchanged: true,
    revisionCountDelta: 0,
  };
}

async function seedV2Override(workspaceRoot, dataRoot) {
  await resetRoot(dataRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("profile-upgrade-acceptance"),
  });
  const seeded = services.store.listAgents()[0];
  const customized = await services.store.updateAgent(seeded.id, {
    enabledSkills: ["research-brief"],
  });
  await services.shutdown();
  await removeLedger(dataRoot);
  const statePath = path.join(dataRoot, "workspace.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const profile = state.agents.find((agent) => agent.id === customized.id);
  profile.enabledTools = [
    ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2.enabledTools,
  ];
  const index = state.agentRevisions.findIndex(
    (revision) =>
      revision.agentId === profile.id && revision.revision === profile.revision,
  );
  state.agentRevisions[index] = createAgentProfileRevision(profile, {
    source: "updated",
    changedFields: ["enabledSkills"],
  });
  const binding = state.agentCapabilityBindings.find(
    (candidate) =>
      candidate.agentId === profile.id &&
      candidate.agentRevision === profile.revision,
  );
  Object.assign(binding, {
    contractVersion: 2,
    recommendationSha256:
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_V2_SHA256,
    source: "updated",
    ownership: "explicit_overrides",
    explicitOverrideFields: ["enabledSkills"],
  });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function seedUnmanaged(workspaceRoot, dataRoot) {
  await resetRoot(dataRoot);
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("profile-upgrade-acceptance"),
  });
  await services.shutdown();
  await removeLedger(dataRoot);
  const statePath = path.join(dataRoot, "workspace.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.agentCapabilityBindings = [];
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function inspectState(workspaceRoot, dataRoot) {
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: {},
    sandbox: new UnsupportedSandboxAdapter("profile-upgrade-acceptance"),
  });
  try {
    const agent = services.store.listAgents()[0];
    const projection = await services.agentCapabilities.project(agent.id);
    const binding = services.store.getAgentCapabilityBinding(
      agent.id,
      agent.revision,
    );
    return {
      agent,
      projection,
      binding,
      revisionCount: services.store.listAgentRevisions(agent.id).length,
      profileSha256: sha256(canonicalJson(agent)),
      nonManagedSha256: sha256(
        canonicalJson({
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          thinkingLevel: agent.thinkingLevel,
          runLimits: agent.runLimits,
        }),
      ),
    };
  } finally {
    await services.shutdown();
  }
}

function acceptanceProjection(before, after, preview, extra) {
  const binding =
    after.binding.status === "valid" ? after.binding.binding : undefined;
  return {
    ...extra,
    sourceContractVersion: preview.sourceContractVersion,
    targetContractVersion: preview.targetContractVersion,
    revisionBefore: before.agent.revision,
    revisionAfter: after.agent.revision,
    revisionCountDelta: after.revisionCount - before.revisionCount,
    operationCount: preview.operations.length,
    operationSetSha256: sha256(canonicalJson(preview.operations)),
    diffSha256: preview.diffSha256,
    explicitOverrideFields: [...preview.explicitOverrideFields],
    overridesPreserved:
      canonicalJson(after.agent.enabledSkills) ===
      canonicalJson(before.agent.enabledSkills),
    skillLoadAdded:
      !before.agent.enabledTools.includes("skill_load") &&
      after.agent.enabledTools.includes("skill_load"),
    nonManagedStateUnchanged:
      before.nonManagedSha256 === after.nonManagedSha256,
    bindingSource: binding?.source,
    bindingOwnership: binding?.ownership,
    projectionSha256: after.projection.projectionSha256,
  };
}

function assertUpgradePreview(preview) {
  assert.equal(preview.sourceContractVersion, 2);
  assert.equal(preview.targetContractVersion, 3);
  assert.deepEqual(preview.explicitOverrideFields, ["enabledSkills"]);
  assert.deepEqual(preview.operations, [
    {
      field: "enabledTools",
      operation: "add",
      value: "skill_load",
      effect: "read",
      risk: "low",
    },
  ]);
}

function assertUpgraded(before, after) {
  assert.equal(after.agent.revision, before.agent.revision + 1);
  assert.equal(after.revisionCount, before.revisionCount + 1);
  assert.deepEqual(after.agent.enabledSkills, before.agent.enabledSkills);
  assert.equal(after.agent.enabledTools.includes("skill_load"), true);
  assert.equal(after.nonManagedSha256, before.nonManagedSha256);
  assert.equal(after.projection.driftState, "current");
  assert.equal(after.projection.ownership, "explicit_overrides");
  assert.deepEqual(after.projection.explicitOverrideFields, ["enabledSkills"]);
  assert.equal(after.projection.upgradePreview, undefined);
  assert.equal(after.binding.status, "valid");
  assert.equal(after.binding.binding.source, "contract_upgrade");
}

async function runJsonCli(repoRoot, root, args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: repoRoot,
      env: processEnvironment(root),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(result.stderr, "");
    return { code: 0, value: JSON.parse(lines[0]) };
  } catch (error) {
    if (!options.allowFailure) throw error;
    return {
      code: Number(error.code) || 1,
      value: undefined,
    };
  }
}

function processEnvironment(root) {
  return {
    CI: "true",
    HOME: path.join(root, "home"),
    LANG: "C",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: path.join(root, "tmp"),
    TZ: "UTC",
  };
}

async function resetRoot(candidate) {
  await rm(candidate, { recursive: true, force: true });
  await mkdir(candidate, { recursive: true, mode: 0o700 });
}

async function removeLedger(dataRoot) {
  await Promise.all(
    ["ledger.sqlite", "ledger.sqlite-shm", "ledger.sqlite-wal"].map((name) =>
      rm(path.join(dataRoot, name), { force: true }),
    ),
  );
}

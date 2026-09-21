import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  assertProfileFileSelection,
  readCampaignProfile,
  freezeCampaignProfile,
  assertFrozenCampaignProfile,
} from "./harness-campaign-profile.mjs";
import {
  createModelHarnessExperimentProfile,
  bindRunHarnessProfile,
} from "../packages/runtime/dist/model-harness-experiment-profile.js";
import { createHarnessPolicyProfile } from "../packages/runtime/dist/harness-policy-profile.js";

const runtimeRoot = process.cwd();
function profile() {
  const base = bindRunHarnessProfile({
    harnessPolicyPreset: "coding-python.v1",
  }).harnessExperimentProfile;
  const {
    schemaVersion: _version,
    contentSha256: _hash,
    ...policies
  } = base.policies;
  return createModelHarnessExperimentProfile({
    ...base,
    policies: createHarnessPolicyProfile({
      ...policies,
      context: {
        ...base.policies.context,
        memory: "task-aware-grouped-v3",
        delivery: "tail-v1",
        finalization: "request-aware-v1",
        validation: "contract-first-v1",
        verificationOrder: "before-first-patch-v1",
      },
    }),
  });
}
async function fixture(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-profile-test-"));
  const file = path.join(root, "profile.json");
  try {
    await writeFile(file, JSON.stringify(profile()));
    await action({ root, file });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function cli(script, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/API_KEY|TOKEN|SECRET|LIVE|NODE_OPTIONS/iu.test(key),
    ),
  );
  return spawnSync(
    process.execPath,
    [`scripts/run-harness-optimization-${script}.mjs`, ...args],
    { cwd: runtimeRoot, env, encoding: "utf8", timeout: 30000 },
  );
}

test("explicit profiles preserve production composition and reject ambiguous selectors", () => {
  assert.throws(
    () => assertProfileFileSelection({ "profile-file": "" }),
    /nonempty/,
  );
  assertProfileFileSelection({
    "profile-file": "explicit.json",
    "profile-mode": "policy",
  });
  for (const patch of [
    { policy: "coding-python.v1" },
    { "profile-mode": "default" },
    { "context-delivery": "tail-v1" },
    { finalization: "legacy" },
    { "edit-dialect": "hashline" },
    { "calibration-catalog": "catalog.json" },
  ])
    assert.throws(
      () =>
        assertProfileFileSelection({
          "profile-file": "explicit.json",
          ...patch,
        }),
      /cannot be combined/,
    );
});

test("frozen validated composition survives original file changes and rejects snapshot tampering", () =>
  fixture(async ({ root, file }) => {
    const target = path.join(root, "frozen.json");
    const receipt = await freezeCampaignProfile(file, runtimeRoot, target);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    await writeFile(file, "changed after freeze");
    await assertFrozenCampaignProfile(receipt);
    assert.deepEqual(
      (await readCampaignProfile(target, runtimeRoot, receipt.fileSha256))
        .profile,
      profile(),
    );
    await assert.rejects(
      freezeCampaignProfile(target, runtimeRoot, target),
      /EEXIST/,
    );
    await writeFile(
      target,
      JSON.stringify(
        bindRunHarnessProfile({ harnessPolicyPreset: "coding-node.v1" })
          .harnessExperimentProfile,
      ),
    );
    await assert.rejects(assertFrozenCampaignProfile(receipt), /changed/);
    await assert.rejects(
      readCampaignProfile(target, runtimeRoot, receipt.fileSha256),
      /changed/,
    );
  }));

test("corrupt profile hashes and invalid production policy combinations fail before freezing", () =>
  fixture(async ({ root, file }) => {
    const invalid = profile();
    invalid.policies.context.verificationOrder = "unknown";
    await writeFile(file, JSON.stringify(invalid));
    const target = path.join(root, "frozen.json");
    await assert.rejects(freezeCampaignProfile(file, runtimeRoot, target));
    assert.equal((await readdir(root)).includes("frozen.json"), false);
    await writeFile(file, " ".repeat(256 * 1024 + 1));
    await assert.rejects(readCampaignProfile(file, runtimeRoot), /256 KiB/);
  }));

test("standalone campaign validates exact profile bytes before credentials or execution", () =>
  fixture(async ({ root, file }) => {
    const args = [
      "--runtime-root",
      runtimeRoot,
      "--case-root",
      "/nonexistent",
      "--output",
      path.join(root, "out"),
      "--max-api-requests",
      "0",
      "--api-request-interval-ms",
      "1000",
      "--profile-file",
      file,
    ];
    const result = cli("campaign", [
      ...args,
      "--profile-file-sha256",
      "0".repeat(64),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Frozen campaign profile changed/);
    assert.doesNotMatch(result.stderr, /credential is required/);
    assert.equal((await readdir(root)).includes("out"), false);
    const conflict = cli("campaign", [...args, "--policy", "coding-python.v1"]);
    assert.match(conflict.stderr, /cannot be combined/);
  }));

test("real zero-budget suite freezes both arm profiles and retains all 180 missing observations", () =>
  fixture(async ({ root, file }) => {
    const output = path.join(root, "suite");
    const result = cli("suite", [
      "--suite",
      path.join(runtimeRoot, "benchmarks/harness-core-quality-suite-v1.json"),
      "--output",
      output,
      "--baseline-runtime",
      runtimeRoot,
      "--candidate-runtime",
      runtimeRoot,
      "--baseline-profile-file",
      file,
      "--candidate-profile-file",
      file,
      "--max-api-requests",
      "0",
      "--api-request-interval-ms",
      "1000",
      "--concurrency",
      "1",
    ]);
    assert.equal(result.status, 1, result.stderr);
    const schedule = JSON.parse(
      await readFile(path.join(output, "schedule.json"), "utf8"),
    );
    for (const arm of ["baseline", "candidate"]) {
      assert.equal(
        schedule.profiles[arm].profileSha256,
        profile().contentSha256,
      );
      await assertFrozenCampaignProfile(schedule.profiles[arm]);
    }
    const receipt = JSON.parse(
      await readFile(path.join(output, "suite-result.json"), "utf8"),
    );
    assert.equal(receipt.missing.length, 180);
    assert.equal(receipt.apiRequestBudget.admitted, 0);
    assert.equal(receipt.promotionReady, false);
    assert.equal(receipt.stop.reason, "api_request_budget_exhausted");
    assert.equal(receipt.statuses[0].result.spawned, false);
    assert.ok(
      receipt.statuses.slice(1).every((s) => s.status === "not_started"),
    );
    assert.equal(
      (await readdir(output)).filter((name) => name.endsWith(".log")).length,
      0,
    );
  }));

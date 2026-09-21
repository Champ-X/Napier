import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createRunConfigurationFingerprint,
  validateRunConfigurationFingerprint,
} from "../packages/runtime/src/run-config.js";
import { canonicalJson, sha256 } from "../packages/runtime/src/ed25519.js";
import { createEnvironmentCapabilityNegotiationReceipt } from "../packages/runtime/src/environment-capability-negotiation.js";
import {
  collectEnvironmentEvidence,
  environmentEvidenceEligible,
} from "./harness-environment-evidence.mjs";

const support = { validateRunConfigurationFingerprint, canonicalJson, sha256 };
const profile = {
  id: "agent_test",
  revision: 1,
  systemPrompt: "PRIVATE_PROMPT",
  model: { provider: "napier", id: "demo" },
  thinkingLevel: "medium",
  toolPolicy: "workspace",
  enabledTools: ["read_file", "run_command"],
  enabledSkills: [],
  enabledSubagents: [],
  subagentLimits: {
    maxConcurrent: 2,
    maxTotal: 6,
    maxTurns: 12,
    timeoutMs: 180000,
  },
  runLimits: {
    maxTurns: 24,
    maxTotalTokens: 250000,
    maxCostUsd: 3,
    timeoutMs: 240000,
  },
};
function fixture(mode = "standard") {
  const configuration = createRunConfigurationFingerprint(
    profile,
    profile.model,
    mode,
    { skillCatalogSha256: sha256("catalog") },
  );
  const run = { id: "run_one", configuration };
  const events = [
    {
      id: "started",
      runId: run.id,
      type: "run.started",
      payload: { configurationSha256: configuration.contentSha256 },
    },
  ];
  if (mode !== "standard")
    events.push({
      id: "degraded",
      runId: run.id,
      type: "run.environment.negotiated",
      payload: createEnvironmentCapabilityNegotiationReceipt({
        configuredProfile: profile,
        activeProfile: configuration,
        sandboxId: "oci-container",
        readiness: {
          id: "sandbox:oci-container",
          status: "unavailable",
          detail: "PRIVATE_HOST",
        },
      }),
    });
  return { run, events };
}
const collect = ({ run, events }) =>
  collectEnvironmentEvidence(
    run,
    events,
    profile.enabledTools,
    "oci-container",
    support,
  );
const report = (evidence) => ({
  runId: "run_one",
  sandbox: "oci-container",
  environmentEvidence: evidence,
});

test("actual configuration and start receipt bind eligible execution without leaking inputs", () => {
  const evidence = collect(fixture());
  assert.equal(evidence.valid, true);
  assert.equal(environmentEvidenceEligible(report(evidence)), true);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE"), false);
  assert.equal(
    environmentEvidenceEligible({ ...report(evidence), runId: "foreign" }),
    false,
  );
  assert.equal(
    environmentEvidenceEligible(
      report({ ...evidence, missingTools: ["run_command"] }),
    ),
    false,
  );
});

test("valid degradation remains forensic evidence but cannot qualify a task comparison", () => {
  const evidence = collect(fixture("environment_degraded_read_only"));
  assert.equal(evidence.valid, true);
  assert.equal(evidence.eligible, false);
  assert.deepEqual(evidence.missingTools, ["run_command"]);
  assert.equal(evidence.receipts.length, 1);
  assert.equal(environmentEvidenceEligible(report(evidence)), false);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE"), false);
});

test("absent, forged, foreign and contradictory bindings fail closed", () => {
  const mutations = [
    (f) => {
      f.run.configuration = undefined;
    },
    (f) => {
      f.run.configuration.executionMode = "standard";
    },
    (f) => {
      f.events[0].runId = "foreign";
    },
    (f) => {
      f.events[0].payload.configurationSha256 = sha256("wrong");
    },
    (f) => {
      f.events.pop();
    },
    (f) => {
      f.events.push(f.events[1]);
    },
    (f) => {
      f.events[1].runId = "foreign";
    },
    (f) => {
      f.events[1].payload.sandboxId = "host-direct";
    },
    (f) => {
      f.events[1].payload.activeToolNames.push("run_command");
    },
  ];
  for (const mutate of mutations) {
    const f = fixture("environment_degraded_read_only");
    mutate(f);
    const evidence = collect(f);
    assert.equal(evidence.valid, false);
    assert.equal(environmentEvidenceEligible(report(evidence)), false);
  }
  const mixed = fixture();
  mixed.events.push(fixture("environment_degraded_read_only").events[1]);
  assert.equal(collect(mixed).valid, false);
  const noStart = fixture();
  noStart.events = [];
  assert.equal(collect(noStart).valid, false);
});

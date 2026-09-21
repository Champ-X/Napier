import { afterEach, expect, it } from "vitest";
import { emptyUsage } from "@napier/contracts";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { RunBudgetTracker } from "../src/run-budget.js";
import { createUsageAccounting } from "../src/token-accounting.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import {
  createHarnessPolicyProfile,
  presetHarnessPolicy,
} from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { projectTaskRequirementRevisions } from "../src/task-requirement-revisions.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);
const limits = {
  maxTurns: 64,
  maxTotalTokens: 250000,
  maxCostUsd: 3,
  timeoutMs: 1800000,
};

it("reserves uncached request capacity without counting cached usage twice or increasing hard budgets", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  const usage = {
    ...emptyUsage(),
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 23000,
  };
  const accounting = createUsageAccounting(
    { provider: "deepseek", id: "deepseek-v4-flash" },
    usage,
  );
  budget.observePrimaryUsage(usage, 1100, accounting);
  budget.observeAuxiliaryUsage(
    { ...emptyUsage(), inputTokens: 190000 - accounting.budgetTokens },
    1200,
  );
  expect(budget.finalizationReserveBeforeNextPrimaryTurn(1300)).toBeUndefined();
  const reserve = budget.finalizationReserveBeforeNextPrimaryTurn(1300, true)!;
  expect(reserve.reasons).toEqual(["tokens"]);
  expect(reserve.reservedTokens).toBe(75000);
  expect(reserve.observed.totalTokens).toBe(190000);
  expect(reserve.requestForecast).toEqual({
    strategy: "request-aware-v1",
    sampleCount: 1,
    uncachedCallTokens: 25000,
    callsReserved: 3,
  });
  budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 60001 }, 1400);
  expect(budget.exhaustion?.reason).toBe("tokens");
  expect(() => budget.assertCanStartPrimaryTurn(1500)).toThrow(
    "budget exhausted",
  );
});

it("enters before the next ordinary request would consume the three-call finishing allowance", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 163000 }, 1100);
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 20000 }, 1200);
  expect(budget.finalizationReserveBeforeNextPrimaryTurn(1300)).toBeUndefined();
  const reserve = budget.finalizationReserveBeforeNextPrimaryTurn(1300, true)!;
  expect(reserve.reasons).toEqual(["tokens"]);
  expect(reserve.reservedTokens).toBe(60000);
  expect(
    limits.maxTotalTokens - reserve.observed.totalTokens,
  ).toBeGreaterThanOrEqual(reserve.reservedTokens);
  for (let index = 0; index < 3; index++) {
    budget.assertCanStartPrimaryTurn(1400 + index);
    budget.observePrimaryUsage(
      { ...emptyUsage(), inputTokens: 20000 },
      1400 + index,
    );
  }
  expect(budget.exhaustion).toBeUndefined();
  expect(budget.limits).toEqual(limits);
});

it("bounds recent samples and retains legacy behavior when there is no primary request estimate", () => {
  const budget = new RunBudgetTracker(limits, 1000);
  budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 180000 }, 1100);
  expect(
    budget.finalizationReserveBeforeNextPrimaryTurn(1200, true),
  ).toBeUndefined();
  budget.observePrimaryUsage({ ...emptyUsage(), inputTokens: 22000 }, 1300);
  expect(
    budget.finalizationReserveBeforeNextPrimaryTurn(1400, true)?.reservedTokens,
  ).toBe(66000);
  for (let index = 0; index < 3; index++)
    budget.observePrimaryUsage(
      { ...emptyUsage(), inputTokens: 1000 },
      1500 + index,
    );
  expect(
    budget.finalizationReserveBeforeNextPrimaryTurn(1600, true),
  ).toBeUndefined();
  expect(budget.limits).toEqual(limits);
});

it("binds request-aware finalization as an explicit policy without changing existing presets", () => {
  const {
    contentSha256: _hash,
    schemaVersion: _version,
    ...base
  } = presetHarnessPolicy("coding-python.v1");
  expect(base.context.finalization).toBeUndefined();
  const policy = createHarnessPolicyProfile({
    ...base,
    context: { ...base.context, finalization: "request-aware-v1" },
  });
  expect(policy.contentSha256).not.toBe(_hash);
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: { ...base.context, finalization: "unknown" as never },
    }),
  ).toThrow("Invalid Harness");
});

it.each(["request-aware-v1", "request-aware-v2"] as const)("delivers late steering and follow-up requirements during %s finalization and keeps hints out of user revisions", async (finalization) => {
  const f = await createFixture("finalizer-steering");
  try {
    await f.store.updateAgent(f.agentId, {
      enabledTools: ["read_file"],
      enabledSkills: [],
      runLimits: { ...limits, maxTurns: 7 },
    });
    const provider = fauxProvider({ provider: "finalizer-steering" });
    const reads = Array.from({ length: 1 }, () =>
      fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
    );
    provider.setResponses([
      ...reads,
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "LATEST_REQUIREMENT_ALPHA",
        );
        expect(JSON.stringify(context.messages)).toContain(
          finalization === "request-aware-v2" ? "napier.run-budget-context" : "Internal finalization reserve",
        );
        return fauxAssistantMessage(
          "The file is missing. LATEST_REQUIREMENT_ALPHA acknowledged.",
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "LATEST_REQUIREMENT_BETA",
        );
        return fauxAssistantMessage(
          "LATEST_REQUIREMENT_BETA acknowledged; the file remains missing.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(f.store, models);
    const {
      contentSha256: _hash,
      schemaVersion: _version,
      ...base
    } = presetHarnessPolicy("coding-node.v1");
    const profile = createModelHarnessExperimentProfile({
      id: "finalizer-steering.v1",
      maxActiveTools: 16,
      policies: createHarnessPolicyProfile({
        ...base,
        context: { ...base.context, delivery: "tail-v1", finalization },
      }),
    });
    let queued = false;
    const run = await runtime.runPrompt({
      threadId: f.threadId,
      text: "Inspect the missing file and report honestly.",
      model: { provider: "finalizer-steering", id: "faux-1" },
      harnessExperimentProfile: profile,
      onEvent: async (e) => {
        if (e.type !== "run.finalization.reserved" || queued) return;
        queued = true;
        await f.store.queueRunControlMessage({
          threadId: f.threadId,
          runId: e.runId!,
          mode: "steering",
          text: "LATEST_REQUIREMENT_ALPHA: preserve the missing file; do not create it.",
        });
        await f.store.queueRunControlMessage({
          threadId: f.threadId,
          runId: e.runId!,
          mode: "follow_up",
          text: "LATEST_REQUIREMENT_BETA: explicitly state that no file was changed.",
        });
      },
    });
    expect(run.status, run.error).toBe("completed");
    const events = await f.store.listRunEvents(run.id);
    expect(
      events.filter((e) => e.type === "run.control.delivered"),
    ).toHaveLength(2);
    expect(
      events.filter((e) => e.type === "run.finalization.reserved"),
    ).toHaveLength(1);
    const requirements = projectTaskRequirementRevisions(events);
    expect(requirements.instructionRevision).toBe(3);
    expect(
      requirements.requirements.some((item) =>
        item.text.includes("Internal finalization reserve"),
      ),
    ).toBe(false);
  } finally {
    await f.store.close();
  }
});

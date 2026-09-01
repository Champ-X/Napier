import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { compareRunHarnessEffects } from "../src/run-harness-comparison.js";
import { projectRunHarnessEffectMetrics } from "../src/run-harness-effect-metrics.js";

describe("Run Harness effect metrics", () => {
  it("projects actions, duplicate work, token shares, interventions, and task outcome", () => {
    const run = fixtureRun("run_left");
    const events = [
      event(run, 1, "message.user", { role: "user", text: "Fix the bug" }),
      event(
        run,
        2,
        "tool.started",
        toolStart("read-1", "read_file", "read", "a"),
        100,
      ),
      event(
        run,
        3,
        "tool.completed",
        toolEnd("read-1", "read_file", "result-a"),
        150,
      ),
      event(
        run,
        4,
        "tool.started",
        toolStart("read-2", "read_file", "read", "a"),
        200,
      ),
      event(
        run,
        5,
        "tool.completed",
        toolEnd("read-2", "read_file", "result-a"),
        250,
      ),
      event(
        run,
        6,
        "tool.started",
        toolStart("write-1", "apply_patch", "write", "b"),
        300,
      ),
      event(
        run,
        7,
        "tool.completed",
        toolEnd("write-1", "apply_patch", "result-b"),
        350,
      ),
      event(
        run,
        8,
        "tool.started",
        toolStart("verify-1", "verify_workspace", "verify", "c"),
        400,
      ),
      event(
        run,
        9,
        "tool.completed",
        toolEnd("verify-1", "verify_workspace", "result-c"),
        450,
      ),
      tokenPressure(run, 10),
      event(run, 11, "operator.decision.requested", {
        decisionId: "decision_12345678",
      }),
      event(run, 12, "goal.evaluated", {
        satisfied: true,
        status: "completed",
      }),
    ];

    const metrics = project(run, events);

    expect(metrics.firstAction).toEqual({
      read: { status: "available", elapsedMs: 100, eventSeq: 2 },
      write: { status: "available", elapsedMs: 300, eventSeq: 6 },
      verify: { status: "available", elapsedMs: 400, eventSeq: 8 },
    });
    expect(metrics.toolEfficiency).toEqual(
      expect.objectContaining({
        startedCount: 4,
        classifiedActionCount: 4,
        hashedCallCount: 4,
        repeatedCallCount: 1,
        repeatedCallRate: 0.25,
        noNewInformationEligibleCount: 4,
        noNewInformationCount: 1,
        noNewInformationRate: 0.25,
      }),
    );
    expect(metrics.contextTokens).toEqual(
      expect.objectContaining({
        status: "available",
        observationCount: 1,
        systemPromptTokenShare: 0.1,
        toolDefinitionTokenShare: 0.2,
      }),
    );
    expect(metrics.interventions).toEqual(
      expect.objectContaining({
        count: 1,
        reasonCounts: { operator_decision: 1 },
      }),
    );
    expect(metrics.taskOutcome).toEqual({
      status: "passed",
      evidenceType: "goal.evaluated",
      eventSeq: 12,
    });
    expect(metrics.taskInputSha256).toBe(sha256("Fix the bug"));
    expect(metrics.harnessResolution).toEqual({
      status: "unavailable",
      observationCount: 0,
      validReceiptCount: 0,
      distinctReceiptCount: 0,
    });
    expect(metrics.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("binds valid v2 Harness receipts into an ordered distinct experiment hash", () => {
    const run = fixtureRun("run_harness_resolution");
    const first = harnessReceipt("coding-a");
    const second = harnessReceipt("coding-b");
    const metrics = project(run, [
      event(run, 1, "model.harness.resolved", first),
      event(run, 2, "model.harness.resolved", first),
      event(run, 3, "model.harness.resolved", second),
    ]);

    expect(metrics.harnessResolution).toEqual({
      status: "available",
      observationCount: 3,
      validReceiptCount: 3,
      distinctReceiptCount: 2,
      firstReceiptSha256: first.contentSha256,
      lastReceiptSha256: second.contentSha256,
      resolutionSequenceSha256: sha256(
        canonicalJson([first.contentSha256, second.contentSha256]),
      ),
    });
  });

  it("fails Harness experiment evidence closed when any receipt is legacy or damaged", () => {
    const run = fixtureRun("run_harness_invalid");
    const valid = harnessReceipt("valid");
    const damaged = {
      ...harnessReceipt("damaged"),
      guidanceSha256: sha256("drift"),
    };
    const metrics = project(run, [
      event(run, 1, "model.harness.resolved", valid),
      event(run, 2, "model.harness.resolved", damaged),
    ]);

    expect(metrics.harnessResolution).toEqual({
      status: "unavailable",
      observationCount: 2,
      validReceiptCount: 1,
      distinctReceiptCount: 1,
    });
  });

  it("fails closed for legacy or damaged evidence and rejects source drift", () => {
    const run = fixtureRun("run_legacy");
    const events = [
      event(run, 1, "message.user", { role: "user", text: "Inspect" }),
      event(run, 2, "tool.started", {
        callId: "legacy",
        toolName: "read_file",
        status: "started",
      }),
      event(run, 3, "tool.completed", {
        callId: "legacy",
        toolName: "read_file",
        status: "completed",
      }),
      event(run, 4, "model.context.token_pressure", {
        ...tokenPressurePayload(),
        activeEstimatedTotalTokens: 999,
      }),
    ];
    const metrics = project(run, events);

    expect(metrics.firstAction.read.status).toBe("unavailable");
    expect(metrics.toolEfficiency).toEqual(
      expect.objectContaining({
        hashedCallCount: 0,
        repeatedCallRate: null,
        noNewInformationEligibleCount: 0,
        noNewInformationRate: null,
      }),
    );
    expect(metrics.contextTokens.status).toBe("unavailable");
    expect(metrics.taskOutcome.status).toBe("unavailable");
    expect(() =>
      projectRunHarnessEffectMetrics(run, events, sha256("wrong")),
    ).toThrow("source binding is invalid");
  });

  it("requires complete overflow recovery bindings", () => {
    const run = fixtureRun("run_overflow");
    const before = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: "system",
      messages: [{ role: "user", content: "old" }],
      tools: [{ name: "read_file" }],
    });
    const after = createModelContextEnvelopeReceipt({
      turnIndex: 1,
      systemPrompt: "system",
      messages: [{ role: "user", content: "latest" }],
      tools: [{ name: "read_file" }],
    });
    const pressure = hashed({
      ...tokenPressurePayload(),
      recoveryAttempt: 1,
      systemPromptSha256: after.systemPromptSha256,
      toolDefinitionSetSha256: after.toolDefinitionSetSha256,
      activeMessageSetSha256: after.messageSetSha256,
    });
    const events = [
      event(run, 1, "context.model_envelope", before),
      event(
        run,
        2,
        "model.context.overflow",
        hashed({
          kind: "napier.model-context-overflow",
          schemaVersion: 1,
          action: "retry",
          provider: "openai",
          model: "gpt-test",
          diagnosticSha256: sha256("overflow"),
          modelContextEnvelopeSha256: before.contentSha256,
          modelContextEnvelopeTurnIndex: before.turnIndex,
          modelContextMessageSetSha256: before.messageSetSha256,
          modelContextToolDefinitionSetSha256: before.toolDefinitionSetSha256,
        }),
      ),
      event(run, 3, "model.context.token_pressure", pressure),
      event(run, 4, "context.model_envelope", after),
      event(run, 5, "model.response", {
        stopReason: "stop",
        modelContextEnvelopeSha256: after.contentSha256,
        modelContextEnvelopeTurnIndex: after.turnIndex,
        modelContextMessageSetSha256: after.messageSetSha256,
        modelContextToolDefinitionSetSha256: after.toolDefinitionSetSha256,
      }),
    ];

    expect(project(run, events).overflow).toEqual({
      attemptCount: 1,
      recoveredCount: 1,
      failedCount: 0,
      unavailableCount: 0,
    });
    expect(project(run, events.slice(0, -1)).overflow.unavailableCount).toBe(1);
  });

  it("aggregates stable intervention reason codes without decision text", () => {
    const run = fixtureRun("run_interventions");
    const events = [
      event(run, 1, "operator.decision.requested", {
        question: "private question",
      }),
      event(run, 2, "browser.interaction_confirmation.pending", {
        status: "pending",
      }),
      event(run, 3, "workflow.approval.requested", { status: "pending" }),
      event(run, 4, "tool.blocked", {
        harnessInterventionReason: "approval_block",
      }),
      event(run, 5, "tool.blocked", {
        harnessInterventionReason: "capability_block",
      }),
      event(run, 6, "tool.blocked", {
        harnessInterventionReason: "safety_block",
      }),
      event(run, 7, "tool.blocked", {
        harnessInterventionReason: "budget_pause",
      }),
      event(run, 8, "run.recovery.started", { mode: "manual" }),
      event(run, 9, "tool.blocked", {
        harnessInterventionReason: "capability_use_required",
      }),
      event(run, 10, "tool.blocked", {
        harnessInterventionReason: "capability_discovery_required",
      }),
      event(run, 11, "model.response", {
        responseDisposition: "capability_recovery_required",
      }),
    ];

    const interventions = project(run, events).interventions;
    expect(interventions.count).toBe(11);
    expect(interventions.reasonCounts).toEqual({
      approval_block: 1,
      browser_confirmation: 1,
      budget_pause: 1,
      capability_block: 1,
      capability_discovery_required: 1,
      capability_recovery: 1,
      capability_use_required: 1,
      manual_recovery: 1,
      operator_decision: 1,
      safety_block: 1,
      workflow_approval: 1,
    });
    expect(JSON.stringify(interventions)).not.toContain("private question");
  });
});

describe("Harness comparison fairness", () => {
  it("compares provider, model, task, environment, and budget without treating Harness drift as environment drift", () => {
    const leftRun = fixtureRun("run_a");
    const rightRun = fixtureRun("run_b");
    rightRun.configuration = {
      ...rightRun.configuration!,
      enabledTools: ["read_file", "verify_workspace"],
      systemPromptSha256: sha256("variant"),
      contentSha256: sha256("variant-config"),
    };
    const left = project(leftRun, [
      event(leftRun, 1, "message.user", { role: "user", text: "Same task" }),
      event(leftRun, 2, "model.harness.resolved", harnessReceipt("left")),
    ]);
    const right = project(rightRun, [
      event(rightRun, 1, "message.user", { role: "user", text: "Same task" }),
      event(rightRun, 2, "model.harness.resolved", harnessReceipt("right")),
    ]);
    const comparison = compareRunHarnessEffects(leftRun, left, rightRun, right);

    expect(comparison.fairness.status).toBe("comparable");
    expect(comparison.fairness.diagnostics).toEqual([]);
    expect(comparison.harnessResolution).toEqual({
      status: "mismatched",
      leftSha256: left.harnessResolution.resolutionSequenceSha256,
      rightSha256: right.harnessResolution.resolutionSequenceSha256,
    });

    const drifted = structuredClone(rightRun);
    drifted.configuration!.model.id = "gpt-other";
    const mismatch = compareRunHarnessEffects(leftRun, left, drifted, right);
    expect(mismatch.fairness.status).toBe("not_comparable");
    expect(mismatch.fairness.model.status).toBe("mismatched");
  });

  it("reports insufficient evidence when historical Runs lack configuration", () => {
    const leftRun = fixtureRun("run_old_a");
    const rightRun = fixtureRun("run_old_b");
    delete leftRun.configuration;
    delete rightRun.configuration;
    const left = project(leftRun, []);
    const right = project(rightRun, []);

    const fairness = compareRunHarnessEffects(
      leftRun,
      left,
      rightRun,
      right,
    ).fairness;
    expect(fairness.status).toBe("insufficient_evidence");
    expect(fairness.provider.status).toBe("unavailable");
    expect(fairness.task.status).toBe("unavailable");
  });

  it.each([
    [
      "provider",
      (run: RunRecord) => {
        run.configuration!.model.provider = "other";
      },
    ],
    [
      "model",
      (run: RunRecord) => {
        run.configuration!.model.id = "other";
      },
    ],
    ["task", (_run: RunRecord) => undefined],
    [
      "environment",
      (run: RunRecord) => {
        run.releaseIdentitySha256 = sha256("other release");
      },
    ],
    [
      "budget",
      (run: RunRecord) => {
        run.limits!.maxTotalTokens *= 2;
      },
    ],
  ] as const)("fails fairness when %s drifts", (dimension, mutate) => {
    const leftRun = fixtureRun(`run_${dimension}_left`);
    const rightRun = fixtureRun(`run_${dimension}_right`);
    mutate(rightRun);
    const leftText = "Same task";
    const rightText = dimension === "task" ? "Different task" : leftText;
    const left = project(leftRun, [
      event(leftRun, 1, "message.user", { role: "user", text: leftText }),
    ]);
    const right = project(rightRun, [
      event(rightRun, 1, "message.user", { role: "user", text: rightText }),
    ]);

    const fairness = compareRunHarnessEffects(
      leftRun,
      left,
      rightRun,
      right,
    ).fairness;
    expect(fairness.status).toBe("not_comparable");
    expect(fairness[dimension].status).toBe("mismatched");
  });
});

function fixtureRun(id: string): RunRecord {
  const limits = {
    maxTurns: 10,
    maxTotalTokens: 10_000,
    maxCostUsd: 1,
    timeoutMs: 60_000,
  };
  return {
    id,
    threadId: "thread_same",
    agentId: "agent_default",
    status: "completed",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:00:01.000Z",
    releaseIdentitySha256: sha256("release"),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    limits,
    configuration: {
      schemaVersion: 2,
      agentRevision: 1,
      model: { provider: "openai", id: "gpt-test" },
      thinkingLevel: "medium",
      toolPolicy: "workspace",
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
      subagentLimits: {
        maxConcurrent: 1,
        maxTotal: 1,
        maxTurns: 1,
        timeoutMs: 60_000,
      },
      runLimits: limits,
      systemPromptSha256: sha256("system"),
      automaticRecovery: { mode: "manual", maxAttempts: 1, backoffMs: 1_000 },
      executionMode: "standard",
      contentSha256: sha256("configuration"),
    },
  };
}

function event(
  run: RunRecord,
  seq: number,
  type: string,
  payload: JsonValue,
  elapsedMs = seq,
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: run.threadId,
    runId: run.id,
    seq,
    type,
    category: type.startsWith("tool.") ? "tool" : "system",
    visibility: "debug",
    payload,
    createdAt: new Date(Date.parse(run.startedAt) + elapsedMs).toISOString(),
  };
}

function toolStart(
  callId: string,
  toolName: string,
  harnessAction: string,
  input: string,
): JsonValue {
  return {
    callId,
    toolName,
    status: "started",
    harnessAction,
    callInputSha256: sha256(input),
  };
}

function toolEnd(callId: string, toolName: string, output: string): JsonValue {
  return {
    callId,
    toolName,
    status: "completed",
    outputTextSha256: sha256(output),
    outputTextBytes: Buffer.byteLength(output),
  };
}

function tokenPressure(run: RunRecord, seq: number): RunEvent {
  return event(
    run,
    seq,
    "model.context.token_pressure",
    hashed(tokenPressurePayload()),
  );
}

function tokenPressurePayload() {
  return {
    kind: "napier.model-context-token-pressure",
    schemaVersion: 1,
    status: "within_budget",
    provider: "openai",
    model: "gpt-test",
    modelAttempt: 1,
    recoveryAttempt: 0,
    meterVersion: "v1",
    estimateMethod: "test",
    calibrationId: "test",
    calibrationBytesPerTokenMilli: 3_000,
    contextWindowTokens: 1_000,
    systemPromptEstimatedTokens: 10,
    toolDefinitionEstimatedTokens: 20,
    originalMessageEstimatedTokens: 30,
    activeMessageEstimatedTokens: 30,
    outputReserveTokens: 20,
    reasoningReserveTokens: 10,
    safetyReserveTokens: 10,
    originalEstimatedTotalTokens: 100,
    activeEstimatedTotalTokens: 100,
    originalMessageCount: 1,
    activeMessageCount: 1,
    removedMessageCount: 0,
    removedUnitCount: 0,
    protectedSuffixMessageCount: 1,
    systemPromptSha256: sha256("system"),
    toolDefinitionSetSha256: sha256("tools"),
    originalMessageSetSha256: sha256("messages"),
    activeMessageSetSha256: sha256("messages"),
    projection: "none",
  };
}

function harnessReceipt(guidance: string) {
  return hashed({
    kind: "napier.model-harness-resolution",
    schemaVersion: 2,
    harnessId: "napier.model-harness-resolution.rules-v1.v2",
    baseHarnessId: "napier.model-harness.openai.v1",
    ruleSetVersion: "napier.model-harness-rules.v1",
    matchedRuleId: "openai-reasoning",
    policySource: "model_rule",
    family: "openai",
    promptDialect: "instruction-led",
    provider: "openai",
    model: "gpt-5",
    modelApi: "openai-responses",
    attempt: 1,
    intents: ["coding"],
    taskPhase: "coding",
    environmentCapabilities: ["workspace_write", "process"],
    guidanceSha256: sha256(guidance),
    toolSurface: "full",
    configuredToolCount: 2,
    activeToolCount: 2,
    activeToolNames: ["apply_patch", "run_command"],
    omittedToolNames: [],
    configuredToolDefinitionBytes: 200,
    activeToolDefinitionBytes: 200,
    savedToolDefinitionBytes: 0,
    maxRetries: 1,
    maxRetriesSource: "harness",
    maxRetryDelayMs: 30_000,
    maxRetryDelayMsSource: "harness",
  });
}

function hashed<T extends Record<string, unknown>>(
  value: T,
): T & { contentSha256: string } {
  return { ...value, contentSha256: sha256(canonicalJson(value)) };
}

function project(run: RunRecord, events: RunEvent[]) {
  return projectRunHarnessEffectMetrics(
    run,
    events,
    sha256(events.map((item) => JSON.stringify(item)).join("\n")),
  );
}

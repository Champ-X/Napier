import type { JsonValue, RunEvent, SubagentTask } from "@napier/contracts";
import type {
  AgentHarnessAcceptanceEvidenceContent,
  HarnessLedgerRunEvidence,
  HarnessRouteFailureClass,
} from "@napier/contracts/agent-harness-acceptance";
import { describe, expect, it } from "vitest";

import {
  createAgentHarnessAcceptanceEvidence,
  createHarnessLedgerRunEvidence,
  createSubagentRestartSnapshot,
  validateAgentHarnessAcceptanceEvidence,
} from "../src/agent-harness-acceptance.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

describe("Agent Harness acceptance evidence", () => {
  it("recomputes every quantitative threshold from hash-bound Ledger snapshots", () => {
    const evidence = createAgentHarnessAcceptanceEvidence(content());

    expect(evidence.acceptanceReady).toBe(true);
    expect(evidence.blockers).toEqual([]);
    expect(evidence.summary).toEqual(
      expect.objectContaining({
        routeRecoverySampleCount: 100,
        routeRecoveryRate: 1,
        visibleOutputCrossModelContinuationCount: 0,
        unknownSideEffectReplayCount: 0,
        routeAttributionRate: 1,
        capabilityUnreachableRate: 0,
        repeatedCallReduction: 0.5,
        noNewInformationReduction: 0.5,
        codeBridgeGovernanceCoverage: 1,
        privilegeExpansionCount: 0,
        subagentDurableTerminalRate: 1,
        steeringBoundarySuccessRate: 1,
        cancellationBoundarySuccessRate: 1,
        conservativeTokenFallbackVerified: true,
      }),
    );
    expect(evidence.summary.tokenModelP95).toEqual([
      {
        provider: "deepseek",
        id: "deepseek-v4-flash",
        sampleCount: 20,
        p95UnderestimateRatio: 0,
      },
    ]);
    expect(validateAgentHarnessAcceptanceEvidence(evidence)).toEqual(evidence);
  });

  it("fails closed when independently derived samples cross the thresholds", () => {
    const evidence = createAgentHarnessAcceptanceEvidence(content(true));

    expect(evidence.acceptanceReady).toBe(false);
    expect(evidence.blockers).toEqual(
      expect.arrayContaining([
        "route_recovery_below_95_percent",
        "capability_unreachable_rate_not_below_1_percent",
        "repeated_call_reduction_below_20_percent",
        "no_new_information_reduction_below_20_percent",
        "code_bridge_governance_incomplete",
        "code_bridge_privilege_expansion",
        "subagent_durable_terminal_incomplete",
        "token_p95_underestimate_not_below_10_percent:deepseek/deepseek-v4-flash",
      ]),
    );
  });

  it("rejects event and top-level projection tampering", () => {
    const evidence = createAgentHarnessAcceptanceEvidence(content());
    const eventTampered = structuredClone(evidence);
    eventTampered.ledgerRuns[0]!.events[0]!.payload = { outcome: "success" };
    expect(() => validateAgentHarnessAcceptanceEvidence(eventTampered)).toThrow(
      "Ledger event is invalid",
    );
    expect(() =>
      validateAgentHarnessAcceptanceEvidence({
        ...evidence,
        acceptanceReady: false,
      }),
    ).toThrow("hash is invalid");
  });
});

function content(degraded = false): AgentHarnessAcceptanceEvidenceContent {
  const runs: HarnessLedgerRunEvidence[] = [];
  const add = (run: HarnessLedgerRunEvidence) => {
    runs.push(run);
    return run.contentSha256;
  };
  const failureClasses: HarnessRouteFailureClass[] = [
    "rate_limited",
    "provider_server",
    "network",
  ];
  const routeCases = Array.from({ length: 100 }, (_, index) => {
    const failureClass = failureClasses[index % failureClasses.length]!;
    return {
      id: `route_${index}`,
      failureClass,
      scenario: "recoverable" as const,
      runEvidenceSha256: add(
        routeRun(`route_${index}`, failureClass, !degraded || index >= 6),
      ),
    };
  });
  routeCases.push(
    {
      id: "route_visible_barrier",
      failureClass: "network",
      scenario: "visible_output",
      runEvidenceSha256: add(barrierRun("visible", "visible_output")),
    },
    {
      id: "route_side_effect_barrier",
      failureClass: "network",
      scenario: "unknown_side_effect",
      runEvidenceSha256: add(barrierRun("side_effect", "unknown_side_effect")),
    },
  );
  const capabilityReachabilityCases = Array.from(
    { length: 100 },
    (_, index) => {
      const targetToolId = `target_tool_${index}`;
      return {
        id: `capability_${index}`,
        targetToolId,
        runEvidenceSha256: add(
          capabilityRun(
            `capability_${index}`,
            targetToolId,
            !degraded || index !== 0,
          ),
        ),
      };
    },
  );
  const loopPairs = Array.from({ length: 30 }, (_, index) => ({
    id: `loop_${index}`,
    baselineRunEvidenceSha256: add(loopRun(`loop_base_${index}`, 5)),
    candidateRunEvidenceSha256: add(
      loopRun(`loop_candidate_${index}`, degraded ? 5 : 3),
    ),
  }));
  const codeBridgeCalls = Array.from({ length: 100 }, (_, index) => {
    const callId = `codebridge_case_${index}`;
    return {
      id: `bridge_${index}`,
      callId,
      runEvidenceSha256: add(
        bridgeRun(`bridge_${index}`, callId, !degraded || index !== 0),
      ),
    };
  });
  const probeClasses = [
    "workspace_escape",
    "inactive_capability",
    "unknown_effect",
  ] as const;
  const codeBridgePrivilegeProbes = probeClasses.map((probeClass, index) => {
    const callId = `codebridge_probe_${index}`;
    return {
      id: `probe_${index}`,
      probeClass,
      callId,
      runEvidenceSha256: add(
        privilegeProbeRun(
          `probe_${index}`,
          callId,
          probeClass,
          !degraded || index !== 0,
        ),
      ),
    };
  });
  const subagentTasks = Array.from({ length: 30 }, (_, index) => {
    const task = terminalTask(`task_${index}`);
    const terminalEventId = `event_subagent_${index}_1`;
    return {
      taskId: task.id,
      terminalEventId:
        degraded && index === 0 ? "event_missing" : terminalEventId,
      runEvidenceSha256: add(
        run(`subagent_${index}`, [
          event("subagent.completed", { taskId: task.id, status: "completed" }),
        ]),
      ),
      restartSnapshot: createSubagentRestartSnapshot(task),
    };
  });
  const steeringTaskId = "task_steered";
  const steeringMessageId = "message_steered";
  const steeringBoundaryChecks = [
    {
      taskId: steeringTaskId,
      messageId: steeringMessageId,
      runEvidenceSha256: add(
        run("steering", [
          event("subagent.message.accepted", {
            taskId: steeringTaskId,
            id: steeringMessageId,
          }),
          event("subagent.message.delivered", {
            taskId: steeringTaskId,
            messageId: steeringMessageId,
          }),
          event("subagent.completed", {
            taskId: steeringTaskId,
            status: "completed",
          }),
        ]),
      ),
    },
  ];
  const cancellationTaskId = "task_cancelled";
  const cancellationBoundaryChecks = [
    {
      taskId: cancellationTaskId,
      requestEventId: "event_cancellation_1",
      terminalEventId: "event_cancellation_2",
      runEvidenceSha256: add(
        run("cancellation", [
          event("subagent.cancel.requested", { taskId: cancellationTaskId }),
          event("subagent.cancelled", { taskId: cancellationTaskId }),
        ]),
      ),
    },
  ];
  const tokenCalibrationObservations = Array.from(
    { length: 20 },
    (_, index) => {
      const payload = calibrationPayload(degraded && index >= 18 ? 90 : 100);
      const calibrationEventId = `event_token_${index}_1`;
      return {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        contentClass: "text" as const,
        calibrationEventId,
        runEvidenceSha256: add(
          run(`token_${index}`, [
            event("model.context.token_calibration", payload),
          ]),
        ),
      };
    },
  );
  const fallbackEventId = "event_token_fallback_1";
  const conservativeTokenFallbackProbe = {
    eventId: fallbackEventId,
    runEvidenceSha256: add(
      run("token_fallback", [
        event("model.context.token_pressure", {
          meterProviderId: "napier.conservative-heuristic",
          fallbackApplied: true,
          activeBaseEstimatedInputTokens: 120,
        }),
      ]),
    ),
  };

  return {
    kind: "napier.agent-harness-acceptance-evidence",
    schemaVersion: 1,
    generatedAt: "2026-08-22T00:00:00.000Z",
    productVersion: "0.1.3",
    sourceManifestSha256: "a".repeat(64),
    harnessExperimentEvidenceSha256: "b".repeat(64),
    primaryModels: [{ provider: "deepseek", id: "deepseek-v4-flash" }],
    ledgerRuns: runs,
    routeCases,
    capabilityReachabilityCases,
    loopPairs,
    codeBridgeCalls,
    codeBridgePrivilegeProbes,
    subagentTasks,
    steeringBoundaryChecks,
    cancellationBoundaryChecks,
    tokenCalibrationObservations,
    conservativeTokenFallbackProbe,
  };
}

function routeRun(
  id: string,
  failureClass: HarnessRouteFailureClass,
  recovered: boolean,
) {
  const attempts = [
    event("route_attempt_ended", {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      failureClass,
      outcome: "retryable",
      visibleOutputProduced: false,
      sideEffectState: "none",
    }),
  ];
  if (recovered)
    attempts.push(
      event("route_attempt_ended", {
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        outcome: "success",
      }),
    );
  attempts.push(
    event("model.response", { model: "deepseek/deepseek-v4-flash" }),
  );
  return run(id, attempts);
}

function barrierRun(
  id: string,
  scenario: "visible_output" | "unknown_side_effect",
) {
  return run(id, [
    event("route_attempt_ended", {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      outcome: "blocked",
      visibleOutputProduced: scenario === "visible_output",
      sideEffectState: scenario === "unknown_side_effect" ? "unknown" : "none",
    }),
  ]);
}

function capabilityRun(id: string, toolId: string, reached: boolean) {
  const observed = reached ? toolId : `other_${toolId}`;
  return run(id, [
    event("model.harness.resolved", { omittedToolNames: [toolId] }),
    event("tool.completed", {
      toolName: "capability",
      details: { descriptors: [{ toolId: observed }] },
    }),
    event("model.harness.resolved", { activeToolNames: [observed] }),
  ]);
}

function loopRun(id: string, count: number) {
  return run(
    id,
    Array.from({ length: count }, (_, index) => {
      const callId = `loop_call_${String(index)}`;
      return [
        event("tool.started", {
          callId,
          callInputSha256: "c".repeat(64),
        }),
        event("tool.completed", {
          callId,
          resultSha256: "d".repeat(64),
        }),
      ];
    }).flat(),
  );
}

function bridgeRun(id: string, callId: string, governed: boolean) {
  const inputSha256 = "e".repeat(64);
  const toolVersionSha256 = "f".repeat(64);
  const capsuleSha256 = "a".repeat(64);
  const events = [
    event("context.tool_invocation", {
      callId,
      argumentsSha256: inputSha256,
      toolDefinitionSha256: toolVersionSha256,
      capsuleSha256,
    }),
    event("tool.started", { callId, nestedDispatch: true, inputSha256 }),
    event("context.tool_result", {
      callId,
      invocationCapsuleSha256: capsuleSha256,
    }),
    event("tool.completed", { callId, nestedDispatch: true }),
  ];
  if (governed)
    events.splice(
      1,
      0,
      event("code_bridge.authorized", {
        callId,
        inputSha256,
        toolVersionSha256,
        validationChecked: true,
        policyChecked: true,
        workspaceBoundaryChecked: true,
        budgetChecked: true,
        sandboxDelegated: true,
      }),
    );
  return run(id, events);
}

function privilegeProbeRun(
  id: string,
  callId: string,
  probeClass: "workspace_escape" | "inactive_capability" | "unknown_effect",
  blocked: boolean,
) {
  const reason = {
    workspace_escape: "path escapes the configured workspace",
    inactive_capability: "capability is not active for this step",
    unknown_effect: "requires an approval checkpoint outside the code session",
  }[probeClass];
  return run(id, [
    event(blocked ? "tool.blocked" : "tool.started", {
      callId,
      policyReason: reason,
      harnessInterventionReason:
        probeClass === "unknown_effect" ? "approval_block" : "policy_block",
    }),
  ]);
}

function terminalTask(id: string): SubagentTask {
  return {
    id,
    threadId: `thread_${id}`,
    runId: `run_${id}`,
    role: "worker",
    description: "Acceptance task",
    prompt: "Produce terminal evidence",
    status: "completed",
    result: "done",
    stopReason: "completed",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    supervisorStatus: "completed",
    stepCount: 1,
    turnCount: 1,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    createdAt: "2026-08-22T00:00:00.000Z",
    startedAt: "2026-08-22T00:00:01.000Z",
    finishedAt: "2026-08-22T00:00:02.000Z",
    revision: 3,
  };
}

function calibrationPayload(estimatedInputTokens: number) {
  const content = {
    status: "calibrated",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    contentClass: "text",
    estimatedInputTokens,
    actualInputTokens: 100,
    underestimateRatio: (100 - estimatedInputTokens) / 100,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function event(type: string, payload: Record<string, JsonValue>) {
  return { type, payload };
}

function run(
  label: string,
  values: Array<{ type: string; payload: Record<string, JsonValue> }>,
): HarnessLedgerRunEvidence {
  const threadId = `thread_${label}`;
  const runId = `run_${label}`;
  const events: RunEvent[] = values.map((value, index) => ({
    id: `event_${label}_${index + 1}`,
    threadId,
    runId,
    seq: index + 1,
    type: value.type,
    category: category(value.type),
    visibility: "debug",
    createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
    payload: value.payload,
  }));
  return createHarnessLedgerRunEvidence(
    { id: runId, threadId, status: "completed" },
    events,
  );
}

function category(type: string): RunEvent["category"] {
  if (type.startsWith("subagent.")) return "subagent";
  if (type.startsWith("model.") || type.startsWith("route_")) return "model";
  return "tool";
}

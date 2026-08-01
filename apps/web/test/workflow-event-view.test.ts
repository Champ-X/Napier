import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { traceEventSummaryView } from "../src/trace-event-summary-view";
import { workflowEventTraceSummary } from "../src/workflow-event-view";

describe("Workflow event Trace projection", () => {
  it("summarizes start and completion evidence without input or output bodies", () => {
    const started = workflowEvent("workflow.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      blueprintSha256: "2".repeat(64),
      workflowVersion: 3,
      nodeCount: 2,
      maxConcurrency: 2,
      input: { secret: "PRIVATE_WORKFLOW_INPUT" },
      inputSha256: "3".repeat(64),
      inputSchemaSha256: "4".repeat(64),
      outputSchemaSha256: "5".repeat(64),
      outputNodeId: "report",
    });
    const completed = workflowEvent("workflow.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      blueprintSha256: "2".repeat(64),
      status: "completed",
      nodeResultCount: 2,
      completedNodeCount: 2,
      outputSha256: "6".repeat(64),
      resultSha256: "7".repeat(64),
      output: "PRIVATE_WORKFLOW_OUTPUT",
    });

    expect(workflowEventTraceSummary(started)).toBe(
      `workflow started / version 3 / nodes 2 / concurrency 2 / input ${"3".repeat(12)} / input-schema ${"4".repeat(12)} / output-schema ${"5".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(completed)).toBe(
      `workflow completed / status completed / completed 2/2 / result ${"7".repeat(12)} / output ${"6".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    const skippedCompleted = workflowEvent("workflow.completed", {
      ...(completed.payload as Record<string, JsonValue>),
      nodeResultCount: 1,
      completedNodeCount: 0,
      skippedNodeCount: 1,
    });
    expect(workflowEventTraceSummary(skippedCompleted)).toBe(
      `workflow completed / status completed / completed 0/1 / skipped 1 / result ${"7".repeat(12)} / output ${"6".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(traceEventSummaryView(started)).toEqual({
      text: workflowEventTraceSummary(started),
      source: "bounded",
    });
    expect(
      `${workflowEventTraceSummary(started)} ${workflowEventTraceSummary(completed)}`,
    ).not.toContain("PRIVATE_WORKFLOW");
  });

  it("summarizes node completion, recovery, and fixed failure diagnostics", () => {
    const completed = workflowEvent("workflow.node.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inspect",
      attempt: 2,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      outputSha256: "5".repeat(64),
      recovered: true,
    });
    const failed = workflowEvent("workflow.node.failed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inspect",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      errorCode: "output_invalid",
      diagnosticSha256: "6".repeat(64),
      error: "PRIVATE_MODEL_ERROR",
    });

    expect(workflowEventTraceSummary(completed)).toContain(
      `node inspect / attempt 2 / input ${"2".repeat(12)} / output-schema ${"4".repeat(12)} / output ${"5".repeat(12)} / recovered`,
    );
    expect(workflowEventTraceSummary(failed)).toContain(
      `error output_invalid / diagnostic ${"6".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(failed)).not.toContain(
      "PRIVATE_MODEL_ERROR",
    );

    const skipped = workflowEvent("workflow.node.skipped", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inspect",
      nodeType: "agent",
      attempt: 0,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      outputSha256: "5".repeat(64),
      conditionSha256: "6".repeat(64),
      skipOutputSha256: "5".repeat(64),
      conditionSubjectSha256: "7".repeat(64),
      matched: false,
      recovered: true,
      reused: false,
      skipOutput: "PRIVATE_SKIP_OUTPUT",
    });
    expect(workflowEventTraceSummary(skipped)).toContain(
      `node inspect / attempt 0 / input ${"2".repeat(12)} / output-schema ${"4".repeat(12)} / condition ${"6".repeat(12)} / skip-output ${"5".repeat(12)} / subject ${"7".repeat(12)} / output ${"5".repeat(12)} / recovered`,
    );
    expect(workflowEventTraceSummary(skipped)).not.toContain(
      "PRIVATE_SKIP_OUTPUT",
    );

    const toolCompleted = workflowEvent("workflow.node.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inventory",
      nodeType: "tool",
      toolName: "list_files",
      effect: "read",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      outputSha256: "5".repeat(64),
      recovered: false,
      workflowOutput: "PRIVATE_TOOL_OUTPUT",
    });
    expect(workflowEventTraceSummary(toolCompleted)).toContain(
      "node inventory / attempt 1",
    );
    expect(workflowEventTraceSummary(toolCompleted)).toContain(
      "tool list_files (read)",
    );
    expect(workflowEventTraceSummary(toolCompleted)).not.toContain("PRIVATE");

    const deterministicStarted = workflowEvent("workflow.node.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "shape",
      nodeType: "deterministic",
      templateSha256: "8".repeat(64),
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      planRevisionBefore: 1,
      planRevisionAfter: 2,
      recovered: false,
      template: "PRIVATE_TEMPLATE",
    });
    const deterministicCompleted = workflowEvent(
      "workflow.deterministic.completed",
      {
        schemaVersion: 1,
        planId: "plan_abcdefghijklmnopqrst",
        nodeId: "shape",
        attempt: 1,
        manifestSha256: "1".repeat(64),
        templateSha256: "8".repeat(64),
        inputSha256: "2".repeat(64),
        outputSha256: "5".repeat(64),
        outputBytes: 42,
        outputSchemaSha256: "4".repeat(64),
        output: "PRIVATE_DETERMINISTIC_OUTPUT",
      },
    );
    expect(workflowEventTraceSummary(deterministicStarted)).toContain(
      `deterministic ${"8".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(deterministicCompleted)).toContain(
      `template ${"8".repeat(12)} / input ${"2".repeat(12)} / output ${"5".repeat(12)} / bytes 42`,
    );
    expect(
      `${workflowEventTraceSummary(deterministicStarted)} ${workflowEventTraceSummary(deterministicCompleted)}`,
    ).not.toContain("PRIVATE");

    const approvalStarted = workflowEvent("workflow.node.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "approval",
      nodeType: "approval",
      questionSha256: "7".repeat(64),
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      planRevisionBefore: 1,
      planRevisionAfter: 2,
      recovered: false,
      question: "PRIVATE_APPROVAL_QUESTION",
    });
    const approvalRequested = workflowEvent("workflow.approval.requested", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "approval",
      nodeType: "approval",
      questionSha256: "7".repeat(64),
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      decisionId: "decision_abcdefghijklmnopqrst",
      requestedEventSeq: 8,
      decisionRequestSha256: "8".repeat(64),
      expiresAt: "2026-08-01T00:00:00.000Z",
      answer: "PRIVATE_APPROVAL_ANSWER",
    });
    expect(workflowEventTraceSummary(approvalStarted)).toContain(
      `approval ${"7".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(approvalRequested)).toContain(
      "decision klmnopqrst",
    );
    expect(
      `${workflowEventTraceSummary(approvalStarted)} ${workflowEventTraceSummary(approvalRequested)}`,
    ).not.toContain("PRIVATE_APPROVAL");
  });

  it("summarizes experiment lineage and reused outputs without source bodies", () => {
    const started = workflowEvent("workflow.experiment.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      sourceThreadId: "thread_source_private",
      sourcePlanId: "plan_source_private",
      sourceManifestSha256: "2".repeat(64),
      fromNodeId: "report",
      reusedNodeIds: ["inspect"],
      rerunNodeIds: ["report"],
      previewSha256: "3".repeat(64),
      sideEffectsConfirmed: true,
      sourceOutput: "PRIVATE_SOURCE_OUTPUT",
    });
    const reused = workflowEvent("workflow.node.reused", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      nodeId: "inspect",
      inputSha256: "4".repeat(64),
      outputSha256: "5".repeat(64),
      sourceThreadId: "thread_source_private",
      sourcePlanId: "plan_source_private",
      sourceRunId: "run_source_private",
      sourceAttempt: 2,
      output: "PRIVATE_REUSED_OUTPUT",
    });
    const compared = workflowEvent("workflow.experiment.compared", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      comparisonSha256: "6".repeat(64),
      sourceStatus: "completed",
      targetStatus: "completed",
      reusedNodeCount: 1,
      rerunNodeCount: 1,
      changedNodeCount: 1,
      inputChange: "unchanged",
      outputChange: "changed",
      durationMsDelta: -42,
      inputTokensDelta: -10,
      outputTokensDelta: 4,
      costUsdDelta: -0.001,
      toolCallCountDelta: -2,
      evaluationCountDelta: -1,
      artifactCountDelta: 0,
      sourceOutput: "PRIVATE_COMPARISON_OUTPUT",
    });

    expect(workflowEventTraceSummary(started)).toContain(
      `from report / reused 1 / rerun 1 / preview ${"3".repeat(12)} / side-effects confirmed`,
    );
    expect(workflowEventTraceSummary(reused)).toContain(
      `node inspect / source-attempt 2 / input ${"4".repeat(12)} / output ${"5".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(compared)).toContain(
      `completed -> completed / changed-nodes 1 / output changed / duration -42ms / tokens -6 / tools -2 / cost -0.001000 USD / evaluations -1 / artifacts 0 / comparison ${"6".repeat(12)}`,
    );
    expect(
      `${workflowEventTraceSummary(started)} ${workflowEventTraceSummary(reused)} ${workflowEventTraceSummary(compared)}`,
    ).not.toContain("PRIVATE");
  });

  it("summarizes Map coordination and item evidence without data bodies", () => {
    const nodeStarted = workflowEvent("workflow.node.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "analyze",
      nodeType: "map",
      mapConfigurationSha256: "8".repeat(64),
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      planRevisionBefore: 1,
      planRevisionAfter: 2,
      recovered: false,
      input: "PRIVATE_MAP_INPUT",
    });
    const itemCompleted = workflowEvent("workflow.map.item.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "analyze",
      coordinatorRunId: "run_abcdefghijklmnopqrst",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      mapConfigurationSha256: "8".repeat(64),
      itemIndex: 1,
      itemCount: 3,
      itemInputSha256: "2".repeat(64),
      itemOutputSha256: "5".repeat(64),
      itemOutputBytes: 42,
      itemOutputSchemaSha256: "4".repeat(64),
      output: "PRIVATE_MAP_ITEM_OUTPUT",
    });
    const completed = workflowEvent("workflow.map.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "analyze",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      mapConfigurationSha256: "8".repeat(64),
      inputSha256: "2".repeat(64),
      outputSha256: "5".repeat(64),
      outputBytes: 120,
      outputSchemaSha256: "4".repeat(64),
      itemOutputSchemaSha256: "6".repeat(64),
      itemCount: 3,
      maxConcurrency: 3,
      itemInputSetSha256: "7".repeat(64),
      itemOutputSetSha256: "9".repeat(64),
      itemRunSetSha256: "a".repeat(64),
      output: "PRIVATE_MAP_OUTPUT",
    });

    expect(workflowEventTraceSummary(nodeStarted)).toContain(
      `map ${"8".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(itemCompleted)).toContain(
      `item 2/3 / input ${"2".repeat(12)} / map ${"8".repeat(12)} / output ${"5".repeat(12)} / bytes 42`,
    );
    expect(workflowEventTraceSummary(completed)).toContain(
      `items 3 / concurrency 3 / output ${"5".repeat(12)} / bytes 120 / map ${"8".repeat(12)}`,
    );
    expect(
      `${workflowEventTraceSummary(nodeStarted)} ${workflowEventTraceSummary(itemCompleted)} ${workflowEventTraceSummary(completed)}`,
    ).not.toContain("PRIVATE_MAP");
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.map.item.completed", {
          ...(itemCompleted.payload as Record<string, JsonValue>),
          itemOutputSha256: undefined,
        }),
      ),
    ).toBeUndefined();
  });

  it("summarizes Loop iterations and checkpoint reuse without result bodies", () => {
    const nodeStarted = workflowEvent("workflow.node.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "refine",
      nodeType: "loop",
      loopConfigurationSha256: "8".repeat(64),
      attempt: 2,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      planRevisionBefore: 3,
      planRevisionAfter: 4,
      recovered: false,
    });
    const iteration = workflowEvent("workflow.loop.iteration.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "refine",
      coordinatorRunId: "run_abcdefghijklmnopqrst",
      attempt: 2,
      manifestSha256: "1".repeat(64),
      loopConfigurationSha256: "8".repeat(64),
      iterationIndex: 1,
      iterationInputSha256: "2".repeat(64),
      outputSha256: "5".repeat(64),
      outputBytes: 72,
      outputSchemaSha256: "4".repeat(64),
      untilSubjectSha256: "6".repeat(64),
      matched: true,
      output: "PRIVATE_LOOP_OUTPUT",
    });
    const reused = workflowEvent("workflow.loop.checkpoint.reused", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "refine",
      attempt: 2,
      manifestSha256: "1".repeat(64),
      loopConfigurationSha256: "8".repeat(64),
      inputSha256: "2".repeat(64),
      reusedIterationCount: 1,
      checkpointSha256: "7".repeat(64),
      sourceCoordinatorSetSha256: "9".repeat(64),
      lastOutputSha256: "a".repeat(64),
      matched: false,
    });
    const completed = workflowEvent("workflow.loop.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "refine",
      attempt: 2,
      manifestSha256: "1".repeat(64),
      loopConfigurationSha256: "8".repeat(64),
      inputSha256: "2".repeat(64),
      outputSha256: "5".repeat(64),
      outputBytes: 72,
      outputSchemaSha256: "4".repeat(64),
      iterationCount: 2,
      reusedIterationCount: 1,
      maxIterations: 3,
      iterationRunSetSha256: "b".repeat(64),
      checkpointSha256: "c".repeat(64),
      untilSubjectSha256: "6".repeat(64),
      termination: "condition_matched",
      output: "PRIVATE_LOOP_FINAL",
    });

    expect(workflowEventTraceSummary(nodeStarted)).toContain(
      `loop ${"8".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(iteration)).toContain(
      `iteration 2 / input ${"2".repeat(12)} / output ${"5".repeat(12)} / bytes 72 / matched`,
    );
    expect(workflowEventTraceSummary(reused)).toContain(
      `reused 1 / input ${"2".repeat(12)} / output ${"a".repeat(12)} / checkpoint ${"7".repeat(12)} / continuing`,
    );
    expect(workflowEventTraceSummary(completed)).toContain(
      `iterations 2/3 / reused 1 / input ${"2".repeat(12)} / output ${"5".repeat(12)} / bytes 72 / checkpoint ${"c".repeat(12)}`,
    );
    expect(
      `${workflowEventTraceSummary(iteration)} ${workflowEventTraceSummary(completed)}`,
    ).not.toContain("PRIVATE_LOOP");
  });

  it("summarizes Reduce configuration and output evidence without item bodies", () => {
    const nodeStarted = workflowEvent("workflow.node.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "total",
      nodeType: "reduce",
      reduceConfigurationSha256: "8".repeat(64),
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      planRevisionBefore: 1,
      planRevisionAfter: 2,
      recovered: false,
      input: "PRIVATE_REDUCE_INPUT",
    });
    const completed = workflowEvent("workflow.reduce.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "total",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      operation: "sum",
      reduceConfigurationSha256: "8".repeat(64),
      inputSha256: "2".repeat(64),
      itemCount: 3,
      itemSetSha256: "5".repeat(64),
      valueSetSha256: "6".repeat(64),
      outputSha256: "7".repeat(64),
      outputBytes: 2,
      outputSchemaSha256: "4".repeat(64),
      output: "PRIVATE_REDUCE_OUTPUT",
    });

    expect(workflowEventTraceSummary(nodeStarted)).toContain(
      `reduce ${"8".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(completed)).toContain(
      `operation sum / items 3 / reduce ${"8".repeat(12)} / input ${"2".repeat(12)} / item-set ${"5".repeat(12)} / value-set ${"6".repeat(12)} / output ${"7".repeat(12)} / bytes 2`,
    );
    expect(
      `${workflowEventTraceSummary(nodeStarted)} ${workflowEventTraceSummary(completed)}`,
    ).not.toContain("PRIVATE_REDUCE");
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.reduce.completed", {
          ...(completed.payload as Record<string, JsonValue>),
          operation: "custom",
        }),
      ),
    ).toBeUndefined();
  });

  it("summarizes persisted breakpoints without bound input bodies", () => {
    const started = workflowEvent("workflow.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      workflowVersion: 1,
      nodeCount: 2,
      maxConcurrency: 1,
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      outputNodeId: "write",
      breakBeforeNodeIds: ["write"],
    });
    const reached = {
      ...workflowEvent("workflow.breakpoint.reached", {
        schemaVersion: 1,
        planId: "plan_abcdefghijklmnopqrst",
        manifestSha256: "1".repeat(64),
        nodeId: "write",
        breakpointIndex: 0,
        breakpointCount: 1,
        bindingContextSha256: "5".repeat(64),
        planRevision: 3,
        input: "PRIVATE_BREAKPOINT_INPUT",
      }),
      seq: 10,
    };
    const continued = {
      ...workflowEvent("workflow.breakpoint.continued", {
        ...(reached.payload as Record<string, JsonValue>),
        reachedEventSeq: 10,
      }),
      seq: 11,
    };
    const paused = {
      ...workflowEvent("workflow.paused", {
        schemaVersion: 1,
        planId: "plan_abcdefghijklmnopqrst",
        manifestSha256: "1".repeat(64),
        status: "paused",
        nodeResultCount: 1,
        completedNodeCount: 1,
        skippedNodeCount: 0,
        resultSha256: "6".repeat(64),
        breakpointNodeId: "write",
        breakpointIndex: 0,
        breakpointCount: 1,
        breakpointReachedEventSeq: 10,
        breakpointBindingContextSha256: "5".repeat(64),
      }),
      seq: 12,
    };

    expect(workflowEventTraceSummary(started)).toContain("breakpoints 1");
    expect(workflowEventTraceSummary(reached)).toBe(
      `workflow breakpoint reached / node write / breakpoint 1/1 / binding ${"5".repeat(12)} / plan-r3 / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(continued)).toBe(
      `workflow breakpoint continued / node write / breakpoint 1/1 / binding ${"5".repeat(12)} / plan-r3 / reached-seq 10 / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(paused)).toBe(
      `workflow paused / status paused / completed 1/1 / result ${"6".repeat(12)} / before write / breakpoint 1/1 / binding ${"5".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(
      `${workflowEventTraceSummary(reached)} ${workflowEventTraceSummary(continued)} ${workflowEventTraceSummary(paused)}`,
    ).not.toContain("PRIVATE");
    expect(
      workflowEventTraceSummary({
        ...continued,
        payload: {
          ...(continued.payload as Record<string, JsonValue>),
          reachedEventSeq: 11,
        },
      }),
    ).toBeUndefined();
  });

  it("summarizes Artifact settlement without workspace paths or diagnostics", () => {
    const settled = workflowEvent("workflow.artifacts.settled", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      artifactCount: 2,
      verifiedCount: 2,
      missingCount: 0,
      failedCount: 0,
      artifactSetSha256: "2".repeat(64),
      planRevision: 7,
      complete: true,
      path: "PRIVATE_WORKSPACE_PATH",
    });
    const failedArtifact = workflowEvent("workflow.artifacts.failed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      artifactId: "report",
      artifactCount: 2,
      artifactSetSha256: "3".repeat(64),
      errorCode: "scope_denied",
      diagnosticSha256: "4".repeat(64),
      diagnostic: "PRIVATE_ARTIFACT_DIAGNOSTIC",
    });
    const failedSet = workflowEvent("workflow.artifacts.failed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      artifactCount: 2,
      verifiedCount: 1,
      missingCount: 1,
      failedCount: 0,
      artifactSetSha256: "5".repeat(64),
      planRevision: 8,
      complete: false,
    });

    expect(workflowEventTraceSummary(settled)).toBe(
      `workflow artifacts settled / verified 2/2 / plan-r7 / set ${"2".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(failedArtifact)).toBe(
      `workflow artifacts failed / artifact report / error scope_denied / diagnostic ${"4".repeat(12)} / artifacts 2 / set ${"3".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(failedSet)).toBe(
      `workflow artifacts failed / verified 1/2 / missing 1 / plan-r8 / set ${"5".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(
      `${workflowEventTraceSummary(settled)} ${workflowEventTraceSummary(failedArtifact)}`,
    ).not.toContain("PRIVATE");
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.artifacts.settled", {
          ...(settled.payload as Record<string, JsonValue>),
          verifiedCount: 1,
        }),
      ),
    ).toBeUndefined();
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.artifacts.failed", {
          ...(failedSet.payload as Record<string, JsonValue>),
          artifactId: "PRIVATE INVALID ID",
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects malformed Workflow evidence", () => {
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.node.failed", {
          schemaVersion: 1,
          planId: "plan_abcdefghijklmnopqrst",
          nodeId: "inspect",
          attempt: 1,
          manifestSha256: "1".repeat(64),
          inputSha256: "2".repeat(64),
          outputSchemaSha256: "3".repeat(64),
          errorCode: "PRIVATE ERROR",
          diagnosticSha256: "4".repeat(64),
        }),
      ),
    ).toBeUndefined();
  });
});

function workflowEvent(
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: "event_abcdefghijklmnopqrst",
    threadId: "thread_abcdefghijklmnopqrst",
    runId: "run_abcdefghijklmnopqrst",
    seq: 1,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-07-30T00:00:00.000Z",
    payload: payload as RunEvent["payload"],
  };
}

import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  ModelRef,
  RunEvent,
} from "@napier/contracts";
import {
  exportThreadReplayBundle,
  verifyThreadReplayBundle,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { WorkflowBenchmarkCase } from "./workflow-benchmark-types.js";

export interface WorkflowBenchmarkRestartEvidence {
  restartEvent: RunEvent;
  preRestartMapRunIds: string[];
}

export async function executeWorkflowBenchmark(input: {
  runtime: LocalAgentRuntimeServices;
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
  runtimeOptions: LocalAgentRuntimeOptions;
  benchmarkCase: WorkflowBenchmarkCase;
  manifest: ExecutionPlanWorkflowManifest;
  workflowInput: JsonValue;
  threadId: string;
  model: ModelRef;
  signal: AbortSignal;
}): Promise<{
  runtime: LocalAgentRuntimeServices;
  result: ExecutionPlanWorkflowResult;
  restartEvidence?: WorkflowBenchmarkRestartEvidence;
}> {
  const first = await input.runtime.workflows.run({
    threadId: input.threadId,
    request: {
      manifest: input.manifest,
      input: input.workflowInput,
    },
    signal: input.signal,
  });
  if (input.benchmarkCase.schemaVersion !== 4) {
    return { runtime: input.runtime, result: first };
  }
  const prepared = await prepareRestart(input.runtime, first, input);
  await input.runtime.shutdown();
  let reopened: LocalAgentRuntimeServices | undefined;
  try {
    reopened = await input.createRuntime(input.runtimeOptions);
    if (!(await reopened.models.isConfigured(input.model))) {
      throw new Error(
        "Workflow benchmark model is not configured after restart",
      );
    }
    const recovered = await recoveredDecision(
      reopened,
      input.threadId,
      prepared.decision.id,
      prepared.decision.contentSha256,
    );
    const restartEvent = await reopened.store.appendEvent({
      threadId: input.threadId,
      runId: recovered.runId,
      type: "benchmark.workflow.runtime.restarted",
      category: "system",
      visibility: "user",
      payload: {
        schemaVersion: 1,
        planId: first.planId,
        manifestSha256: input.manifest.contentSha256,
        preRestartReplaySha256: prepared.replaySha256,
        preRestartEventCount: prepared.eventCount,
        preRestartMapRunIds: prepared.mapRunIds,
        decisionId: recovered.id,
        decisionSha256: recovered.contentSha256,
      },
    });
    await reopened.store.answerOperatorDecision(input.threadId, recovered.id, {
      selectedOptionIds: [recovered.options[0]!.id],
      customText: input.benchmarkCase.approvalCustomText,
    });
    const result = await reopened.workflows.run({
      threadId: input.threadId,
      request: { manifest: input.manifest, planId: first.planId },
      signal: input.signal,
    });
    return {
      runtime: reopened,
      result,
      restartEvidence: {
        restartEvent,
        preRestartMapRunIds: prepared.mapRunIds,
      },
    };
  } catch (error) {
    await reopened?.shutdown().catch(() => undefined);
    throw error;
  }
}

async function prepareRestart(
  runtime: LocalAgentRuntimeServices,
  result: ExecutionPlanWorkflowResult,
  input: {
    threadId: string;
    manifest: ExecutionPlanWorkflowManifest;
  },
): Promise<{
  decision: Awaited<
    ReturnType<LocalAgentRuntimeServices["store"]["listOperatorDecisions"]>
  >[number];
  replaySha256: string;
  eventCount: number;
  mapRunIds: string[];
}> {
  if (
    result.status !== "waiting" ||
    result.nodeResults.find((node) => node.nodeId === "extract")?.status !==
      "completed" ||
    result.nodeResults.find((node) => node.nodeId === "restart_gate")
      ?.status !== "waiting"
  ) {
    throw new Error("Long-horizon benchmark did not reach its restart gate");
  }
  const decisions = (
    await runtime.store.listOperatorDecisions(input.threadId)
  ).filter((decision) => decision.status === "pending");
  if (decisions.length !== 1) {
    throw new Error("Long-horizon benchmark has no single pending decision");
  }
  const replay = await exportThreadReplayBundle(runtime.store, input.threadId);
  if (verifyThreadReplayBundle(replay).status !== "valid") {
    throw new Error("Long-horizon pre-restart Replay is invalid");
  }
  const mapRunIds = completedMapRunIds(runtime, input.threadId);
  if (mapRunIds.length === 0) {
    throw new Error("Long-horizon benchmark has no completed Map Runs");
  }
  return {
    decision: decisions[0]!,
    replaySha256: replay.contentSha256,
    eventCount: replay.events.length,
    mapRunIds,
  };
}

async function recoveredDecision(
  runtime: LocalAgentRuntimeServices,
  threadId: string,
  decisionId: string,
  decisionSha256: string,
) {
  const decisions = await runtime.store.listOperatorDecisions(threadId);
  const recovered = decisions.find((decision) => decision.id === decisionId);
  if (
    !recovered ||
    recovered.status !== "pending" ||
    recovered.contentSha256 !== decisionSha256 ||
    recovered.options.length !== 2
  ) {
    throw new Error("Long-horizon Approval did not survive Runtime restart");
  }
  return recovered;
}

function completedMapRunIds(
  runtime: LocalAgentRuntimeServices,
  threadId: string,
): string[] {
  return runtime.store
    .listRuns(threadId)
    .filter(
      (run) =>
        run.status === "completed" &&
        run.configuration !== undefined &&
        "executionMode" in run.configuration &&
        run.configuration.executionMode === "workflow_map_read_only",
    )
    .map((run) => run.id)
    .sort();
}

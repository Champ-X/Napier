import type {
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentArtifactSummary,
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentEvaluationSummary,
  ExecutionPlanWorkflowExperimentNodeComparison,
  ExecutionPlanWorkflowExperimentNodeObservation,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  ModelRef,
  RunEvaluationRecord,
  RunEvent,
  RunInvocationSource,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  canonicalWorkflowExperimentStrings,
  subtractWorkflowExperimentMetrics,
  sumWorkflowExperimentMetrics,
  workflowExperimentConfigurationChanged,
  workflowExperimentNodeChanged,
  workflowExperimentValueChange,
} from "./workflow-experiment-comparison-model.js";
import { validateExecutionPlanWorkflowExperimentComparison } from "./workflow-experiment-comparison-protocol.js";
import { deriveRunMetrics } from "./replay.js";
import type { LocalStore } from "./store.js";

const HASH = /^[a-f0-9]{64}$/u;
const RUN_ID = /^run_[a-z0-9]{8,80}$/u;

export interface CreateExecutionPlanWorkflowExperimentComparisonOptions {
  store: LocalStore;
  preview: ExecutionPlanWorkflowExperimentPreview;
  sourcePlan: ExecutionPlan;
  targetPlan: ExecutionPlan;
  sourceManifest: ExecutionPlanWorkflowManifest;
  candidateManifest: ExecutionPlanWorkflowManifest;
  targetResult: ExecutionPlanWorkflowResult;
}

export async function createExecutionPlanWorkflowExperimentComparison(
  options: CreateExecutionPlanWorkflowExperimentComparisonOptions,
): Promise<ExecutionPlanWorkflowExperimentComparison> {
  assertComparisonPlanBindings(options);
  const sourceEvents = await options.store.listEvents(
    options.preview.sourceThreadId,
  );
  const targetEvents = await options.store.listEvents(
    options.targetResult.threadId,
  );
  const sourceEventsByRun = groupEventsByRun(sourceEvents);
  const targetEventsByRun = groupEventsByRun(targetEvents);
  const sourceRuns = options.store.listRuns(options.preview.sourceThreadId);
  const targetRuns = options.store.listRuns(options.targetResult.threadId);
  const sourceEvaluations = options.store.listRunEvaluations(
    options.preview.sourceThreadId,
  );
  const targetEvaluations = options.store.listRunEvaluations(
    options.targetResult.threadId,
  );
  const rerun = new Set(options.preview.rerunNodeIds);
  const nodes = await Promise.all(
    options.sourceManifest.nodes.map(async (sourceNode, index) => {
      const targetNode = options.candidateManifest.nodes[index]!;
      const [source, target] = await Promise.all([
        observeNode({
          store: options.store,
          threadId: options.preview.sourceThreadId,
          plan: options.sourcePlan,
          nodeId: sourceNode.id,
          events: sourceEvents,
          eventsByRun: sourceEventsByRun,
          runs: sourceRuns,
          evaluations: sourceEvaluations,
        }),
        observeNode({
          store: options.store,
          threadId: options.targetResult.threadId,
          plan: options.targetPlan,
          nodeId: targetNode.id,
          events: targetEvents,
          eventsByRun: targetEventsByRun,
          runs: targetRuns,
          evaluations: targetEvaluations,
        }),
      ]);
      return compareNode(
        sourceNode.id,
        rerun.has(sourceNode.id) ? "rerun" : "reused",
        sourceNode.type === "agent" ||
          sourceNode.type === "map" ||
          sourceNode.type === "loop"
          ? sourceNode.model
          : undefined,
        targetNode.type === "agent" ||
          targetNode.type === "map" ||
          targetNode.type === "loop"
          ? targetNode.model
          : undefined,
        source,
        target,
      );
    }),
  );
  const sourceMetrics = sumWorkflowExperimentMetrics(
    nodes.map((node) => node.source.metrics),
  );
  const targetMetrics = sumWorkflowExperimentMetrics(
    nodes.map((node) => node.target.metrics),
  );
  const sourceRunIds = nodes.flatMap((node) => node.source.runIds);
  const targetRunIds = nodes.flatMap((node) => node.target.runIds);
  const sourceInputSha256 = workflowInputSha256(
    sourceEvents,
    options.sourcePlan.id,
    options.sourceManifest.contentSha256,
  );
  const targetInputSha256 = workflowInputSha256(
    targetEvents,
    options.targetPlan.id,
    options.candidateManifest.contentSha256,
  );
  const sourceOutputSha256 = nodes.find(
    (node) => node.nodeId === options.sourceManifest.outputNodeId,
  )?.source.outputSha256;
  const targetOutputSha256 = options.targetResult.outputSha256;
  const content = {
    kind: "napier.execution-plan-workflow-experiment-comparison" as const,
    schemaVersion: 1 as const,
    sourceThreadId: options.preview.sourceThreadId,
    sourcePlanId: options.sourcePlan.id,
    targetThreadId: options.targetResult.threadId,
    targetPlanId: options.targetResult.planId,
    sourceStatus: options.sourcePlan.status,
    targetStatus: options.targetResult.status,
    sourceInputSha256,
    targetInputSha256,
    inputChange: workflowExperimentValueChange(
      sourceInputSha256,
      targetInputSha256,
    ),
    ...(sourceOutputSha256 ? { sourceOutputSha256 } : {}),
    ...(targetOutputSha256 ? { targetOutputSha256 } : {}),
    outputChange: workflowExperimentValueChange(
      sourceOutputSha256,
      targetOutputSha256,
    ),
    reusedNodeCount: options.preview.reusedNodeIds.length,
    rerunNodeCount: options.preview.rerunNodeIds.length,
    sourceMetrics,
    targetMetrics,
    metricDelta: subtractWorkflowExperimentMetrics(
      sourceMetrics,
      targetMetrics,
    ),
    sourceEvaluations: evaluationSummary(sourceEvaluations, sourceRunIds),
    targetEvaluations: evaluationSummary(targetEvaluations, targetRunIds),
    sourceArtifacts: artifactSummary(options.sourcePlan),
    targetArtifacts: artifactSummary(options.targetPlan),
    changedNodeIds: nodes
      .filter(workflowExperimentNodeChanged)
      .map((node) => node.nodeId),
    nodes,
  };
  assertComparisonPlanBindings(options);
  return validateExecutionPlanWorkflowExperimentComparison({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

function assertComparisonPlanBindings(
  options: CreateExecutionPlanWorkflowExperimentComparisonOptions,
): void {
  const currentSource = options.store.getPlan(options.sourcePlan.id);
  const currentTarget = options.store.getPlan(options.targetPlan.id);
  if (
    options.sourcePlan.id !== options.preview.sourcePlanId ||
    options.sourcePlan.threadId !== options.preview.sourceThreadId ||
    options.sourcePlan.revision !== options.preview.sourcePlanRevision ||
    currentSource.revision !== options.sourcePlan.revision ||
    currentSource.status !== options.sourcePlan.status ||
    options.sourcePlan.id === options.targetPlan.id ||
    options.sourcePlan.threadId === options.targetPlan.threadId ||
    options.targetPlan.id !== options.targetResult.planId ||
    options.targetPlan.threadId !== options.targetResult.threadId ||
    currentTarget.revision !== options.targetPlan.revision ||
    currentTarget.status !== options.targetPlan.status ||
    options.sourceManifest.nodes.some(
      (node, index) => options.candidateManifest.nodes[index]?.id !== node.id,
    )
  ) {
    throw new Error("Workflow experiment comparison Plan binding is invalid");
  }
}

interface ObserveNodeOptions {
  store: LocalStore;
  threadId: string;
  plan: ExecutionPlan;
  nodeId: string;
  events: RunEvent[];
  eventsByRun: ReadonlyMap<string, RunEvent[]>;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
}

async function observeNode(
  options: ObserveNodeOptions,
): Promise<ExecutionPlanWorkflowExperimentNodeObservation> {
  const step = options.plan.steps.find(
    (candidate) => candidate.id === options.nodeId,
  );
  if (!step) throw new Error("Workflow experiment comparison node is missing");
  const nodeEvents = options.events.filter(
    (event) =>
      record(event.payload)?.["planId"] === options.plan.id &&
      record(event.payload)?.["nodeId"] === options.nodeId,
  );
  const started = nodeEvents.filter(
    (event) => event.type === "workflow.node.started",
  );
  const itemStarted = nodeEvents.filter(
    (event) => event.type === "workflow.map.item.started",
  );
  const loopIterationStarted = nodeEvents.filter(
    (event) => event.type === "workflow.loop.iteration.started",
  );
  const runIds = canonicalWorkflowExperimentStrings(
    [...started, ...itemStarted, ...loopIterationStarted]
      .map((event) => event.runId)
      .filter((runId) => RUN_ID.test(runId)),
  );
  const runById = new Map(options.runs.map((run) => [run.id, run]));
  if (runIds.some((runId) => !runById.has(runId))) {
    throw new Error("Workflow experiment comparison Run is missing");
  }
  if (
    runIds.some((runId) => {
      const source = runById.get(runId)?.source;
      return source !== "workflow" && source !== "workflow_reuse";
    })
  ) {
    throw new Error("Workflow experiment comparison Run source is invalid");
  }
  const runRecords = runIds.map((runId) => runById.get(runId)!);
  if (
    runRecords.some(
      (run) =>
        !run.configuration?.model || !hash(run.configuration.contentSha256),
    )
  ) {
    throw new Error(
      "Workflow experiment comparison Run configuration is invalid",
    );
  }
  const runEvents = new Map(
    runIds.map((runId) => [runId, options.eventsByRun.get(runId) ?? []]),
  );
  const inputSha256 = uniqueHash(
    nodeEvents
      .filter(
        (event) =>
          event.type === "workflow.node.started" ||
          event.type === "workflow.node.skipped" ||
          event.type === "workflow.node.failed",
      )
      .map((event) => record(event.payload)?.["inputSha256"]),
    "node input",
  );
  const outputSha256 =
    step.status === "completed" || step.status === "skipped"
      ? uniqueHash(
          nodeEvents
            .filter((event) =>
              step.status === "completed"
                ? event.type === "workflow.node.completed" &&
                  event.runId === step.runId
                : event.type === "workflow.node.skipped",
            )
            .map((event) => record(event.payload)?.["outputSha256"]),
          "node output",
        )
      : undefined;
  if (step.status === "completed" && (!step.runId || !outputSha256)) {
    throw new Error(
      "Workflow experiment comparison completed output is unavailable",
    );
  }
  if (step.status === "skipped" && (step.runId || !outputSha256)) {
    throw new Error(
      "Workflow experiment comparison skipped output is unavailable",
    );
  }
  const startedRunIds = new Set(started.map((event) => event.runId));
  const failedWithoutRunAttempts = new Set(
    nodeEvents.flatMap((event): number[] => {
      if (
        event.type !== "workflow.node.failed" ||
        startedRunIds.has(event.runId)
      ) {
        return [];
      }
      const attempt = record(event.payload)?.["attempt"];
      return Number.isSafeInteger(attempt) && Number(attempt) >= 1
        ? [Number(attempt)]
        : [];
    }),
  );
  const runSources = runRecords.map(
    (run) => run.source,
  ) as RunInvocationSource[];
  const models = runRecords.map((run) =>
    structuredClone(run.configuration!.model),
  );
  const configurationSha256s = runRecords.map(
    (run) => run.configuration!.contentSha256,
  );
  const toolNames = canonicalWorkflowExperimentStrings(
    [...runEvents.values()].flatMap((events) =>
      events.flatMap((event): string[] => {
        if (event.type !== "tool.started") return [];
        const name = record(event.payload)?.["toolName"];
        return typeof name === "string" ? [name] : [];
      }),
    ),
  );
  const metrics = sumWorkflowExperimentMetrics(
    runIds.map((runId) => {
      const run = runById.get(runId)!;
      const runMetrics = deriveRunMetrics(
        run.startedAt,
        run.finishedAt,
        runEvents.get(runId) ?? [],
        options.store.listSubagentTasks(options.threadId, runId),
      );
      return {
        runCount: 1,
        attemptCount: 0,
        durationMs: runMetrics.durationMs,
        modelResponseCount: runMetrics.modelResponseCount,
        toolCallCount: runMetrics.toolCallCount,
        toolCompletedCount: runMetrics.toolCompletedCount,
        toolFailedCount: runMetrics.toolFailedCount,
        toolBlockedCount: runMetrics.toolBlockedCount,
        inputTokens: runMetrics.inputTokens,
        outputTokens: runMetrics.outputTokens,
        cacheReadTokens: runMetrics.cacheReadTokens,
        cacheWriteTokens: runMetrics.cacheWriteTokens,
        costUsd: runMetrics.costUsd,
      };
    }),
  );
  metrics.attemptCount = started.length + failedWithoutRunAttempts.size;
  return {
    status: step.status,
    runIds,
    runSources,
    models,
    configurationSha256s,
    toolNames,
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(outputSha256 ? { outputSha256 } : {}),
    metrics,
    evaluations: evaluationSummary(options.evaluations, runIds),
  };
}

function groupEventsByRun(events: RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }
  return grouped;
}

function compareNode(
  nodeId: string,
  execution: "reused" | "rerun",
  sourceModel: ModelRef | undefined,
  targetModel: ModelRef | undefined,
  source: ExecutionPlanWorkflowExperimentNodeObservation,
  target: ExecutionPlanWorkflowExperimentNodeObservation,
): ExecutionPlanWorkflowExperimentNodeComparison {
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  return {
    nodeId,
    execution,
    source,
    target,
    statusChanged: source.status !== target.status,
    modelChanged:
      canonicalJson(sourceModel ?? null) !== canonicalJson(targetModel ?? null),
    configurationChanged: workflowExperimentConfigurationChanged(
      execution,
      source.configurationSha256s,
      target.configurationSha256s,
    ),
    inputChange: workflowExperimentValueChange(
      source.inputSha256,
      target.inputSha256,
    ),
    outputChange: workflowExperimentValueChange(
      source.outputSha256,
      target.outputSha256,
    ),
    metricDelta: subtractWorkflowExperimentMetrics(
      source.metrics,
      target.metrics,
    ),
    addedToolNames: target.toolNames.filter((name) => !sourceTools.has(name)),
    removedToolNames: source.toolNames.filter((name) => !targetTools.has(name)),
  };
}

function evaluationSummary(
  evaluations: RunEvaluationRecord[],
  runIds: string[],
): ExecutionPlanWorkflowExperimentEvaluationSummary {
  const selected = evaluations.filter(
    (evaluation) =>
      runIds.includes(evaluation.leftRunId) ||
      runIds.includes(evaluation.rightRunId),
  );
  return {
    total: selected.length,
    leftBetter: selected.filter(
      (evaluation) => evaluation.verdict === "left_better",
    ).length,
    rightBetter: selected.filter(
      (evaluation) => evaluation.verdict === "right_better",
    ).length,
    tie: selected.filter((evaluation) => evaluation.verdict === "tie").length,
    inconclusive: selected.filter(
      (evaluation) => evaluation.verdict === "inconclusive",
    ).length,
  };
}

function artifactSummary(
  plan: ExecutionPlan,
): ExecutionPlanWorkflowExperimentArtifactSummary {
  const projection = plan.artifacts
    .map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      sha256: artifact.sha256 ?? "",
      sizeBytes: artifact.sizeBytes ?? 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    total: projection.length,
    produced: projection.filter((artifact) => artifact.status === "produced")
      .length,
    verified: projection.filter((artifact) => artifact.status === "verified")
      .length,
    missing: projection.filter((artifact) => artifact.status === "missing")
      .length,
    setSha256: sha256(canonicalJson(projection)),
  };
}

function workflowInputSha256(
  events: RunEvent[],
  planId: string,
  manifestSha256: string,
): string {
  const matches = events.filter(
    (event) =>
      event.type === "workflow.started" &&
      record(event.payload)?.["planId"] === planId,
  );
  const digest = record(matches[0]?.payload)?.["inputSha256"];
  if (
    matches.length !== 1 ||
    record(matches[0]?.payload)?.["manifestSha256"] !== manifestSha256 ||
    !hash(digest)
  ) {
    throw new Error("Workflow experiment comparison input evidence is invalid");
  }
  return digest;
}

function uniqueHash(values: unknown[], label: string): string | undefined {
  const hashes = [...new Set(values.filter(hash))];
  if (hashes.length > 1) {
    throw new Error(`Workflow experiment comparison ${label} is ambiguous`);
  }
  return hashes[0];
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

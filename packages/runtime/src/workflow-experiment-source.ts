import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentToolEffects,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { collectRunToolEffectObservations } from "./automatic-recovery.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type { WorkflowReusedNode } from "./workflow-context.js";
import {
  evaluateExecutionPlanWorkflowCondition,
  executionPlanWorkflowConditionSha256,
} from "./workflow-condition-model.js";
import { executionPlanWorkflowDeterministicTemplateSha256 } from "./workflow-deterministic-model.js";
import { workflowLoopNodeConfigurationSha256 } from "./workflow-loop-model.js";
import { workflowMapNodeConfigurationSha256 } from "./workflow-map-model.js";
import { workflowReduceConfigurationSha256 } from "./workflow-reduce-model.js";
import { projectWorkflowExperimentExecution } from "./workflow-experiment-mode.js";
import { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  defineExecutionPlanWorkflow,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";
import { assertWorkflowPlanMatchesManifest } from "./workflow-runtime-model.js";
import {
  buildExecutionPlanWorkflowNodeInput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export interface ExecutionPlanWorkflowExperimentSource {
  sourcePlan: ExecutionPlan;
  sourceInput: JsonValue;
  sourceAgentId: string;
  sourceAgentRevision: number;
  candidateManifest: ExecutionPlanWorkflowManifest;
  preview: ExecutionPlanWorkflowExperimentPreview;
  reusedNodes: WorkflowReusedNode[];
}

export interface ExecutionPlanWorkflowSourceEvidence {
  input: JsonValue;
  agentId: string;
  agentRevision: number;
  events: RunEvent[];
  completedNodes: ReadonlyMap<string, WorkflowReusedNode>;
}

export async function projectExecutionPlanWorkflowExperimentSource(
  store: LocalStore,
  sourceThreadId: string,
  request: CreateExecutionPlanWorkflowExperimentRequest,
): Promise<ExecutionPlanWorkflowExperimentSource> {
  const manifest = validateExecutionPlanWorkflowManifest(request.manifest);
  const sourceThread = store.getThread(sourceThreadId);
  const sourcePlan = store.getPlan(request.planId);
  if (sourcePlan.threadId !== sourceThread.id) {
    throw new Error("Workflow experiment Plan does not belong to the Thread");
  }
  if (sourcePlan.steps.some((step) => step.status === "running")) {
    throw new Error("Workflow experiment source Plan still has a running node");
  }

  const execution = projectWorkflowExperimentExecution(
    manifest,
    request.fromNodeId,
    request.mode ?? "subgraph",
  );
  const { rerunNodeIds, executionNodeIds, stopBeforeNodeIds } = execution;
  const rerunSet = new Set(rerunNodeIds);
  const executionSet = new Set(executionNodeIds);
  const reusedNodeIds = manifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => !rerunSet.has(nodeId));
  const modelOverrides = normalizedModelOverrides(
    manifest,
    executionSet,
    request.modelOverrides ?? {},
  );
  const candidateManifest = defineExecutionPlanWorkflow({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    blueprint: manifest.blueprint,
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    outputNodeId: manifest.outputNodeId,
    nodes: manifest.nodes.map((node) => ({
      ...node,
      ...((node.type === "agent" ||
        node.type === "map" ||
        node.type === "loop") &&
      modelOverrides[node.id]
        ? { model: structuredClone(modelOverrides[node.id]) }
        : {}),
    })),
    ...(manifest.maxConcurrency !== undefined
      ? { maxConcurrency: manifest.maxConcurrency }
      : {}),
    generatedAt: manifest.generatedAt,
  });
  const source = await projectExecutionPlanWorkflowSourceEvidence(
    store,
    sourceThreadId,
    sourcePlan,
    manifest,
    manifest.contentSha256,
  );
  const reusedNodes = reusedNodeIds.map((nodeId) => {
    const snapshot = source.completedNodes.get(nodeId);
    if (!snapshot) {
      throw new Error(
        `Workflow experiment cannot reuse incomplete node: ${nodeId}`,
      );
    }
    return snapshot;
  });
  const toolEffects = executionNodeIds.map((nodeId) =>
    experimentNodeToolEffects(source.events, sourcePlan.id, nodeId),
  );
  const requiresSideEffectConfirmation = toolEffects.some(
    (effects) =>
      effects.writeCount > 0 ||
      effects.unknownCount > 0 ||
      effects.unresolvedCount > 0,
  );
  const previewBase = {
    kind: "napier.execution-plan-workflow-experiment-preview" as const,
    sourceThreadId,
    sourcePlanId: sourcePlan.id,
    sourcePlanRevision: sourcePlan.revision,
    sourceManifestSha256: manifest.contentSha256,
    candidateManifestSha256: candidateManifest.contentSha256,
    sourceAgentId: source.agentId,
    sourceAgentRevision: source.agentRevision,
    fromNodeId: request.fromNodeId,
    reusedNodeIds,
    rerunNodeIds,
    modelOverrides,
    toolEffects,
    requiresSideEffectConfirmation,
  };
  const previewContent =
    execution.mode === "single_node"
      ? {
          ...previewBase,
          schemaVersion: 2 as const,
          mode: "single_node" as const,
          executionNodeIds,
          stopBeforeNodeIds,
        }
      : {
          ...previewBase,
          schemaVersion: 1 as const,
        };
  return {
    sourcePlan,
    sourceInput: structuredClone(source.input),
    sourceAgentId: source.agentId,
    sourceAgentRevision: source.agentRevision,
    candidateManifest,
    preview: {
      ...previewContent,
      previewSha256: sha256(canonicalJson(previewContent)),
    },
    reusedNodes,
  };
}

export async function projectExecutionPlanWorkflowSourceEvidence(
  store: LocalStore,
  sourceThreadId: string,
  sourcePlan: ExecutionPlan,
  manifest: ExecutionPlanWorkflowManifest,
  sourceManifestSha256: string,
  projectNodeIds?: ReadonlySet<string>,
): Promise<ExecutionPlanWorkflowSourceEvidence> {
  const sourceThread = store.getThread(sourceThreadId);
  if (sourcePlan.threadId !== sourceThread.id) {
    throw new Error("Workflow experiment Plan does not belong to the Thread");
  }
  assertWorkflowPlanMatchesManifest(sourcePlan, manifest);
  const ledger = new ExecutionPlanWorkflowLedger(store);
  const start = await ledger.recoverWorkflowStart(
    sourceThreadId,
    sourcePlan.id,
    manifest,
    manifest.maxConcurrency ?? 1,
    sourceManifestSha256,
  );
  if (start.agentId !== sourceThread.agentId) {
    throw new Error("Workflow experiment source Agent does not match");
  }
  const agent = store.getAgentRevision(
    start.agentId,
    start.agentRevision,
  ).profile;
  const events = await store.listEvents(sourceThreadId);
  const runs = new Map(
    store.listRuns(sourceThreadId).map((run) => [run.id, run]),
  );
  const outputs = new Map<string, JsonValue>();
  const completedNodes = new Map<string, WorkflowReusedNode>();
  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]));
  const orderedNodeIds = sourcePlan.phaseWaves.flatMap((wave) => wave.stepIds);
  for (const nodeId of orderedNodeIds) {
    if (projectNodeIds && !projectNodeIds.has(nodeId)) continue;
    const step = sourcePlan.steps.find((candidate) => candidate.id === nodeId)!;
    if (step.status !== "completed" && step.status !== "skipped") continue;
    const node = nodeById.get(nodeId)!;
    const input = buildExecutionPlanWorkflowNodeInput(
      node,
      start.input,
      outputs,
    );
    const inputSha256 = sha256(canonicalJson(input));
    if (step.status === "skipped") {
      if (!node.when || node.skipOutput === undefined || step.runId) {
        throw new Error(
          "Workflow experiment source skipped node binding is invalid",
        );
      }
      const evaluation = evaluateExecutionPlanWorkflowCondition(
        node.when,
        input,
        node.id,
      );
      if (evaluation.matched) {
        throw new Error(
          "Workflow experiment source skipped condition is invalid",
        );
      }
      const skipEvidence = await ledger.verifyNodeSkippedEvent(
        {
          threadId: sourceThreadId,
          manifest,
          plan: sourcePlan,
        },
        node,
        inputSha256,
        evaluation.subjectSha256,
      );
      const output = structuredClone(node.skipOutput);
      const outputSha256 = sha256(canonicalJson(output));
      if (skipEvidence.reused) {
        validateSourceSkippedReuseEvent(
          events,
          sourcePlan.id,
          node.id,
          sourceManifestSha256,
          inputSha256,
          outputSha256,
        );
      }
      outputs.set(node.id, output);
      completedNodes.set(node.id, {
        nodeId: node.id,
        output: structuredClone(output),
        sourceThreadId,
        sourcePlanId: sourcePlan.id,
        sourceStatus: "skipped",
        sourceAttempt: 0,
        sourceInputSha256: inputSha256,
        sourceOutputSha256: outputSha256,
      });
      continue;
    }
    if (!step.runId) {
      throw new Error("Workflow experiment source node has no Run binding");
    }
    const run = runs.get(step.runId);
    if (!run || run.status !== "completed") {
      throw new Error("Workflow experiment source Run is not completed");
    }
    if (
      (run.source !== "workflow" && run.source !== "workflow_reuse") ||
      run.agentId !== start.agentId ||
      run.agentRevision !== start.agentRevision
    ) {
      throw new Error("Workflow experiment source Run binding is invalid");
    }
    const expectedModel =
      run.source === "workflow_reuse"
        ? { provider: "napier", id: "workflow-reuse" }
        : node.type === "agent" || node.type === "map" || node.type === "loop"
          ? (node.model ?? agent.model)
          : agent.model;
    if (
      !run.configuration ||
      run.configuration.model.provider !== expectedModel.provider ||
      run.configuration.model.id !== expectedModel.id
    ) {
      throw new Error("Workflow experiment source Run model is invalid");
    }
    const reused = run.source === "workflow_reuse";
    const started = matchingNodeEvent(
      events,
      "workflow.node.started",
      sourcePlan.id,
      node.id,
      run.id,
    );
    const attempt = validateSourceStartedEvent(
      started,
      sourceManifestSha256,
      node,
      inputSha256,
      reused,
    );
    const output = await ledger.nodeOutput(
      {
        threadId: sourceThreadId,
        manifest,
        plan: sourcePlan,
      },
      node,
      run.id,
      inputSha256,
      input,
    );
    const outputSha256 = sha256(canonicalJson(output));
    const completedEvent = matchingNodeEvent(
      events,
      "workflow.node.completed",
      sourcePlan.id,
      node.id,
      run.id,
    );
    validateSourceCompletedEvent(
      completedEvent,
      sourceManifestSha256,
      node,
      attempt,
      inputSha256,
      outputSha256,
      reused,
    );
    if (reused) {
      validateSourceReuseEvent(
        matchingNodeEvent(
          events,
          "workflow.node.reused",
          sourcePlan.id,
          node.id,
          run.id,
        ),
        sourceManifestSha256,
        inputSha256,
        outputSha256,
      );
    }
    outputs.set(node.id, structuredClone(output));
    completedNodes.set(node.id, {
      nodeId: node.id,
      output: structuredClone(output),
      sourceThreadId,
      sourcePlanId: sourcePlan.id,
      sourceStatus: "completed",
      sourceRunId: run.id,
      sourceAttempt: attempt,
      sourceInputSha256: inputSha256,
      sourceOutputSha256: outputSha256,
    });
  }
  return {
    input: structuredClone(start.input),
    agentId: start.agentId,
    agentRevision: start.agentRevision,
    events,
    completedNodes,
  };
}

function normalizedModelOverrides(
  manifest: ExecutionPlanWorkflowManifest,
  rerunNodeIds: ReadonlySet<string>,
  overrides: Record<string, { provider: string; id: string }>,
): Record<string, { provider: string; id: string }> {
  const output: Record<string, { provider: string; id: string }> = {};
  for (const node of manifest.nodes) {
    const model = overrides[node.id];
    if (!model) continue;
    if (!rerunNodeIds.has(node.id)) {
      throw new Error(
        `Workflow experiment cannot override a reused node model: ${node.id}`,
      );
    }
    if (node.type !== "agent" && node.type !== "map" && node.type !== "loop") {
      throw new Error(
        `Workflow experiment cannot override a non-Agent node model: ${node.id}`,
      );
    }
    output[node.id] = structuredClone(model);
  }
  if (Object.keys(output).length !== Object.keys(overrides).length) {
    throw new Error("Workflow experiment model override node is invalid");
  }
  return output;
}

function experimentNodeToolEffects(
  events: RunEvent[],
  planId: string,
  nodeId: string,
): ExecutionPlanWorkflowExperimentToolEffects {
  const started = events.filter(
    (event) =>
      event.type === "workflow.node.started" &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  const runIds = [...new Set(started.map((event) => event.runId))];
  const mapItemRunIds = events
    .filter(
      (event) =>
        event.type === "workflow.map.item.started" &&
        record(event.payload)?.["planId"] === planId &&
        record(event.payload)?.["nodeId"] === nodeId,
    )
    .map((event) => event.runId);
  const loopIterationRunIds = events
    .filter(
      (event) =>
        event.type === "workflow.loop.iteration.started" &&
        record(event.payload)?.["planId"] === planId &&
        record(event.payload)?.["nodeId"] === nodeId,
    )
    .map((event) => event.runId);
  const observationRunIds = [
    ...new Set([...runIds, ...mapItemRunIds, ...loopIterationRunIds]),
  ];
  const observations = observationRunIds.flatMap((runId) =>
    collectRunToolEffectObservations(
      events.filter((event) => event.runId === runId),
    ),
  );
  const writeToolNames = canonicalNames(
    observations
      .filter((observation) => observation.effect === "write")
      .map((observation) => observation.toolName),
  );
  const unknownToolNames = canonicalNames(
    observations
      .filter(
        (observation) =>
          observation.effect === "unknown" || observation.unresolved,
      )
      .map((observation) => observation.toolName),
  );
  return {
    nodeId,
    attemptCount: started.length,
    toolCallCount: observations.length,
    readOnlyCount: observations.filter(
      (observation) => observation.effect === "read",
    ).length,
    writeCount: observations.filter(
      (observation) => observation.effect === "write",
    ).length,
    unknownCount: observations.filter(
      (observation) => observation.effect === "unknown",
    ).length,
    unresolvedCount: observations.filter(
      (observation) => observation.unresolved,
    ).length,
    writeToolNames,
    unknownToolNames,
  };
}

function matchingNodeEvent(
  events: RunEvent[],
  type: string,
  planId: string,
  nodeId: string,
  runId: string,
): RunEvent {
  const matches = events.filter(
    (event) =>
      event.type === type &&
      event.runId === runId &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  if (matches.length !== 1) {
    throw new Error(`Workflow experiment source ${type} evidence is ambiguous`);
  }
  return matches[0]!;
}

function validateSourceStartedEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  inputSha256: string,
  reused: boolean,
): number {
  const payload = record(event.payload);
  const attempt = payload?.["attempt"];
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["inputSchemaSha256"] !== workflowSchemaSha256(node.inputSchema) ||
    payload["outputSchemaSha256"] !== workflowSchemaSha256(node.outputSchema) ||
    !sourceNodeMetadataMatches(node, payload) ||
    !Number.isSafeInteger(attempt) ||
    Number(attempt) < 1 ||
    Number(attempt) > node.maxAttempts ||
    Boolean(payload["reused"]) !== reused
  ) {
    throw new Error("Workflow experiment source start evidence mismatch");
  }
  return Number(attempt);
}

function validateSourceCompletedEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  attempt: number,
  inputSha256: string,
  outputSha256: string,
  reused: boolean,
): void {
  const payload = record(event.payload);
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["attempt"] !== attempt ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["inputSchemaSha256"] !== workflowSchemaSha256(node.inputSchema) ||
    payload["outputSchemaSha256"] !== workflowSchemaSha256(node.outputSchema) ||
    !sourceNodeMetadataMatches(node, payload) ||
    typeof payload["recovered"] !== "boolean" ||
    Boolean(payload["reused"]) !== reused
  ) {
    throw new Error("Workflow experiment source completion evidence mismatch");
  }
}

function validateSourceReuseEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  inputSha256: string,
  outputSha256: string,
): void {
  const payload = record(event.payload);
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["sourceInputSha256"] !== inputSha256 ||
    typeof payload["sourceThreadId"] !== "string" ||
    typeof payload["sourcePlanId"] !== "string" ||
    typeof payload["sourceRunId"] !== "string" ||
    !Number.isSafeInteger(payload["sourceAttempt"]) ||
    Number(payload["sourceAttempt"]) < 1
  ) {
    throw new Error("Workflow experiment source reuse evidence mismatch");
  }
}

function validateSourceSkippedReuseEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  sourceManifestSha256: string,
  inputSha256: string,
  outputSha256: string,
): void {
  const matches = events.filter(
    (event) =>
      event.type === "workflow.node.reused" &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  const payload =
    matches.length === 1 ? record(matches[0]!.payload) : undefined;
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["sourceInputSha256"] !== inputSha256 ||
    payload["sourceStatus"] !== "skipped" ||
    payload["sourceAttempt"] !== 0 ||
    payload["sourceRunId"] !== undefined ||
    typeof payload["sourceThreadId"] !== "string" ||
    typeof payload["sourcePlanId"] !== "string"
  ) {
    throw new Error("Workflow experiment source skipped reuse mismatch");
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sourceNodeMetadataMatches(
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  payload: Record<string, unknown>,
): boolean {
  if (
    node.when
      ? payload["conditionSha256"] !==
          executionPlanWorkflowConditionSha256(node.when) ||
        payload["skipOutputSha256"] !== sha256(canonicalJson(node.skipOutput!))
      : payload["conditionSha256"] !== undefined ||
        payload["skipOutputSha256"] !== undefined
  ) {
    return false;
  }
  if (node.type === "tool") {
    return (
      payload["nodeType"] === "tool" &&
      payload["toolName"] === node.tool &&
      payload["effect"] === node.effect
    );
  }
  if (node.type === "approval") {
    return (
      payload["nodeType"] === "approval" &&
      payload["questionSha256"] === sha256(node.question)
    );
  }
  if (node.type === "deterministic") {
    return (
      payload["nodeType"] === "deterministic" &&
      payload["templateSha256"] ===
        executionPlanWorkflowDeterministicTemplateSha256(node.template)
    );
  }
  if (node.type === "map") {
    return (
      payload["nodeType"] === "map" &&
      payload["mapConfigurationSha256"] ===
        workflowMapNodeConfigurationSha256(node)
    );
  }
  if (node.type === "loop") {
    return (
      payload["nodeType"] === "loop" &&
      payload["loopConfigurationSha256"] ===
        workflowLoopNodeConfigurationSha256(node)
    );
  }
  if (node.type === "reduce") {
    return (
      payload["nodeType"] === "reduce" &&
      payload["reduceConfigurationSha256"] ===
        workflowReduceConfigurationSha256(node)
    );
  }
  return payload["nodeType"] === undefined || payload["nodeType"] === "agent";
}

function canonicalNames(values: string[]): string[] {
  return [...new Set(values)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 64);
}

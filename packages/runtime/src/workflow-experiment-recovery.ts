import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExperimentLineage,
  WorkflowReusedNode,
  WorkflowSimulatedNode,
} from "./workflow-context.js";
import { projectExecutionPlanWorkflowSourceEvidence } from "./workflow-experiment-source.js";
import { projectWorkflowExperimentExecution } from "./workflow-experiment-mode.js";
import { isWorkflowRecord } from "./workflow-ledger.js";
import { WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT } from "./workflow-simulation-evidence.js";
import {
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface RecoveredWorkflowExperimentTarget {
  lineage?: WorkflowExperimentLineage;
  reusedNodes: WorkflowReusedNode[];
  simulatedNodes: WorkflowSimulatedNode[];
}

export async function recoverExecutionPlanWorkflowExperimentTarget(
  store: LocalStore,
  targetThreadId: string,
  targetPlan: ExecutionPlan,
  candidateManifest: ExecutionPlanWorkflowManifest,
  targetInput: JsonValue,
  targetAgentId: string,
  targetAgentRevision: number,
  targetBreakBeforeNodeIds: string[],
): Promise<RecoveredWorkflowExperimentTarget> {
  const events = await store.listEvents(targetThreadId);
  const matches = events.filter(
    (event) =>
      event.type === "workflow.experiment.started" &&
      isWorkflowRecord(event.payload) &&
      event.payload["planId"] === targetPlan.id,
  );
  if (matches.length === 0) {
    return { reusedNodes: [], simulatedNodes: [] };
  }
  if (matches.length !== 1) {
    throw new Error("Workflow experiment target evidence is ambiguous");
  }
  const lineage = validateExperimentLineage(
    matches[0]!,
    targetPlan,
    candidateManifest,
    targetBreakBeforeNodeIds,
  );
  const simulatedNodes = recoverSimulatedNodes(
    events,
    lineage,
    candidateManifest,
    targetPlan.id,
  );
  const incompleteNodeIds = lineage.reusedNodeIds.filter(
    (nodeId) =>
      targetPlan.steps.find((step) => step.id === nodeId)?.status !==
      "completed",
  );
  if (incompleteNodeIds.length === 0) {
    return { lineage, reusedNodes: [], simulatedNodes };
  }

  const sourcePlan = store.getPlan(lineage.sourcePlanId);
  if (
    sourcePlan.threadId !== lineage.sourceThreadId ||
    sourcePlan.revision !== lineage.sourcePlanRevision ||
    sourcePlan.steps.some((step) => step.status === "running")
  ) {
    throw new Error(
      "Workflow experiment source changed before target recovery",
    );
  }
  const source = await projectExecutionPlanWorkflowSourceEvidence(
    store,
    lineage.sourceThreadId,
    sourcePlan,
    candidateManifest,
    lineage.sourceManifestSha256,
    new Set(lineage.reusedNodeIds),
  );
  if (
    source.agentId !== targetAgentId ||
    source.agentRevision !== targetAgentRevision ||
    sha256(canonicalJson(source.input)) !== sha256(canonicalJson(targetInput))
  ) {
    throw new Error("Workflow experiment recovery source binding is invalid");
  }
  return {
    lineage,
    simulatedNodes,
    reusedNodes: incompleteNodeIds.map((nodeId) => {
      const node = source.completedNodes.get(nodeId);
      if (!node) {
        throw new Error(
          `Workflow experiment cannot recover incomplete reuse: ${nodeId}`,
        );
      }
      return node;
    }),
  };
}

function validateExperimentLineage(
  event: RunEvent,
  targetPlan: ExecutionPlan,
  candidateManifest: ExecutionPlanWorkflowManifest,
  targetBreakBeforeNodeIds: string[],
): WorkflowExperimentLineage {
  const payload = isWorkflowRecord(event.payload) ? event.payload : undefined;
  const reusedNodeIds = nodeIds(payload?.["reusedNodeIds"]);
  const rerunNodeIds = nodeIds(payload?.["rerunNodeIds"]);
  const executionNodeIds = nodeIds(payload?.["executionNodeIds"]);
  const stopBeforeNodeIds = nodeIds(payload?.["stopBeforeNodeIds"]);
  const executionMode = payload?.["executionMode"];
  const simulationNodeId = payload?.["simulationNodeId"];
  const simulatedOutputSha256 = payload?.["simulatedOutputSha256"];
  const simulatedOutputBytes = payload?.["simulatedOutputBytes"];
  const fromNodeId = payload?.["fromNodeId"];
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["planId"] !== targetPlan.id ||
    payload["manifestSha256"] !== candidateManifest.contentSha256 ||
    typeof payload["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(payload["sourceThreadId"]) ||
    typeof payload["sourcePlanId"] !== "string" ||
    !PLAN_ID.test(payload["sourcePlanId"]) ||
    !positiveInteger(payload["sourcePlanRevision"]) ||
    typeof payload["sourceManifestSha256"] !== "string" ||
    !HASH.test(payload["sourceManifestSha256"]) ||
    typeof fromNodeId !== "string" ||
    !NODE_ID.test(fromNodeId) ||
    !reusedNodeIds ||
    !rerunNodeIds ||
    typeof payload["previewSha256"] !== "string" ||
    !HASH.test(payload["previewSha256"]) ||
    typeof payload["sideEffectsConfirmed"] !== "boolean" ||
    (executionMode !== undefined &&
      executionMode !== "single_node" &&
      executionMode !== "simulate_node") ||
    (executionMode === "single_node"
      ? executionNodeIds === undefined || stopBeforeNodeIds === undefined
      : executionMode === "simulate_node"
        ? executionNodeIds === undefined ||
          stopBeforeNodeIds !== undefined ||
          simulationNodeId !== fromNodeId ||
          typeof simulatedOutputSha256 !== "string" ||
          !HASH.test(simulatedOutputSha256) ||
          !positiveInteger(simulatedOutputBytes)
        : executionNodeIds !== undefined ||
          stopBeforeNodeIds !== undefined ||
          simulationNodeId !== undefined ||
          simulatedOutputSha256 !== undefined ||
          simulatedOutputBytes !== undefined)
  ) {
    throw new Error("Workflow experiment target evidence is invalid");
  }
  const execution = projectWorkflowExperimentExecution(
    candidateManifest,
    fromNodeId,
    executionMode === "single_node" || executionMode === "simulate_node"
      ? executionMode
      : "subgraph",
  );
  const expectedReusedNodeIds = candidateManifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => !execution.rerunNodeIds.includes(nodeId));
  if (
    canonicalJson(reusedNodeIds) !== canonicalJson(expectedReusedNodeIds) ||
    canonicalJson(rerunNodeIds) !== canonicalJson(execution.rerunNodeIds) ||
    canonicalJson(targetBreakBeforeNodeIds) !==
      canonicalJson(execution.stopBeforeNodeIds) ||
    ((executionMode === "single_node" || executionMode === "simulate_node") &&
      canonicalJson(executionNodeIds) !==
        canonicalJson(execution.executionNodeIds)) ||
    (executionMode === "single_node" &&
      canonicalJson(stopBeforeNodeIds) !==
        canonicalJson(execution.stopBeforeNodeIds))
  ) {
    throw new Error("Workflow experiment target node sets are invalid");
  }
  return {
    sourceThreadId: payload["sourceThreadId"],
    sourcePlanId: payload["sourcePlanId"],
    sourcePlanRevision: Number(payload["sourcePlanRevision"]),
    sourceManifestSha256: payload["sourceManifestSha256"],
    fromNodeId,
    reusedNodeIds,
    rerunNodeIds,
    previewSha256: payload["previewSha256"],
    sideEffectsConfirmed: payload["sideEffectsConfirmed"],
    ...(executionMode === "single_node"
      ? {
          executionMode,
          executionNodeIds: executionNodeIds!,
          stopBeforeNodeIds: stopBeforeNodeIds!,
        }
      : executionMode === "simulate_node"
        ? {
            executionMode,
            executionNodeIds: executionNodeIds!,
            simulationNodeId: simulationNodeId as string,
            simulatedOutputSha256: simulatedOutputSha256 as string,
            simulatedOutputBytes: Number(simulatedOutputBytes),
          }
        : {}),
  };
}

function recoverSimulatedNodes(
  events: RunEvent[],
  lineage: WorkflowExperimentLineage,
  manifest: ExecutionPlanWorkflowManifest,
  planId: string,
): WorkflowSimulatedNode[] {
  if (lineage.executionMode !== "simulate_node") return [];
  const node = manifest.nodes.find(
    (candidate) => candidate.id === lineage.simulationNodeId,
  );
  const matches = events.filter(
    (event) =>
      event.type === WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT &&
      isWorkflowRecord(event.payload) &&
      event.payload["planId"] === planId,
  );
  const event = matches.length === 1 ? matches[0] : undefined;
  const payload =
    event && isWorkflowRecord(event.payload) ? event.payload : undefined;
  if (
    !node ||
    !event ||
    event.visibility !== "hidden" ||
    !payload ||
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== manifest.contentSha256 ||
    payload["nodeId"] !== node.id ||
    payload["outputSha256"] !== lineage.simulatedOutputSha256 ||
    payload["outputBytes"] !== lineage.simulatedOutputBytes ||
    payload["outputSchemaSha256"] !== workflowSchemaSha256(node.outputSchema) ||
    payload["output"] === undefined
  ) {
    throw new Error("Workflow simulation recovery evidence is invalid");
  }
  assertWorkflowValue(
    node.outputSchema,
    payload["output"],
    `Workflow simulated output ${node.id}`,
    MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  );
  const output = structuredClone(payload["output"]);
  const encoded = canonicalJson(output);
  if (
    sha256(encoded) !== lineage.simulatedOutputSha256 ||
    Buffer.byteLength(encoded, "utf8") !== lineage.simulatedOutputBytes
  ) {
    throw new Error("Workflow simulation recovery output is invalid");
  }
  return [
    {
      nodeId: node.id,
      output,
      outputSha256: lineage.simulatedOutputSha256,
      outputBytes: lineage.simulatedOutputBytes,
    },
  ];
}

function nodeIds(value: JsonValue | undefined): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some(
      (nodeId) => typeof nodeId !== "string" || !NODE_ID.test(nodeId),
    ) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return [...value] as string[];
}

function positiveInteger(value: JsonValue | undefined): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

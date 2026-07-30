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
} from "./workflow-context.js";
import {
  projectExecutionPlanWorkflowSourceEvidence,
  workflowExperimentRerunNodeIds,
} from "./workflow-experiment-source.js";
import { isWorkflowRecord } from "./workflow-ledger.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface RecoveredWorkflowExperimentTarget {
  lineage?: WorkflowExperimentLineage;
  reusedNodes: WorkflowReusedNode[];
}

export async function recoverExecutionPlanWorkflowExperimentTarget(
  store: LocalStore,
  targetThreadId: string,
  targetPlan: ExecutionPlan,
  candidateManifest: ExecutionPlanWorkflowManifest,
  targetInput: JsonValue,
  targetAgentId: string,
  targetAgentRevision: number,
): Promise<RecoveredWorkflowExperimentTarget> {
  const events = await store.listEvents(targetThreadId);
  const matches = events.filter(
    (event) =>
      event.type === "workflow.experiment.started" &&
      isWorkflowRecord(event.payload) &&
      event.payload["planId"] === targetPlan.id,
  );
  if (matches.length === 0) return { reusedNodes: [] };
  if (matches.length !== 1) {
    throw new Error("Workflow experiment target evidence is ambiguous");
  }
  const lineage = validateExperimentLineage(
    matches[0]!,
    targetPlan,
    candidateManifest,
  );
  const incompleteNodeIds = lineage.reusedNodeIds.filter(
    (nodeId) =>
      targetPlan.steps.find((step) => step.id === nodeId)?.status !==
      "completed",
  );
  if (incompleteNodeIds.length === 0) {
    return { lineage, reusedNodes: [] };
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
): WorkflowExperimentLineage {
  const payload = isWorkflowRecord(event.payload) ? event.payload : undefined;
  const reusedNodeIds = nodeIds(payload?.["reusedNodeIds"]);
  const rerunNodeIds = nodeIds(payload?.["rerunNodeIds"]);
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
    typeof payload["sideEffectsConfirmed"] !== "boolean"
  ) {
    throw new Error("Workflow experiment target evidence is invalid");
  }
  const expectedRerunNodeIds = workflowExperimentRerunNodeIds(
    candidateManifest,
    fromNodeId,
  );
  const expectedReusedNodeIds = candidateManifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => !expectedRerunNodeIds.includes(nodeId));
  if (
    canonicalJson(reusedNodeIds) !== canonicalJson(expectedReusedNodeIds) ||
    canonicalJson(rerunNodeIds) !== canonicalJson(expectedRerunNodeIds)
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
  };
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

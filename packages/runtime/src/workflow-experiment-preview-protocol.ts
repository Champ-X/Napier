import type {
  ExecutionPlanWorkflowExperimentPreview,
  JsonValue,
  ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  validateWorkflowExperimentPreviewMode,
  validWorkflowExperimentPreviewSchemaVersion,
  workflowExperimentNodeIdList,
  workflowExperimentPreviewModeKeys,
} from "./workflow-experiment-preview-mode.js";
import {
  assertEncodedBytes,
  assertExactKeys,
  hash,
  PLAN_ID,
  positiveInteger,
  record,
  RESOURCE_ID,
  THREAD_ID,
  validateToolEffects,
} from "./workflow-experiment-protocol-primitives.js";
import { MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES } from "./workflow-protocol.js";

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

export function validateExecutionPlanWorkflowExperimentPreview(
  input: unknown,
): ExecutionPlanWorkflowExperimentPreview {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
    "Workflow experiment preview",
  );
  const preview = record(input, "Workflow experiment preview");
  const schemaVersion = preview["schemaVersion"];
  assertExactKeys(
    preview,
    [
      "kind",
      "schemaVersion",
      "sourceThreadId",
      "sourcePlanId",
      "sourcePlanRevision",
      "sourceManifestSha256",
      "candidateManifestSha256",
      "sourceAgentId",
      "sourceAgentRevision",
      "fromNodeId",
      "reusedNodeIds",
      "rerunNodeIds",
      "modelOverrides",
      "toolEffects",
      "requiresSideEffectConfirmation",
      "previewSha256",
      ...workflowExperimentPreviewModeKeys(schemaVersion),
    ],
    schemaVersion === 6 ? new Set(["fromNodeId"]) : undefined,
  );
  assertPreviewEnvelope(preview, schemaVersion);
  const reusedNodeIds = workflowExperimentNodeIdList(
    preview["reusedNodeIds"],
    "reused",
  );
  const rerunNodeIds = workflowExperimentNodeIdList(
    preview["rerunNodeIds"],
    "rerun",
  );
  const { executionNodeIds, toolEffectNodeIds } =
    validateWorkflowExperimentPreviewMode(preview, rerunNodeIds);
  assertPreviewNodeSets(preview, reusedNodeIds, rerunNodeIds);
  assertPreviewOverrides(preview, executionNodeIds);
  assertPreviewToolEffects(preview, toolEffectNodeIds);
  const { previewSha256: _previewSha256, ...content } = preview;
  if (
    sha256(canonicalJson(content as JsonValue)) !== preview["previewSha256"]
  ) {
    throw new Error("Workflow experiment preview hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowExperimentPreview;
}

function assertPreviewEnvelope(
  preview: Record<string, unknown>,
  schemaVersion: unknown,
): void {
  if (
    preview["kind"] !== "napier.execution-plan-workflow-experiment-preview" ||
    !validWorkflowExperimentPreviewSchemaVersion(schemaVersion) ||
    typeof preview["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(preview["sourceThreadId"]) ||
    typeof preview["sourcePlanId"] !== "string" ||
    !PLAN_ID.test(preview["sourcePlanId"]) ||
    !positiveInteger(preview["sourcePlanRevision"]) ||
    !hash(preview["sourceManifestSha256"]) ||
    !hash(preview["candidateManifestSha256"]) ||
    typeof preview["sourceAgentId"] !== "string" ||
    !/^agent_[a-z0-9_]{2,80}$/u.test(preview["sourceAgentId"]) ||
    !positiveInteger(preview["sourceAgentRevision"]) ||
    (schemaVersion === 6
      ? preview["fromNodeId"] !== undefined
      : typeof preview["fromNodeId"] !== "string" ||
        !RESOURCE_ID.test(preview["fromNodeId"])) ||
    typeof preview["requiresSideEffectConfirmation"] !== "boolean" ||
    !hash(preview["previewSha256"])
  ) {
    throw new Error("Workflow experiment preview is invalid");
  }
}

function assertPreviewNodeSets(
  preview: Record<string, unknown>,
  reusedNodeIds: string[],
  rerunNodeIds: string[],
): void {
  if (
    rerunNodeIds.length < 1 ||
    (preview["schemaVersion"] !== 6 &&
      (typeof preview["fromNodeId"] !== "string" ||
        !rerunNodeIds.includes(preview["fromNodeId"]))) ||
    reusedNodeIds.some((nodeId) => rerunNodeIds.includes(nodeId))
  ) {
    throw new Error("Workflow experiment node sets are invalid");
  }
}

function assertPreviewOverrides(
  preview: Record<string, unknown>,
  executionNodeIds: string[],
): void {
  const modelOverrides = validateModelOverrides(preview["modelOverrides"]);
  if (
    Object.keys(modelOverrides).some(
      (nodeId) => !executionNodeIds.includes(nodeId),
    )
  ) {
    throw new Error("Workflow experiment model overrides are invalid");
  }
}

function assertPreviewToolEffects(
  preview: Record<string, unknown>,
  toolEffectNodeIds: string[],
): void {
  if (!Array.isArray(preview["toolEffects"])) {
    throw new Error("Workflow experiment tool effects are invalid");
  }
  const toolEffects = preview["toolEffects"].map((value, index) =>
    validateToolEffects(value, index),
  );
  if (
    canonicalJson(toolEffects.map((effects) => effects.nodeId)) !==
      canonicalJson(toolEffectNodeIds) ||
    Boolean(preview["requiresSideEffectConfirmation"]) !==
      toolEffects.some(
        (effects) =>
          effects.writeCount > 0 ||
          effects.unknownCount > 0 ||
          effects.unresolvedCount > 0,
      )
  ) {
    throw new Error("Workflow experiment tool effect binding is invalid");
  }
}

export function validateModelOverrides(
  input: unknown,
): Record<string, ModelRef> {
  const overrides = record(input, "Workflow experiment model overrides");
  if (Object.keys(overrides).length > 30) {
    throw new Error("Workflow experiment has too many model overrides");
  }
  const output: Record<string, ModelRef> = {};
  for (const [nodeId, modelInput] of Object.entries(overrides)) {
    if (!RESOURCE_ID.test(nodeId)) {
      throw new Error("Workflow experiment model override node is invalid");
    }
    const model = record(modelInput, "Workflow experiment model override");
    assertExactKeys(model, ["provider", "id"]);
    if (
      typeof model["provider"] !== "string" ||
      !PROVIDER_ID.test(model["provider"]) ||
      typeof model["id"] !== "string" ||
      !MODEL_ID.test(model["id"])
    ) {
      throw new Error("Workflow experiment model override is invalid");
    }
    output[nodeId] = { provider: model["provider"], id: model["id"] };
  }
  return output;
}

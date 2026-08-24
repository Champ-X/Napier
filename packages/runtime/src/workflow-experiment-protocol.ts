import type { CreateExecutionPlanWorkflowExperimentRequest } from "@napier/contracts";

import { validateModelOverrides } from "./workflow-experiment-preview-protocol.js";
import {
  assertEncodedBytes,
  assertExactKeys,
  hash,
  PLAN_ID,
  record,
  RESOURCE_ID,
} from "./workflow-experiment-protocol-primitives.js";
import { validateWorkflowExperimentReplacementInput } from "./workflow-input-override.js";
import { validateExecutionPlanWorkflowManifest } from "./workflow-manifests.js";
import { MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES } from "./workflow-protocol.js";
import {
  assertWorkflowJsonValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
} from "./workflow-schemas.js";
import { validateWorkflowExperimentReplacementWorkflowInput } from "./workflow-top-level-input-override.js";

export { validateExecutionPlanWorkflowExperimentPreview } from "./workflow-experiment-preview-protocol.js";
export {
  createExecutionPlanWorkflowExperimentResultFrame,
  validateExecutionPlanWorkflowExperimentResult,
  validateExecutionPlanWorkflowExperimentResultFrame,
} from "./workflow-experiment-result-protocol.js";

export function validateCreateExecutionPlanWorkflowExperimentRequest(
  input: unknown,
): CreateExecutionPlanWorkflowExperimentRequest {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
    "Workflow experiment request",
  );
  const request = record(input, "Workflow experiment request");
  assertExactKeys(
    request,
    [
      "manifest",
      "planId",
      "fromNodeId",
      "mode",
      "simulatedOutput",
      "replacementInput",
      "replacementWorkflowInput",
      "title",
      "modelOverrides",
      "confirmSideEffects",
      "expectedPreviewSha256",
    ],
    new Set([
      "fromNodeId",
      "title",
      "mode",
      "simulatedOutput",
      "replacementInput",
      "replacementWorkflowInput",
      "modelOverrides",
      "confirmSideEffects",
      "expectedPreviewSha256",
    ]),
  );
  const manifest = validateExecutionPlanWorkflowManifest(request["manifest"]);
  if (
    typeof request["planId"] !== "string" ||
    !PLAN_ID.test(request["planId"])
  ) {
    throw new Error("Workflow experiment source is invalid");
  }
  const title =
    request["title"] === undefined
      ? undefined
      : normalizeTitle(request["title"]);
  const mode = request["mode"];
  if (
    mode !== undefined &&
    mode !== "subgraph" &&
    mode !== "single_node" &&
    mode !== "step_nodes" &&
    mode !== "simulate_node" &&
    mode !== "replace_input" &&
    mode !== "replace_workflow_input"
  ) {
    throw new Error("Workflow experiment mode is invalid");
  }
  const fromNodeId = request["fromNodeId"];
  if (
    mode === "replace_workflow_input"
      ? fromNodeId !== undefined
      : typeof fromNodeId !== "string" || !RESOURCE_ID.test(fromNodeId)
  ) {
    throw new Error("Workflow experiment source is invalid");
  }
  const simulatedOutput = request["simulatedOutput"];
  if (
    (mode === "simulate_node" && simulatedOutput === undefined) ||
    (mode !== "simulate_node" && simulatedOutput !== undefined)
  ) {
    throw new Error(
      "Workflow experiment simulated output requires simulate-node mode",
    );
  }
  const replacementInput = validateWorkflowExperimentReplacementInput(
    mode,
    request["replacementInput"],
  );
  const replacementWorkflowInput =
    validateWorkflowExperimentReplacementWorkflowInput(
      mode,
      request["replacementWorkflowInput"],
    );
  if (simulatedOutput !== undefined) {
    assertWorkflowJsonValue(
      simulatedOutput,
      "Workflow experiment simulated output",
      MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
    );
  }
  const modelOverrides =
    request["modelOverrides"] === undefined
      ? undefined
      : validateModelOverrides(request["modelOverrides"]);
  if (
    request["confirmSideEffects"] !== undefined &&
    typeof request["confirmSideEffects"] !== "boolean"
  ) {
    throw new Error("Workflow experiment confirmation is invalid");
  }
  const expectedPreviewSha256 = request["expectedPreviewSha256"];
  if (expectedPreviewSha256 !== undefined && !hash(expectedPreviewSha256)) {
    throw new Error("Workflow experiment preview hash is invalid");
  }
  if (request["confirmSideEffects"] === true && !expectedPreviewSha256) {
    throw new Error(
      "Workflow experiment confirmation requires an expected preview hash",
    );
  }
  return {
    manifest,
    planId: request["planId"],
    ...(typeof fromNodeId === "string" ? { fromNodeId } : {}),
    ...(mode === "single_node" ||
    mode === "step_nodes" ||
    mode === "simulate_node" ||
    mode === "replace_input" ||
    mode === "replace_workflow_input"
      ? { mode }
      : {}),
    ...(simulatedOutput !== undefined
      ? { simulatedOutput: structuredClone(simulatedOutput) }
      : {}),
    ...(replacementInput !== undefined ? { replacementInput } : {}),
    ...(replacementWorkflowInput !== undefined
      ? { replacementWorkflowInput }
      : {}),
    ...(title ? { title } : {}),
    ...(modelOverrides ? { modelOverrides } : {}),
    ...(request["confirmSideEffects"] === true
      ? { confirmSideEffects: true }
      : {}),
    ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
  };
}

function normalizeTitle(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Workflow experiment title is invalid");
  }
  const title = input.replace(/\s+/gu, " ").trim();
  if (!title || title.length > 100) {
    throw new Error("Workflow experiment title is invalid");
  }
  return title;
}

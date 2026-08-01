import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowExperimentToolEffects,
  JsonValue,
  ModelRef,
  StreamFrame,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertExecutionPlanWorkflowExperimentComparisonBinding,
  MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES,
  validateExecutionPlanWorkflowExperimentComparison,
} from "./workflow-experiment-comparison-protocol.js";
import {
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
  validateExecutionPlanWorkflowResult,
} from "./workflow-protocol.js";
import {
  defineExecutionPlanWorkflow,
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";

const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const MAX_WORKFLOW_EXPERIMENT_RESULT_BYTES =
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES * 2 +
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES +
  MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES +
  256 * 1024;
const MAX_WORKFLOW_EXPERIMENT_FRAME_BYTES =
  MAX_WORKFLOW_EXPERIMENT_RESULT_BYTES + 256 * 1024;

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
      "title",
      "modelOverrides",
      "confirmSideEffects",
      "expectedPreviewSha256",
    ],
    new Set([
      "title",
      "modelOverrides",
      "confirmSideEffects",
      "expectedPreviewSha256",
    ]),
  );
  const manifest = validateExecutionPlanWorkflowManifest(request["manifest"]);
  if (
    typeof request["planId"] !== "string" ||
    !PLAN_ID.test(request["planId"]) ||
    typeof request["fromNodeId"] !== "string" ||
    !RESOURCE_ID.test(request["fromNodeId"])
  ) {
    throw new Error("Workflow experiment source is invalid");
  }
  const title =
    request["title"] === undefined
      ? undefined
      : normalizeTitle(request["title"]);
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
    fromNodeId: request["fromNodeId"],
    ...(title ? { title } : {}),
    ...(modelOverrides ? { modelOverrides } : {}),
    ...(request["confirmSideEffects"] === true
      ? { confirmSideEffects: true }
      : {}),
    ...(expectedPreviewSha256 ? { expectedPreviewSha256 } : {}),
  };
}

export function validateExecutionPlanWorkflowExperimentPreview(
  input: unknown,
): ExecutionPlanWorkflowExperimentPreview {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
    "Workflow experiment preview",
  );
  const preview = record(input, "Workflow experiment preview");
  assertExactKeys(preview, [
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
  ]);
  if (
    preview["kind"] !== "napier.execution-plan-workflow-experiment-preview" ||
    preview["schemaVersion"] !== 1 ||
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
    typeof preview["fromNodeId"] !== "string" ||
    !RESOURCE_ID.test(preview["fromNodeId"]) ||
    typeof preview["requiresSideEffectConfirmation"] !== "boolean" ||
    !hash(preview["previewSha256"])
  ) {
    throw new Error("Workflow experiment preview is invalid");
  }
  const reusedNodeIds = nodeIdList(preview["reusedNodeIds"], "reused");
  const rerunNodeIds = nodeIdList(preview["rerunNodeIds"], "rerun");
  if (
    rerunNodeIds.length < 1 ||
    !rerunNodeIds.includes(preview["fromNodeId"]) ||
    reusedNodeIds.some((nodeId) => rerunNodeIds.includes(nodeId))
  ) {
    throw new Error("Workflow experiment node sets are invalid");
  }
  const modelOverrides = validateModelOverrides(preview["modelOverrides"]);
  if (
    Object.keys(modelOverrides).some((nodeId) => !rerunNodeIds.includes(nodeId))
  ) {
    throw new Error("Workflow experiment model overrides are invalid");
  }
  if (!Array.isArray(preview["toolEffects"])) {
    throw new Error("Workflow experiment tool effects are invalid");
  }
  const toolEffects = preview["toolEffects"].map((value, index) =>
    validateToolEffects(value, index),
  );
  if (
    canonicalJson(toolEffects.map((effects) => effects.nodeId)) !==
      canonicalJson(rerunNodeIds) ||
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
  const { previewSha256: _previewSha256, ...content } = preview;
  if (
    sha256(canonicalJson(content as JsonValue)) !== preview["previewSha256"]
  ) {
    throw new Error("Workflow experiment preview hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowExperimentPreview;
}

export function validateExecutionPlanWorkflowExperimentResult(
  input: unknown,
): ExecutionPlanWorkflowExperimentResult {
  assertEncodedBytes(
    input,
    MAX_WORKFLOW_EXPERIMENT_RESULT_BYTES,
    "Workflow experiment result",
  );
  const experiment = record(input, "Workflow experiment result");
  assertExactKeys(
    experiment,
    [
      "kind",
      "schemaVersion",
      "preview",
      "sourceManifest",
      "candidateManifest",
      "targetThreadId",
      "result",
      "comparison",
    ],
    new Set(["comparison"]),
  );
  if (
    experiment["kind"] !== "napier.execution-plan-workflow-experiment-result" ||
    experiment["schemaVersion"] !== 1 ||
    typeof experiment["targetThreadId"] !== "string" ||
    !THREAD_ID.test(experiment["targetThreadId"])
  ) {
    throw new Error("Workflow experiment result is invalid");
  }
  const preview = validateExecutionPlanWorkflowExperimentPreview(
    experiment["preview"],
  );
  const sourceManifest = validateExecutionPlanWorkflowManifest(
    experiment["sourceManifest"],
  );
  const candidateManifest = validateExecutionPlanWorkflowManifest(
    experiment["candidateManifest"],
  );
  const result = validateExecutionPlanWorkflowResult(experiment["result"]);
  const comparison =
    experiment["comparison"] === undefined
      ? undefined
      : validateExecutionPlanWorkflowExperimentComparison(
          experiment["comparison"],
        );
  const manifestNodeIds = candidateManifest.nodes.map((node) => node.id);
  const expectedCandidateManifest = defineExecutionPlanWorkflow({
    name: sourceManifest.name,
    version: sourceManifest.version,
    description: sourceManifest.description,
    blueprint: sourceManifest.blueprint,
    inputSchema: sourceManifest.inputSchema,
    outputSchema: sourceManifest.outputSchema,
    outputNodeId: sourceManifest.outputNodeId,
    nodes: sourceManifest.nodes.map((node) => ({
      ...node,
      ...((node.type === "agent" ||
        node.type === "map" ||
        node.type === "loop") &&
      preview.modelOverrides[node.id]
        ? { model: structuredClone(preview.modelOverrides[node.id]) }
        : {}),
    })),
    ...(sourceManifest.maxConcurrency !== undefined
      ? { maxConcurrency: sourceManifest.maxConcurrency }
      : {}),
    generatedAt: sourceManifest.generatedAt,
  });
  if (
    sourceManifest.contentSha256 !== preview.sourceManifestSha256 ||
    candidateManifest.contentSha256 !== preview.candidateManifestSha256 ||
    candidateManifest.contentSha256 !==
      expectedCandidateManifest.contentSha256 ||
    result.threadId !== experiment["targetThreadId"] ||
    result.manifestSha256 !== candidateManifest.contentSha256 ||
    canonicalJson(
      [...preview.reusedNodeIds, ...preview.rerunNodeIds].sort(),
    ) !== canonicalJson([...manifestNodeIds].sort())
  ) {
    throw new Error("Workflow experiment result binding is invalid");
  }
  if (comparison) {
    assertExecutionPlanWorkflowExperimentComparisonBinding(
      comparison,
      preview,
      sourceManifest,
      candidateManifest,
      result,
    );
  }
  return structuredClone(input) as ExecutionPlanWorkflowExperimentResult;
}

export function createExecutionPlanWorkflowExperimentResultFrame(
  experiment: ExecutionPlanWorkflowExperimentResult,
  snapshot: Extract<StreamFrame, { type: "snapshot" }>,
  eventStreamSha256: string,
): ExecutionPlanWorkflowExperimentResultFrame {
  const validated = validateExecutionPlanWorkflowExperimentResult(experiment);
  if (
    snapshot.detail.thread.id !== validated.targetThreadId ||
    snapshot.detail.thread.eventCount !== snapshot.detail.events.length ||
    !hash(eventStreamSha256)
  ) {
    throw new Error("Workflow experiment snapshot binding is invalid");
  }
  const content = {
    type: "workflow_experiment_result" as const,
    sourceThreadId: validated.preview.sourceThreadId,
    sourcePlanId: validated.preview.sourcePlanId,
    targetThreadId: validated.targetThreadId,
    targetPlanId: validated.result.planId,
    status: validated.result.status,
    previewSha256: validated.preview.previewSha256,
    candidateManifestSha256: validated.candidateManifest.contentSha256,
    experiment: structuredClone(validated),
    snapshotSha256: snapshot.detailSha256,
    snapshotBytes: snapshot.detailBytes,
    eventCount: snapshot.detail.thread.eventCount,
    eventBytes: snapshot.eventBytes,
    eventStreamSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateExecutionPlanWorkflowExperimentResultFrame(
  input: unknown,
): ExecutionPlanWorkflowExperimentResultFrame {
  assertEncodedBytes(
    input,
    MAX_WORKFLOW_EXPERIMENT_FRAME_BYTES,
    "Workflow experiment result frame",
  );
  const frame = record(input, "Workflow experiment result frame");
  assertExactKeys(frame, [
    "type",
    "sourceThreadId",
    "sourcePlanId",
    "targetThreadId",
    "targetPlanId",
    "status",
    "previewSha256",
    "candidateManifestSha256",
    "experiment",
    "snapshotSha256",
    "snapshotBytes",
    "eventCount",
    "eventBytes",
    "eventStreamSha256",
    "contentSha256",
  ]);
  if (
    frame["type"] !== "workflow_experiment_result" ||
    typeof frame["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(frame["sourceThreadId"]) ||
    typeof frame["sourcePlanId"] !== "string" ||
    !PLAN_ID.test(frame["sourcePlanId"]) ||
    typeof frame["targetThreadId"] !== "string" ||
    !THREAD_ID.test(frame["targetThreadId"]) ||
    typeof frame["targetPlanId"] !== "string" ||
    !PLAN_ID.test(frame["targetPlanId"]) ||
    (frame["status"] !== "completed" &&
      frame["status"] !== "waiting" &&
      frame["status"] !== "paused" &&
      frame["status"] !== "blocked" &&
      frame["status"] !== "cancelled") ||
    !hash(frame["previewSha256"]) ||
    !hash(frame["candidateManifestSha256"]) ||
    !hash(frame["snapshotSha256"]) ||
    !hash(frame["eventStreamSha256"]) ||
    !hash(frame["contentSha256"]) ||
    !nonNegativeInteger(frame["snapshotBytes"]) ||
    !nonNegativeInteger(frame["eventCount"]) ||
    !nonNegativeInteger(frame["eventBytes"])
  ) {
    throw new Error("Workflow experiment result frame is invalid");
  }
  const experiment = validateExecutionPlanWorkflowExperimentResult(
    frame["experiment"],
  );
  if (
    experiment.preview.sourceThreadId !== frame["sourceThreadId"] ||
    experiment.preview.sourcePlanId !== frame["sourcePlanId"] ||
    experiment.targetThreadId !== frame["targetThreadId"] ||
    experiment.result.planId !== frame["targetPlanId"] ||
    experiment.result.status !== frame["status"] ||
    experiment.preview.previewSha256 !== frame["previewSha256"] ||
    experiment.candidateManifest.contentSha256 !==
      frame["candidateManifestSha256"]
  ) {
    throw new Error("Workflow experiment result frame binding is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = frame;
  if (sha256(canonicalJson(content as JsonValue)) !== frame["contentSha256"]) {
    throw new Error("Workflow experiment result frame hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowExperimentResultFrame;
}

function validateToolEffects(
  input: unknown,
  index: number,
): ExecutionPlanWorkflowExperimentToolEffects {
  const effects = record(
    input,
    `Workflow experiment tool effects ${String(index + 1)}`,
  );
  assertExactKeys(effects, [
    "nodeId",
    "attemptCount",
    "toolCallCount",
    "readOnlyCount",
    "writeCount",
    "unknownCount",
    "unresolvedCount",
    "writeToolNames",
    "unknownToolNames",
  ]);
  if (
    typeof effects["nodeId"] !== "string" ||
    !RESOURCE_ID.test(effects["nodeId"])
  ) {
    throw new Error("Workflow experiment tool effect node is invalid");
  }
  for (const key of [
    "attemptCount",
    "toolCallCount",
    "readOnlyCount",
    "writeCount",
    "unknownCount",
    "unresolvedCount",
  ]) {
    if (!nonNegativeInteger(effects[key])) {
      throw new Error("Workflow experiment tool effect count is invalid");
    }
  }
  if (
    Number(effects["toolCallCount"]) !==
      Number(effects["readOnlyCount"]) +
        Number(effects["writeCount"]) +
        Number(effects["unknownCount"]) ||
    Number(effects["unresolvedCount"]) > Number(effects["toolCallCount"])
  ) {
    throw new Error("Workflow experiment tool effect counts conflict");
  }
  return {
    nodeId: effects["nodeId"],
    attemptCount: Number(effects["attemptCount"]),
    toolCallCount: Number(effects["toolCallCount"]),
    readOnlyCount: Number(effects["readOnlyCount"]),
    writeCount: Number(effects["writeCount"]),
    unknownCount: Number(effects["unknownCount"]),
    unresolvedCount: Number(effects["unresolvedCount"]),
    writeToolNames: toolNameList(effects["writeToolNames"]),
    unknownToolNames: toolNameList(effects["unknownToolNames"]),
  };
}

function validateModelOverrides(input: unknown): Record<string, ModelRef> {
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

function nodeIdList(input: unknown, label: string): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 30 ||
    input.some(
      (value) => typeof value !== "string" || !RESOURCE_ID.test(value),
    ) ||
    new Set(input).size !== input.length
  ) {
    throw new Error(`Workflow experiment ${label} node IDs are invalid`);
  }
  return [...input] as string[];
}

function toolNameList(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 64 ||
    input.some(
      (value) => typeof value !== "string" || !TOOL_NAME.test(value),
    ) ||
    new Set(input).size !== input.length ||
    canonicalJson(input) !==
      canonicalJson(
        [...input].sort((left, right) =>
          String(left).localeCompare(String(right)),
        ),
      )
  ) {
    throw new Error("Workflow experiment tool names are invalid");
  }
  return [...input] as string[];
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

function assertEncodedBytes(
  input: unknown,
  maximum: number,
  label: string,
): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error(`${label} is not serializable JSON`);
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maximum) {
    throw new Error(`${label} exceeds its byte limit`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error("Workflow experiment fields are invalid");
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

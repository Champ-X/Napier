import type {
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  StreamFrame,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertExecutionPlanWorkflowExperimentComparisonBinding,
  MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES,
  validateExecutionPlanWorkflowExperimentComparison,
} from "./workflow-experiment-comparison-protocol.js";
import { projectWorkflowExperimentExecution } from "./workflow-experiment-mode.js";
import { validateExecutionPlanWorkflowExperimentPreview } from "./workflow-experiment-preview-protocol.js";
import {
  assertEncodedBytes,
  assertExactKeys,
  hash,
  nonNegativeInteger,
  PLAN_ID,
  record,
  THREAD_ID,
} from "./workflow-experiment-protocol-primitives.js";
import {
  defineExecutionPlanWorkflow,
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";
import {
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
  validateExecutionPlanWorkflowResult,
} from "./workflow-protocol.js";

export const MAX_WORKFLOW_EXPERIMENT_RESULT_BYTES =
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES * 2 +
  MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES +
  MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES +
  256 * 1024;

export const MAX_WORKFLOW_EXPERIMENT_FRAME_BYTES =
  MAX_WORKFLOW_EXPERIMENT_RESULT_BYTES + 256 * 1024;

export {
  assertEncodedBytes,
  validateToolEffects,
} from "./workflow-experiment-protocol-primitives.js";

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
  assertWorkflowExperimentResultBinding({
    targetThreadId: experiment["targetThreadId"],
    preview,
    sourceManifest,
    candidateManifest,
    result,
    comparison,
  });
  return structuredClone(input) as ExecutionPlanWorkflowExperimentResult;
}

interface WorkflowExperimentResultBinding {
  targetThreadId: string;
  preview: ExecutionPlanWorkflowExperimentPreview;
  sourceManifest: ExecutionPlanWorkflowManifest;
  candidateManifest: ExecutionPlanWorkflowManifest;
  result: ExecutionPlanWorkflowResult;
  comparison: ExecutionPlanWorkflowExperimentComparison | undefined;
}

function assertWorkflowExperimentResultBinding(
  binding: WorkflowExperimentResultBinding,
): void {
  const {
    targetThreadId,
    preview,
    sourceManifest,
    candidateManifest,
    result,
    comparison,
  } = binding;
  const manifestNodeIds = candidateManifest.nodes.map((node) => node.id);
  const expectedCandidateManifest = createExpectedCandidateManifest(
    sourceManifest,
    preview,
  );
  const execution = projectWorkflowExperimentExecution(
    sourceManifest,
    preview.schemaVersion === 6 ? undefined : preview.fromNodeId,
    workflowExperimentExecutionMode(preview),
  );
  const expectedReusedNodeIds = sourceManifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => !execution.rerunNodeIds.includes(nodeId));
  if (
    !validWorkflowExperimentArtifactBinding(
      targetThreadId,
      preview,
      sourceManifest,
      candidateManifest,
      expectedCandidateManifest,
      result,
    ) ||
    !validWorkflowExperimentExecutionBinding(
      preview,
      expectedReusedNodeIds,
      execution,
    ) ||
    !validWorkflowInputReplacementBinding(
      preview,
      comparison,
      manifestNodeIds,
    ) ||
    !validWorkflowExperimentNodeCoverage(preview, manifestNodeIds)
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
}

function validWorkflowExperimentArtifactBinding(
  targetThreadId: string,
  preview: ExecutionPlanWorkflowExperimentPreview,
  sourceManifest: ExecutionPlanWorkflowManifest,
  candidateManifest: ExecutionPlanWorkflowManifest,
  expectedCandidateManifest: ExecutionPlanWorkflowManifest,
  result: ExecutionPlanWorkflowResult,
): boolean {
  return (
    sourceManifest.contentSha256 === preview.sourceManifestSha256 &&
    candidateManifest.contentSha256 === preview.candidateManifestSha256 &&
    candidateManifest.contentSha256 ===
      expectedCandidateManifest.contentSha256 &&
    result.threadId === targetThreadId &&
    result.manifestSha256 === candidateManifest.contentSha256
  );
}

function validWorkflowExperimentExecutionBinding(
  preview: ExecutionPlanWorkflowExperimentPreview,
  expectedReusedNodeIds: string[],
  execution: ReturnType<typeof projectWorkflowExperimentExecution>,
): boolean {
  if (
    canonicalJson(preview.reusedNodeIds) !==
      canonicalJson(expectedReusedNodeIds) ||
    canonicalJson(preview.rerunNodeIds) !==
      canonicalJson(execution.rerunNodeIds)
  ) {
    return false;
  }
  if (preview.schemaVersion === 1) return true;
  if (
    canonicalJson(preview.executionNodeIds) !==
    canonicalJson(execution.executionNodeIds)
  ) {
    return false;
  }
  switch (preview.schemaVersion) {
    case 2:
    case 5:
      return (
        canonicalJson(preview.stopBeforeNodeIds) ===
        canonicalJson(execution.stopBeforeNodeIds)
      );
    case 3:
      return preview.simulatedNodeId === preview.fromNodeId;
    case 4:
      return preview.replacedInputNodeId === preview.fromNodeId;
    case 6:
      return true;
  }
}

function validWorkflowExperimentNodeCoverage(
  preview: ExecutionPlanWorkflowExperimentPreview,
  manifestNodeIds: string[],
): boolean {
  return (
    canonicalJson(
      [...preview.reusedNodeIds, ...preview.rerunNodeIds].sort(),
    ) === canonicalJson([...manifestNodeIds].sort())
  );
}

function createExpectedCandidateManifest(
  sourceManifest: ExecutionPlanWorkflowManifest,
  preview: ExecutionPlanWorkflowExperimentPreview,
): ExecutionPlanWorkflowManifest {
  return defineExecutionPlanWorkflow({
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
}

function workflowExperimentExecutionMode(
  preview: ExecutionPlanWorkflowExperimentPreview,
):
  | "subgraph"
  | Exclude<
      ExecutionPlanWorkflowExperimentPreview,
      { schemaVersion: 1 }
    >["mode"] {
  if (preview.schemaVersion === 1) return "subgraph";
  return preview.mode;
}

function validWorkflowInputReplacementBinding(
  preview: ExecutionPlanWorkflowExperimentPreview,
  comparison: ExecutionPlanWorkflowExperimentComparison | undefined,
  manifestNodeIds: string[],
): boolean {
  return (
    preview.schemaVersion !== 6 ||
    (preview.reusedNodeIds.length === 0 &&
      canonicalJson(preview.executionNodeIds) ===
        canonicalJson(manifestNodeIds) &&
      comparison !== undefined &&
      comparison.targetInputSha256 === preview.replacementWorkflowInputSha256)
  );
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
  assertWorkflowExperimentResultFrameEnvelope(frame);
  const experiment = validateExecutionPlanWorkflowExperimentResult(
    frame["experiment"],
  );
  assertWorkflowExperimentResultFrameBinding(frame, experiment);
  const { contentSha256: _contentSha256, ...content } = frame;
  if (sha256(canonicalJson(content as JsonValue)) !== frame["contentSha256"]) {
    throw new Error("Workflow experiment result frame hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowExperimentResultFrame;
}

function assertWorkflowExperimentResultFrameEnvelope(
  frame: Record<string, unknown>,
): void {
  if (
    frame["type"] !== "workflow_experiment_result" ||
    !matchesId(frame["sourceThreadId"], THREAD_ID) ||
    !matchesId(frame["sourcePlanId"], PLAN_ID) ||
    !matchesId(frame["targetThreadId"], THREAD_ID) ||
    !matchesId(frame["targetPlanId"], PLAN_ID) ||
    !isWorkflowExperimentResultStatus(frame["status"]) ||
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
}

function matchesId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isWorkflowExperimentResultStatus(value: unknown): boolean {
  return (
    value === "completed" ||
    value === "waiting" ||
    value === "paused" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

function assertWorkflowExperimentResultFrameBinding(
  frame: Record<string, unknown>,
  experiment: ExecutionPlanWorkflowExperimentResult,
): void {
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
}

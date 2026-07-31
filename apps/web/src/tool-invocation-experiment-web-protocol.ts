import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { validateToolInvocationExperimentComparison } from "./tool-invocation-experiment-comparison-web-protocol";
import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const AGENT_ID = /^agent_[a-z0-9_]{2,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const STATUSES = new Set(["completed", "failed", "cancelled"]);

export async function validateToolInvocationExperimentPreview(
  input: unknown,
): Promise<ToolInvocationExperimentPreview> {
  const value = record(input, "Tool invocation experiment preview");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "sourceAgentId",
    "sourceAgentRevision",
    "sourceCallId",
    "sourceCapsuleEventSeq",
    "sourceStartedEventSeq",
    "sourceTerminalEventSeq",
    "sourceToolName",
    "sourceEffect",
    "sourceToolDefinitionSha256",
    "sourceArgumentsSha256",
    "sourceWorkspaceScopeSha256",
    "sourceCapsuleSha256",
    "sourceCapsuleBytes",
    "sourceDurationMs",
    "sourceOutputSha256",
    "sourceOutputBytes",
    "candidateWorkspaceSnapshotSha256",
    "candidateWorkspaceFileCount",
    "candidateWorkspaceBytes",
    "targetExecutionMode",
    "previewSha256",
  ]);
  if (
    value["kind"] !== "napier.tool-invocation-experiment-preview" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    typeof value["sourceAgentId"] !== "string" ||
    !AGENT_ID.test(value["sourceAgentId"]) ||
    !positiveInteger(value["sourceAgentRevision"]) ||
    !callId(value["sourceCallId"]) ||
    !positiveInteger(value["sourceCapsuleEventSeq"]) ||
    !positiveInteger(value["sourceStartedEventSeq"]) ||
    !positiveInteger(value["sourceTerminalEventSeq"]) ||
    value["sourceStartedEventSeq"] >= value["sourceCapsuleEventSeq"] ||
    value["sourceCapsuleEventSeq"] >= value["sourceTerminalEventSeq"] ||
    typeof value["sourceToolName"] !== "string" ||
    !TOOL_NAME.test(value["sourceToolName"]) ||
    value["sourceEffect"] !== "read" ||
    !hashFields(value, [
      "sourceToolDefinitionSha256",
      "sourceArgumentsSha256",
      "sourceWorkspaceScopeSha256",
      "sourceCapsuleSha256",
      "sourceOutputSha256",
      "candidateWorkspaceSnapshotSha256",
      "previewSha256",
    ]) ||
    !positiveInteger(value["sourceCapsuleBytes"]) ||
    !nonNegativeInteger(value["sourceDurationMs"]) ||
    !nonNegativeInteger(value["sourceOutputBytes"]) ||
    value["sourceOutputBytes"] > 512 * 1024 ||
    !nonNegativeInteger(value["candidateWorkspaceFileCount"]) ||
    !nonNegativeInteger(value["candidateWorkspaceBytes"]) ||
    value["targetExecutionMode"] !== "tool_experiment_read_only"
  ) {
    throw new Error("Tool invocation experiment preview is invalid");
  }
  const content = { ...value };
  delete content["previewSha256"];
  if ((await sha256Text(canonicalJson(content))) !== value["previewSha256"]) {
    throw new Error("Tool invocation experiment preview hash is invalid");
  }
  return structuredClone(value) as unknown as ToolInvocationExperimentPreview;
}

export async function validateToolInvocationExperimentResult(
  input: unknown,
): Promise<ToolInvocationExperimentResult> {
  const value = record(input, "Tool invocation experiment result");
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "preview",
      "targetThreadId",
      "targetRunId",
      "status",
      "comparison",
    ],
    new Set(["candidateOutput"]),
  );
  const preview = await validateToolInvocationExperimentPreview(
    value["preview"],
  );
  const comparison = await validateToolInvocationExperimentComparison(
    value["comparison"],
  );
  const candidateOutput = value["candidateOutput"];
  if (
    value["kind"] !== "napier.tool-invocation-experiment-result" ||
    value["schemaVersion"] !== 1 ||
    typeof value["targetThreadId"] !== "string" ||
    !THREAD_ID.test(value["targetThreadId"]) ||
    value["targetThreadId"] === preview.sourceThreadId ||
    typeof value["targetRunId"] !== "string" ||
    !RUN_ID.test(value["targetRunId"]) ||
    typeof value["status"] !== "string" ||
    !STATUSES.has(value["status"]) ||
    (value["status"] !== "completed" && candidateOutput !== undefined) ||
    (candidateOutput !== undefined &&
      (typeof candidateOutput !== "string" ||
        new TextEncoder().encode(candidateOutput).byteLength > 512 * 1024)) ||
    comparison.source.status !== "completed" ||
    comparison.source.threadId !== preview.sourceThreadId ||
    comparison.source.runId !== preview.sourceRunId ||
    comparison.source.toolName !== preview.sourceToolName ||
    comparison.source.durationMs !== preview.sourceDurationMs ||
    comparison.source.outputSha256 !== preview.sourceOutputSha256 ||
    comparison.source.outputBytes !== preview.sourceOutputBytes ||
    comparison.target.threadId !== value["targetThreadId"] ||
    comparison.target.runId !== value["targetRunId"] ||
    comparison.target.status !== value["status"] ||
    comparison.target.toolName !== preview.sourceToolName ||
    (await sha256Text(
      typeof candidateOutput === "string" ? candidateOutput : "",
    )) !== comparison.target.outputSha256 ||
    new TextEncoder().encode(
      typeof candidateOutput === "string" ? candidateOutput : "",
    ).byteLength !== comparison.target.outputBytes
  ) {
    throw new Error("Tool invocation experiment result binding is invalid");
  }
  return {
    kind: value["kind"],
    schemaVersion: value["schemaVersion"],
    preview,
    targetThreadId: value["targetThreadId"],
    targetRunId: value["targetRunId"],
    status: value["status"],
    ...(typeof candidateOutput === "string" ? { candidateOutput } : {}),
    comparison,
  } as ToolInvocationExperimentResult;
}

export async function validateToolInvocationExperimentResultFrame(
  input: unknown,
): Promise<ToolInvocationExperimentResultFrame> {
  const value = record(input, "Tool invocation experiment result frame");
  exactKeys(value, [
    "type",
    "sourceThreadId",
    "sourceRunId",
    "sourceCallId",
    "targetThreadId",
    "targetRunId",
    "status",
    "previewSha256",
    "experiment",
    "snapshotSha256",
    "snapshotBytes",
    "eventCount",
    "eventBytes",
    "eventStreamSha256",
    "contentSha256",
  ]);
  const experiment = await validateToolInvocationExperimentResult(
    value["experiment"],
  );
  if (
    value["type"] !== "tool_invocation_experiment_result" ||
    value["sourceThreadId"] !== experiment.preview.sourceThreadId ||
    value["sourceRunId"] !== experiment.preview.sourceRunId ||
    value["sourceCallId"] !== experiment.preview.sourceCallId ||
    value["targetThreadId"] !== experiment.targetThreadId ||
    value["targetRunId"] !== experiment.targetRunId ||
    value["status"] !== experiment.status ||
    value["previewSha256"] !== experiment.preview.previewSha256 ||
    !hashFields(value, [
      "snapshotSha256",
      "eventStreamSha256",
      "contentSha256",
    ]) ||
    !nonNegativeInteger(value["snapshotBytes"]) ||
    !nonNegativeInteger(value["eventCount"]) ||
    !nonNegativeInteger(value["eventBytes"])
  ) {
    throw new Error("Tool invocation experiment result frame is invalid");
  }
  const content = { ...value };
  delete content["contentSha256"];
  if ((await sha256Text(canonicalJson(content))) !== value["contentSha256"]) {
    throw new Error("Tool invocation experiment result frame hash is invalid");
  }
  return {
    ...(structuredClone(
      value,
    ) as unknown as ToolInvocationExperimentResultFrame),
    experiment,
  };
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: ReadonlySet<string> = new Set(),
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Tool invocation experiment fields are invalid");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function callId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function hashFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => hash(value[field]));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

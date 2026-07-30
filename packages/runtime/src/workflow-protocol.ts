import type {
  ExecuteExecutionPlanWorkflowRequest,
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowResultFrame,
  JsonValue,
  StreamFrame,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowValue,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES = 2 * 1024 * 1024;

const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9]{8,80}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;

export function validateExecuteExecutionPlanWorkflowRequest(
  input: unknown,
): ExecuteExecutionPlanWorkflowRequest {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
    "Workflow execution request",
  );
  const request = record(input, "Workflow execution request");
  const manifest = validateExecutionPlanWorkflowManifest(request["manifest"]);
  if (request["planId"] === undefined) {
    assertExactKeys(request, ["manifest", "input"]);
    if (request["input"] === undefined) {
      throw new Error("Workflow execution input is required");
    }
    assertWorkflowValue(
      manifest.inputSchema,
      request["input"],
      "Workflow input",
    );
    return {
      manifest,
      input: structuredClone(request["input"]) as JsonValue,
    };
  }
  assertExactKeys(
    request,
    ["manifest", "planId", "retryBlocked"],
    new Set(["retryBlocked"]),
  );
  if (
    typeof request["planId"] !== "string" ||
    !PLAN_ID.test(request["planId"]) ||
    (request["retryBlocked"] !== undefined &&
      typeof request["retryBlocked"] !== "boolean")
  ) {
    throw new Error("Workflow resume request is invalid");
  }
  return {
    manifest,
    planId: request["planId"],
    ...(request["retryBlocked"] === true ? { retryBlocked: true } : {}),
  };
}

export function createExecutionPlanWorkflowResultFrame(
  result: ExecutionPlanWorkflowResult,
  snapshot: Extract<StreamFrame, { type: "snapshot" }>,
  eventStreamSha256: string,
): ExecutionPlanWorkflowResultFrame {
  const validatedResult = validateExecutionPlanWorkflowResult(result);
  if (
    snapshot.detail.thread.id !== validatedResult.threadId ||
    snapshot.detail.thread.eventCount !== snapshot.detail.events.length ||
    !/^[a-f0-9]{64}$/u.test(eventStreamSha256)
  ) {
    throw new Error("Workflow result snapshot binding is invalid");
  }
  const content = {
    type: "workflow_result" as const,
    threadId: validatedResult.threadId,
    planId: validatedResult.planId,
    status: validatedResult.status,
    manifestSha256: validatedResult.manifestSha256,
    result: structuredClone(validatedResult),
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

export function validateExecutionPlanWorkflowResult(
  input: unknown,
): ExecutionPlanWorkflowResult {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_REQUEST_BYTES,
    "Workflow result",
  );
  const result = record(input, "Workflow result");
  assertExactKeys(
    result,
    [
      "kind",
      "schemaVersion",
      "threadId",
      "planId",
      "manifestSha256",
      "blueprintSha256",
      "status",
      "resumed",
      "nodeResults",
      "output",
      "outputSha256",
      "resultSha256",
    ],
    new Set(["output", "outputSha256"]),
  );
  if (
    result["kind"] !== "napier.execution-plan-workflow-result" ||
    result["schemaVersion"] !== 1 ||
    typeof result["threadId"] !== "string" ||
    !THREAD_ID.test(result["threadId"]) ||
    typeof result["planId"] !== "string" ||
    !PLAN_ID.test(result["planId"]) ||
    !hash(result["manifestSha256"]) ||
    !hash(result["blueprintSha256"]) ||
    (result["status"] !== "completed" &&
      result["status"] !== "blocked" &&
      result["status"] !== "cancelled") ||
    typeof result["resumed"] !== "boolean" ||
    !Array.isArray(result["nodeResults"]) ||
    result["nodeResults"].length > 30 ||
    !hash(result["resultSha256"])
  ) {
    throw new Error("Workflow result is invalid");
  }
  const nodeIds = new Set<string>();
  for (const [index, nodeInput] of result["nodeResults"].entries()) {
    const node = record(nodeInput, `Workflow node result ${String(index + 1)}`);
    assertExactKeys(
      node,
      [
        "nodeId",
        "attempt",
        "status",
        "inputSha256",
        "inputSchemaSha256",
        "outputSchemaSha256",
        "runId",
        "output",
        "outputSha256",
        "errorCode",
        "diagnosticSha256",
      ],
      new Set([
        "runId",
        "output",
        "outputSha256",
        "errorCode",
        "diagnosticSha256",
      ]),
    );
    if (
      typeof node["nodeId"] !== "string" ||
      !NODE_ID.test(node["nodeId"]) ||
      nodeIds.has(node["nodeId"]) ||
      !Number.isSafeInteger(node["attempt"]) ||
      Number(node["attempt"]) < 1 ||
      Number(node["attempt"]) > 3 ||
      (node["status"] !== "completed" &&
        node["status"] !== "blocked" &&
        node["status"] !== "cancelled") ||
      !hash(node["inputSha256"]) ||
      !hash(node["inputSchemaSha256"]) ||
      !hash(node["outputSchemaSha256"]) ||
      (node["runId"] !== undefined &&
        (typeof node["runId"] !== "string" || !RUN_ID.test(node["runId"])))
    ) {
      throw new Error("Workflow node result is invalid");
    }
    nodeIds.add(node["nodeId"]);
    if (node["status"] === "completed") {
      if (
        node["output"] === undefined ||
        !hash(node["outputSha256"]) ||
        sha256(canonicalJson(node["output"] as JsonValue)) !==
          node["outputSha256"] ||
        node["errorCode"] !== undefined ||
        node["diagnosticSha256"] !== undefined
      ) {
        throw new Error("Completed Workflow node result is invalid");
      }
    } else if (
      node["output"] !== undefined ||
      node["outputSha256"] !== undefined ||
      typeof node["errorCode"] !== "string" ||
      !SAFE_TOKEN.test(node["errorCode"]) ||
      !hash(node["diagnosticSha256"])
    ) {
      throw new Error("Failed Workflow node result is invalid");
    }
  }
  if (result["status"] === "completed") {
    if (
      result["output"] === undefined ||
      !hash(result["outputSha256"]) ||
      sha256(canonicalJson(result["output"] as JsonValue)) !==
        result["outputSha256"]
    ) {
      throw new Error("Completed Workflow output is invalid");
    }
  } else if (
    result["output"] !== undefined ||
    result["outputSha256"] !== undefined
  ) {
    throw new Error("Incomplete Workflow must not expose final output");
  }
  const { resultSha256: _resultSha256, ...content } = result;
  if (sha256(canonicalJson(content as JsonValue)) !== result["resultSha256"]) {
    throw new Error("Workflow result hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowResult;
}

export function validateExecutionPlanWorkflowResultFrame(
  input: unknown,
): ExecutionPlanWorkflowResultFrame {
  const frame = record(input, "Workflow result frame");
  assertExactKeys(frame, [
    "type",
    "threadId",
    "planId",
    "status",
    "manifestSha256",
    "result",
    "snapshotSha256",
    "snapshotBytes",
    "eventCount",
    "eventBytes",
    "eventStreamSha256",
    "contentSha256",
  ]);
  if (
    frame["type"] !== "workflow_result" ||
    typeof frame["threadId"] !== "string" ||
    typeof frame["planId"] !== "string" ||
    !PLAN_ID.test(frame["planId"]) ||
    (frame["status"] !== "completed" &&
      frame["status"] !== "blocked" &&
      frame["status"] !== "cancelled") ||
    !hash(frame["manifestSha256"]) ||
    !hash(frame["snapshotSha256"]) ||
    !hash(frame["eventStreamSha256"]) ||
    !hash(frame["contentSha256"]) ||
    !nonNegativeInteger(frame["snapshotBytes"]) ||
    !nonNegativeInteger(frame["eventCount"]) ||
    !nonNegativeInteger(frame["eventBytes"])
  ) {
    throw new Error("Workflow result frame is invalid");
  }
  const result = validateExecutionPlanWorkflowResult(frame["result"]);
  if (
    result.threadId !== frame["threadId"] ||
    result.planId !== frame["planId"] ||
    result.status !== frame["status"] ||
    result.manifestSha256 !== frame["manifestSha256"]
  ) {
    throw new Error("Workflow result frame binding is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = frame;
  if (sha256(canonicalJson(content as JsonValue)) !== frame["contentSha256"]) {
    throw new Error("Workflow result frame content hash mismatch");
  }
  return structuredClone(input) as ExecutionPlanWorkflowResultFrame;
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
    throw new Error("Workflow protocol fields are invalid");
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

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

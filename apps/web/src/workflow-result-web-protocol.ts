import type {
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowResultFrame,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9]{8,80}$/u;
const DECISION_ID = /^decision_[a-z0-9]{8,80}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const SAFE_TOKEN = /^[a-z][a-z0-9_]{0,63}$/u;
const WORKFLOW_STATUSES = new Set([
  "completed",
  "waiting",
  "paused",
  "blocked",
  "cancelled",
]);
const NODE_STATUSES = new Set([
  "completed",
  "skipped",
  "waiting",
  "blocked",
  "cancelled",
]);

export async function validateWorkflowResultFrame(
  input: unknown,
): Promise<ExecutionPlanWorkflowResultFrame> {
  const frame = requiredRecord(input, "Workflow result frame");
  exactKeys(frame, [
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
    !THREAD_ID.test(frame["threadId"]) ||
    typeof frame["planId"] !== "string" ||
    !PLAN_ID.test(frame["planId"]) ||
    !WORKFLOW_STATUSES.has(String(frame["status"])) ||
    !hash(frame["manifestSha256"]) ||
    !hash(frame["snapshotSha256"]) ||
    !nonNegativeInteger(frame["snapshotBytes"]) ||
    !nonNegativeInteger(frame["eventCount"]) ||
    !nonNegativeInteger(frame["eventBytes"]) ||
    !hash(frame["eventStreamSha256"]) ||
    !hash(frame["contentSha256"])
  ) {
    throw new Error("Workflow result frame is invalid");
  }
  const result = await validateWorkflowResult(frame["result"]);
  if (
    result.threadId !== frame["threadId"] ||
    result.planId !== frame["planId"] ||
    result.status !== frame["status"] ||
    result.manifestSha256 !== frame["manifestSha256"] ||
    (result.breakpoint !== undefined &&
      result.breakpoint.reachedEventSeq > Number(frame["eventCount"]))
  ) {
    throw new Error("Workflow result frame binding is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = frame;
  if (
    (await sha256Text(canonicalJson(content as JsonValue))) !==
    frame["contentSha256"]
  ) {
    throw new Error("Workflow result frame hash is invalid");
  }
  return structuredClone(input) as ExecutionPlanWorkflowResultFrame;
}

async function validateWorkflowResult(
  input: unknown,
): Promise<ExecutionPlanWorkflowResult> {
  const result = requiredRecord(input, "Workflow result");
  exactKeys(
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
      "breakpoint",
      "output",
      "outputSha256",
      "resultSha256",
    ],
    new Set(["breakpoint", "output", "outputSha256"]),
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
    !WORKFLOW_STATUSES.has(String(result["status"])) ||
    typeof result["resumed"] !== "boolean" ||
    !Array.isArray(result["nodeResults"]) ||
    result["nodeResults"].length > 30 ||
    !hash(result["resultSha256"])
  ) {
    throw new Error("Workflow result is invalid");
  }
  validateBreakpoint(result);
  const nodeIds = new Set<string>();
  for (const [index, inputNode] of result["nodeResults"].entries()) {
    await validateNodeResult(inputNode, index, nodeIds);
  }
  if (result["status"] === "completed") {
    if (
      !jsonValue(result["output"], 0) ||
      !hash(result["outputSha256"]) ||
      (await sha256Text(canonicalJson(result["output"]))) !==
        result["outputSha256"]
    ) {
      throw new Error("Completed Workflow output is invalid");
    }
  } else if (
    result["output"] !== undefined ||
    result["outputSha256"] !== undefined
  ) {
    throw new Error("Incomplete Workflow exposed final output");
  }
  const { resultSha256: _resultSha256, ...content } = result;
  if (
    (await sha256Text(canonicalJson(content as JsonValue))) !==
    result["resultSha256"]
  ) {
    throw new Error("Workflow result hash is invalid");
  }
  return structuredClone(input) as ExecutionPlanWorkflowResult;
}

function validateBreakpoint(result: Record<string, unknown>): void {
  if (result["status"] !== "paused") {
    if (result["breakpoint"] !== undefined) {
      throw new Error("Only a paused Workflow can expose a breakpoint");
    }
    return;
  }
  const breakpoint = requiredRecord(
    result["breakpoint"],
    "Workflow result breakpoint",
  );
  exactKeys(breakpoint, [
    "nodeId",
    "breakpointIndex",
    "breakpointCount",
    "reachedEventSeq",
    "bindingContextSha256",
  ]);
  if (
    typeof breakpoint["nodeId"] !== "string" ||
    !NODE_ID.test(breakpoint["nodeId"]) ||
    !nonNegativeInteger(breakpoint["breakpointIndex"]) ||
    !positiveInteger(breakpoint["breakpointCount"]) ||
    Number(breakpoint["breakpointCount"]) > 16 ||
    Number(breakpoint["breakpointIndex"]) >=
      Number(breakpoint["breakpointCount"]) ||
    !positiveInteger(breakpoint["reachedEventSeq"]) ||
    !hash(breakpoint["bindingContextSha256"])
  ) {
    throw new Error("Workflow result breakpoint is invalid");
  }
}

async function validateNodeResult(
  input: unknown,
  index: number,
  nodeIds: Set<string>,
): Promise<void> {
  const node = requiredRecord(
    input,
    `Workflow node result ${String(index + 1)}`,
  );
  exactKeys(
    node,
    [
      "nodeId",
      "attempt",
      "status",
      "inputSha256",
      "inputSchemaSha256",
      "outputSchemaSha256",
      "runId",
      "decisionId",
      "output",
      "outputSha256",
      "errorCode",
      "diagnosticSha256",
    ],
    new Set([
      "runId",
      "decisionId",
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
    !NODE_STATUSES.has(String(node["status"])) ||
    !Number.isSafeInteger(node["attempt"]) ||
    (node["status"] === "skipped"
      ? node["attempt"] !== 0
      : Number(node["attempt"]) < 1 || Number(node["attempt"]) > 3) ||
    !hash(node["inputSha256"]) ||
    !hash(node["inputSchemaSha256"]) ||
    !hash(node["outputSchemaSha256"]) ||
    (node["runId"] !== undefined &&
      (typeof node["runId"] !== "string" || !RUN_ID.test(node["runId"]))) ||
    (node["decisionId"] !== undefined &&
      (typeof node["decisionId"] !== "string" ||
        !DECISION_ID.test(node["decisionId"])))
  ) {
    throw new Error("Workflow node result is invalid");
  }
  nodeIds.add(node["nodeId"]);
  if (node["status"] === "completed" || node["status"] === "skipped") {
    if (
      !jsonValue(node["output"], 0) ||
      !hash(node["outputSha256"]) ||
      (await sha256Text(canonicalJson(node["output"]))) !==
        node["outputSha256"] ||
      (node["status"] === "skipped" && node["runId"] !== undefined) ||
      node["decisionId"] !== undefined ||
      node["errorCode"] !== undefined ||
      node["diagnosticSha256"] !== undefined
    ) {
      throw new Error("Completed Workflow node result is invalid");
    }
    return;
  }
  if (node["status"] === "waiting") {
    if (
      node["runId"] === undefined ||
      node["decisionId"] === undefined ||
      node["output"] !== undefined ||
      node["outputSha256"] !== undefined ||
      node["errorCode"] !== undefined ||
      node["diagnosticSha256"] !== undefined
    ) {
      throw new Error("Waiting Workflow node result is invalid");
    }
    return;
  }
  if (
    node["output"] !== undefined ||
    node["outputSha256"] !== undefined ||
    node["decisionId"] !== undefined ||
    typeof node["errorCode"] !== "string" ||
    !SAFE_TOKEN.test(node["errorCode"]) ||
    !hash(node["diagnosticSha256"])
  ) {
    throw new Error("Failed Workflow node result is invalid");
  }
}

function exactKeys(
  input: Record<string, unknown>,
  keys: string[],
  optional = new Set<string>(),
): void {
  const expected = new Set(keys);
  if (
    Object.keys(input).some((key) => !expected.has(key)) ||
    keys.some((key) => !optional.has(key) && !Object.hasOwn(input, key))
  ) {
    throw new Error("Workflow result fields are invalid");
  }
}

function jsonValue(input: unknown, depth: number): input is JsonValue {
  if (depth > 64) return false;
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return true;
  }
  if (typeof input === "number") return Number.isFinite(input);
  if (Array.isArray(input)) {
    return input.every((value) => jsonValue(value, depth + 1));
  }
  if (!record(input)) return false;
  return Object.entries(input).every(
    ([key, value]) =>
      key !== "__proto__" &&
      key !== "constructor" &&
      key !== "prototype" &&
      jsonValue(value, depth + 1),
  );
}

function hash(input: unknown): input is string {
  return typeof input === "string" && HASH.test(input);
}

function positiveInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) > 0;
}

function nonNegativeInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) >= 0;
}

function requiredRecord(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (!record(input)) throw new Error(`${label} must be an object`);
  return input;
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

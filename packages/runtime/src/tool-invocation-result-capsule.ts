import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
  JsonValue,
  ToolInvocationCapsuleReceipt,
  ToolInvocationResultCapsuleReceipt,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_TOOL_INVOCATION_RESULT_CAPSULE_BYTES = 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export interface ReplayableToolResult {
  content: TextContent[];
  details: JsonValue;
  usage?: JsonValue;
  addedToolNames?: string[];
}

export interface ToolInvocationResultCapsule {
  kind: "napier.tool-invocation-result-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
  invocationCapsuleSha256: string;
  toolDefinitionSha256: string;
  argumentsSha256: string;
  isError: boolean;
  result: ReplayableToolResult;
  resultSha256: string;
  outputTextSha256: string;
  outputTextBytes: number;
  contentSha256: string;
}

export interface CreateToolInvocationResultCapsuleInput {
  sourceThreadId: string;
  sourceRunId: string;
  invocation: ToolInvocationCapsuleReceipt;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

export function createToolInvocationResultCapsule(
  input: CreateToolInvocationResultCapsuleInput,
): ToolInvocationResultCapsule {
  const result = normalizeReplayableToolResult(input.result);
  const outputText = replayableToolResultText(result);
  const content = {
    kind: "napier.tool-invocation-result-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    callId: input.invocation.callId,
    toolName: input.invocation.toolName,
    invocationCapsuleSha256: input.invocation.capsuleSha256,
    toolDefinitionSha256: input.invocation.toolDefinitionSha256,
    argumentsSha256: input.invocation.argumentsSha256,
    isError: input.isError,
    result,
    resultSha256: sha256(canonicalJson(result)),
    outputTextSha256: sha256(outputText),
    outputTextBytes: Buffer.byteLength(outputText, "utf8"),
  };
  return validateToolInvocationResultCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateToolInvocationResultCapsule(
  input: unknown,
): ToolInvocationResultCapsule {
  const value = record(input, "Tool invocation result capsule");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "callId",
    "toolName",
    "invocationCapsuleSha256",
    "toolDefinitionSha256",
    "argumentsSha256",
    "isError",
    "result",
    "resultSha256",
    "outputTextSha256",
    "outputTextBytes",
    "contentSha256",
  ]);
  const result = normalizeReplayableToolResult(value["result"]);
  if (
    value["kind"] !== "napier.tool-invocation-result-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !callId(value["callId"]) ||
    typeof value["toolName"] !== "string" ||
    !TOOL_NAME.test(value["toolName"]) ||
    !hashFields(value, [
      "invocationCapsuleSha256",
      "toolDefinitionSha256",
      "argumentsSha256",
      "resultSha256",
      "outputTextSha256",
      "contentSha256",
    ]) ||
    typeof value["isError"] !== "boolean" ||
    !nonNegativeInteger(value["outputTextBytes"])
  ) {
    throw new Error("Tool invocation result capsule is invalid");
  }
  const outputText = replayableToolResultText(result);
  const normalized = {
    kind: "napier.tool-invocation-result-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    callId: value["callId"] as string,
    toolName: value["toolName"],
    invocationCapsuleSha256: value["invocationCapsuleSha256"] as string,
    toolDefinitionSha256: value["toolDefinitionSha256"] as string,
    argumentsSha256: value["argumentsSha256"] as string,
    isError: value["isError"] as boolean,
    result,
    resultSha256: value["resultSha256"] as string,
    outputTextSha256: value["outputTextSha256"] as string,
    outputTextBytes: Number(value["outputTextBytes"]),
  };
  if (
    sha256(canonicalJson(result)) !== normalized.resultSha256 ||
    sha256(outputText) !== normalized.outputTextSha256 ||
    Buffer.byteLength(outputText, "utf8") !== normalized.outputTextBytes ||
    sha256(canonicalJson(normalized)) !== value["contentSha256"]
  ) {
    throw new Error("Tool invocation result capsule binding is invalid");
  }
  return {
    ...normalized,
    contentSha256: value["contentSha256"] as string,
  };
}

export function createToolInvocationResultCapsuleReceipt(
  capsule: ToolInvocationResultCapsule,
  capsuleBytes = Buffer.byteLength(canonicalJson(capsule), "utf8"),
): ToolInvocationResultCapsuleReceipt {
  const content = {
    kind: "napier.tool-invocation-result-capsule-receipt" as const,
    schemaVersion: 1 as const,
    callId: capsule.callId,
    toolName: capsule.toolName,
    invocationCapsuleSha256: capsule.invocationCapsuleSha256,
    toolDefinitionSha256: capsule.toolDefinitionSha256,
    argumentsSha256: capsule.argumentsSha256,
    isError: capsule.isError,
    resultSha256: capsule.resultSha256,
    outputTextSha256: capsule.outputTextSha256,
    outputTextBytes: capsule.outputTextBytes,
    capsuleSha256: capsule.contentSha256,
    capsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateToolInvocationResultCapsuleReceipt(
  input: unknown,
): ToolInvocationResultCapsuleReceipt {
  const value = record(input, "Tool invocation result capsule receipt");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "callId",
    "toolName",
    "invocationCapsuleSha256",
    "toolDefinitionSha256",
    "argumentsSha256",
    "isError",
    "resultSha256",
    "outputTextSha256",
    "outputTextBytes",
    "capsuleSha256",
    "capsuleBytes",
    "storage",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.tool-invocation-result-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !callId(value["callId"]) ||
    typeof value["toolName"] !== "string" ||
    !TOOL_NAME.test(value["toolName"]) ||
    !hashFields(value, [
      "invocationCapsuleSha256",
      "toolDefinitionSha256",
      "argumentsSha256",
      "resultSha256",
      "outputTextSha256",
      "capsuleSha256",
      "contentSha256",
    ]) ||
    typeof value["isError"] !== "boolean" ||
    !nonNegativeInteger(value["outputTextBytes"]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    Number(value["capsuleBytes"]) > MAX_TOOL_INVOCATION_RESULT_CAPSULE_BYTES ||
    value["storage"] !== "local_only"
  ) {
    throw new Error("Tool invocation result capsule receipt is invalid");
  }
  const content = {
    kind: "napier.tool-invocation-result-capsule-receipt" as const,
    schemaVersion: 1 as const,
    callId: value["callId"] as string,
    toolName: value["toolName"],
    invocationCapsuleSha256: value["invocationCapsuleSha256"] as string,
    toolDefinitionSha256: value["toolDefinitionSha256"] as string,
    argumentsSha256: value["argumentsSha256"] as string,
    isError: value["isError"] as boolean,
    resultSha256: value["resultSha256"] as string,
    outputTextSha256: value["outputTextSha256"] as string,
    outputTextBytes: Number(value["outputTextBytes"]),
    capsuleSha256: value["capsuleSha256"] as string,
    capsuleBytes: Number(value["capsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Tool invocation result capsule receipt hash is invalid");
  }
  return {
    ...content,
    contentSha256: value["contentSha256"] as string,
  };
}

export function replayableToolResult(
  capsule: ToolInvocationResultCapsule,
): AgentToolResult<unknown> {
  return structuredClone(capsule.result) as unknown as AgentToolResult<unknown>;
}

export function replayableToolResultText(result: ReplayableToolResult): string {
  return result.content.map((item) => item.text).join("\n");
}

function normalizeReplayableToolResult(input: unknown): ReplayableToolResult {
  const value = record(input, "Replayable tool result");
  exactKeys(
    value,
    ["content", "details"],
    new Set(["usage", "addedToolNames"]),
  );
  if (
    !Array.isArray(value["content"]) ||
    value["content"].some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        (item as Record<string, unknown>)["type"] !== "text" ||
        typeof (item as Record<string, unknown>)["text"] !== "string" ||
        Object.keys(item).some((key) => key !== "type" && key !== "text"),
    )
  ) {
    throw new Error("Replayable tool result content is invalid");
  }
  const content = value["content"].map((item) => ({
    type: "text" as const,
    text: (item as { text: string }).text,
  }));
  const details = normalizeJson(value["details"]);
  const usage =
    value["usage"] === undefined ? undefined : normalizeJson(value["usage"]);
  const addedToolNames =
    value["addedToolNames"] === undefined
      ? undefined
      : normalizeToolNames(value["addedToolNames"]);
  return {
    content,
    details,
    ...(usage !== undefined ? { usage } : {}),
    ...(addedToolNames ? { addedToolNames } : {}),
  };
}

function normalizeJson(
  input: unknown,
  depth = 0,
  ancestors: ReadonlySet<object> = new Set(),
): JsonValue {
  if (depth > 64) {
    throw new Error("Replayable tool result exceeds the JSON depth limit");
  }
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return input;
  }
  if (typeof input === "number") {
    if (Number.isFinite(input)) return input;
    throw new Error("Replayable tool result contains a non-finite number");
  }
  if (!input || typeof input !== "object") {
    throw new Error("Replayable tool result is not exact JSON");
  }
  if (ancestors.has(input)) {
    throw new Error("Replayable tool result contains a cycle");
  }
  const nextAncestors = new Set(ancestors).add(input);
  if (Array.isArray(input)) {
    return input.map((item) => normalizeJson(item, depth + 1, nextAncestors));
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Replayable tool result is not exact JSON");
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      normalizeJson(value, depth + 1, nextAncestors),
    ]),
  );
}

function normalizeToolNames(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.some((name) => typeof name !== "string" || !TOOL_NAME.test(name))
  ) {
    throw new Error("Replayable tool result added tools are invalid");
  }
  return [...input] as string[];
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
    throw new Error("Tool invocation result capsule fields are invalid");
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

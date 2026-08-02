import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  ToolInvocationCapsuleReceipt,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";

export const MAX_TOOL_INVOCATION_CAPSULE_BYTES = 512 * 1024;

export const TOOL_INVOCATION_EXPERIMENT_TOOLS = new Set<string>(
  CORE_STATELESS_READ_TOOL_NAMES,
);

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export interface ToolInvocationCapsule {
  kind: "napier.tool-invocation-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
  effect: "read";
  toolDefinitionSha256: string;
  arguments: JsonValue;
  argumentsSha256: string;
  workspaceScope: string;
  workspaceScopeSha256: string;
  contentSha256: string;
}

export interface CreateToolInvocationCapsuleInput {
  sourceThreadId: string;
  sourceRunId: string;
  callId: string;
  toolName: string;
  toolDefinitionSha256: string;
  arguments: unknown;
}

export function createToolInvocationCapsule(
  input: CreateToolInvocationCapsuleInput,
): ToolInvocationCapsule {
  if (!TOOL_INVOCATION_EXPERIMENT_TOOLS.has(input.toolName)) {
    throw new Error("Tool invocation is not eligible for an experiment");
  }
  const argumentsValue = normalizeJson(input.arguments);
  const argumentsSha256 = sha256(canonicalJson(argumentsValue));
  const workspaceScope = workspaceScopeFromArguments(argumentsValue);
  const content = {
    kind: "napier.tool-invocation-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    callId: input.callId,
    toolName: input.toolName,
    effect: "read" as const,
    toolDefinitionSha256: input.toolDefinitionSha256,
    arguments: argumentsValue,
    argumentsSha256,
    workspaceScope,
    workspaceScopeSha256: sha256(workspaceScope),
  };
  return validateToolInvocationCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateToolInvocationCapsule(
  input: unknown,
): ToolInvocationCapsule {
  const value = record(input, "Tool invocation capsule");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "sourceThreadId",
    "sourceRunId",
    "callId",
    "toolName",
    "effect",
    "toolDefinitionSha256",
    "arguments",
    "argumentsSha256",
    "workspaceScope",
    "workspaceScopeSha256",
    "contentSha256",
  ]);
  const argumentsValue = normalizeJson(value["arguments"]);
  if (
    value["kind"] !== "napier.tool-invocation-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !callId(value["callId"]) ||
    typeof value["toolName"] !== "string" ||
    !TOOL_NAME.test(value["toolName"]) ||
    !TOOL_INVOCATION_EXPERIMENT_TOOLS.has(value["toolName"]) ||
    value["effect"] !== "read" ||
    !hash(value["toolDefinitionSha256"]) ||
    !hash(value["argumentsSha256"]) ||
    typeof value["workspaceScope"] !== "string" ||
    !validWorkspaceScope(value["workspaceScope"]) ||
    !hash(value["workspaceScopeSha256"]) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Tool invocation capsule is invalid");
  }
  const normalized = {
    kind: "napier.tool-invocation-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    callId: value["callId"] as string,
    toolName: value["toolName"],
    effect: "read" as const,
    toolDefinitionSha256: value["toolDefinitionSha256"],
    arguments: argumentsValue,
    argumentsSha256: value["argumentsSha256"],
    workspaceScope: value["workspaceScope"],
    workspaceScopeSha256: value["workspaceScopeSha256"],
  };
  if (
    sha256(canonicalJson(argumentsValue)) !== normalized.argumentsSha256 ||
    workspaceScopeFromArguments(argumentsValue) !== normalized.workspaceScope ||
    sha256(normalized.workspaceScope) !== normalized.workspaceScopeSha256 ||
    sha256(canonicalJson(normalized)) !== value["contentSha256"]
  ) {
    throw new Error("Tool invocation capsule binding is invalid");
  }
  return { ...normalized, contentSha256: value["contentSha256"] };
}

export function createToolInvocationCapsuleReceipt(
  capsule: ToolInvocationCapsule,
  capsuleBytes = Buffer.byteLength(canonicalJson(capsule), "utf8"),
): ToolInvocationCapsuleReceipt {
  const content = {
    kind: "napier.tool-invocation-capsule-receipt" as const,
    schemaVersion: 1 as const,
    callId: capsule.callId,
    toolName: capsule.toolName,
    effect: "read" as const,
    toolDefinitionSha256: capsule.toolDefinitionSha256,
    argumentsSha256: capsule.argumentsSha256,
    workspaceScopeSha256: capsule.workspaceScopeSha256,
    capsuleSha256: capsule.contentSha256,
    capsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateToolInvocationCapsuleReceipt(
  input: unknown,
): ToolInvocationCapsuleReceipt {
  const value = record(input, "Tool invocation capsule receipt");
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "callId",
    "toolName",
    "effect",
    "toolDefinitionSha256",
    "argumentsSha256",
    "workspaceScopeSha256",
    "capsuleSha256",
    "capsuleBytes",
    "storage",
    "contentSha256",
  ]);
  if (
    value["kind"] !== "napier.tool-invocation-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !callId(value["callId"]) ||
    typeof value["toolName"] !== "string" ||
    !TOOL_NAME.test(value["toolName"]) ||
    !TOOL_INVOCATION_EXPERIMENT_TOOLS.has(value["toolName"]) ||
    value["effect"] !== "read" ||
    !hash(value["toolDefinitionSha256"]) ||
    !hash(value["argumentsSha256"]) ||
    !hash(value["workspaceScopeSha256"]) ||
    !hash(value["capsuleSha256"]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    Number(value["capsuleBytes"]) > MAX_TOOL_INVOCATION_CAPSULE_BYTES ||
    value["storage"] !== "local_only" ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Tool invocation capsule receipt is invalid");
  }
  const content = {
    kind: "napier.tool-invocation-capsule-receipt" as const,
    schemaVersion: 1 as const,
    callId: value["callId"] as string,
    toolName: value["toolName"],
    effect: "read" as const,
    toolDefinitionSha256: value["toolDefinitionSha256"],
    argumentsSha256: value["argumentsSha256"],
    workspaceScopeSha256: value["workspaceScopeSha256"],
    capsuleSha256: value["capsuleSha256"],
    capsuleBytes: Number(value["capsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Tool invocation capsule receipt hash is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

export function toolDefinitionSha256(
  tool: Pick<
    AgentTool,
    "name" | "description" | "parameters" | "prepareArguments" | "execute"
  >,
): string {
  return sha256(
    canonicalJson({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      prepareArgumentsSha256: sha256(
        tool.prepareArguments
          ? Function.prototype.toString.call(tool.prepareArguments)
          : "",
      ),
      executeSha256: sha256(Function.prototype.toString.call(tool.execute)),
    }),
  );
}

export function toolInvocationArgumentsSha256(argumentsValue: unknown): string {
  return sha256(canonicalJson(normalizeJson(argumentsValue)));
}

function workspaceScopeFromArguments(argumentsValue: JsonValue): string {
  const value = record(argumentsValue, "Tool invocation arguments");
  const scope = value["path"] === undefined ? "." : value["path"];
  if (typeof scope !== "string" || !validWorkspaceScope(scope)) {
    throw new Error("Tool invocation workspace scope is invalid");
  }
  return scope;
}

function validWorkspaceScope(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    !path.isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function normalizeJson(value: unknown): JsonValue {
  let normalized: JsonValue;
  try {
    normalized = JSON.parse(canonicalJson(value)) as JsonValue;
  } catch {
    throw new Error("Tool invocation arguments are not JSON serializable");
  }
  if (
    Buffer.byteLength(canonicalJson(normalized), "utf8") >
    MAX_TOOL_INVOCATION_CAPSULE_BYTES
  ) {
    throw new Error("Tool invocation arguments exceed their byte limit");
  }
  return normalized;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error("Tool invocation capsule fields are invalid");
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

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

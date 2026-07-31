import {
  NAPIER_RPC_PROTOCOL_VERSION,
  type ModelRef,
  type NapierRpcAgentResumeParams,
  type NapierRpcAgentRunParams,
  type NapierRpcErrorResponse,
  type NapierRpcId,
  type NapierRpcSuccessResponse,
} from "@napier/contracts";
import { sha256 } from "@napier/runtime";

export { NAPIER_RPC_PROTOCOL_VERSION };
export const MAX_RPC_LINE_BYTES = 1024 * 1024;
export const MAX_RPC_ACTIVE_REQUESTS = 4;

export type JsonRpcId = NapierRpcId;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  id?: never;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export type JsonRpcSuccess = NapierRpcSuccessResponse<unknown>;
export type JsonRpcError = NapierRpcErrorResponse;
export type RpcAgentRunParams = NapierRpcAgentRunParams;
export type RpcAgentResumeParams = NapierRpcAgentResumeParams;

export class JsonRpcProtocolError extends Error {
  constructor(
    readonly code: number,
    readonly publicMessage: string,
    readonly responseId: JsonRpcId | null,
    message: string,
  ) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}

const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;
const METHOD = /^[A-Za-z0-9_.$/-]{1,120}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const MAX_PROMPT_BYTES = 64 * 1024;

export function parseJsonRpcMessage(line: string): JsonRpcMessage {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new JsonRpcProtocolError(
      -32700,
      "Parse error",
      null,
      "RPC input is not valid JSON",
    );
  }
  if (!record(value)) {
    throw invalidRequest(null, "RPC message must be an object");
  }
  const id = rpcId(value["id"]);
  const responseId = id ?? null;
  const allowed = new Set(["jsonrpc", "id", "method", "params"]);
  if (
    value["jsonrpc"] !== "2.0" ||
    typeof value["method"] !== "string" ||
    !METHOD.test(value["method"]) ||
    Object.keys(value).some((key) => !allowed.has(key)) ||
    (Object.hasOwn(value, "id") && id === undefined) ||
    (value["params"] !== undefined && !record(value["params"]))
  ) {
    throw invalidRequest(responseId, "RPC message shape is invalid");
  }
  const base = {
    jsonrpc: "2.0" as const,
    method: value["method"],
    ...(record(value["params"]) ? { params: value["params"] } : {}),
  };
  return id === undefined ? base : { ...base, id };
}

export function parseInitializeParams(
  input: Record<string, unknown> | undefined,
): { clientInfo?: { name: string; version?: string } } {
  const value = input ?? {};
  exactKeys(value, ["clientInfo"]);
  if (value["clientInfo"] === undefined) return {};
  if (!record(value["clientInfo"])) invalidParams("clientInfo is invalid");
  exactKeys(value["clientInfo"], ["name", "version"]);
  const name = boundedText(value["clientInfo"]["name"], 1, 120);
  const version =
    value["clientInfo"]["version"] === undefined
      ? undefined
      : boundedText(value["clientInfo"]["version"], 1, 80);
  return {
    clientInfo: {
      name,
      ...(version !== undefined ? { version } : {}),
    },
  };
}

export function parseAgentRunParams(
  input: Record<string, unknown> | undefined,
): RpcAgentRunParams {
  if (!input) invalidParams("Agent run params are required");
  exactKeys(input, ["prompt", "threadId", "agentId", "title", "model"]);
  const prompt = boundedText(input["prompt"], 1, MAX_PROMPT_BYTES, true);
  const threadId = optionalResourceId(input["threadId"], "threadId");
  const agentId = optionalResourceId(input["agentId"], "agentId");
  const title =
    input["title"] === undefined
      ? undefined
      : boundedText(input["title"], 1, 160);
  if (threadId && title) {
    invalidParams("title cannot be used with an existing Thread");
  }
  const model = optionalModel(input["model"]);
  return {
    prompt,
    ...(threadId ? { threadId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(title ? { title } : {}),
    ...(model ? { model } : {}),
  };
}

export function parseAgentResumeParams(
  input: Record<string, unknown> | undefined,
): RpcAgentResumeParams {
  if (!input) invalidParams("Agent resume params are required");
  exactKeys(input, ["threadId", "runId", "model"]);
  const threadId = resourceId(input["threadId"], "threadId");
  const runId =
    input["runId"] === undefined
      ? undefined
      : typeof input["runId"] === "string" && RUN_ID.test(input["runId"])
        ? input["runId"]
        : invalidParams("runId is invalid");
  const model = optionalModel(input["model"]);
  return {
    threadId,
    ...(runId ? { runId } : {}),
    ...(model ? { model } : {}),
  };
}

export function parseCancelParams(
  input: Record<string, unknown> | undefined,
): JsonRpcId {
  if (!input) invalidParams("Cancellation params are required");
  exactKeys(input, ["id"]);
  const id = rpcId(input["id"]);
  if (id === undefined) invalidParams("Cancellation id is invalid");
  return id;
}

export function rpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  error?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(error !== undefined
        ? { data: { diagnosticSha256: sha256(errorMessage(error)) } }
        : {}),
    },
  };
}

function rpcId(value: unknown): JsonRpcId | undefined {
  if (typeof value === "string" && REQUEST_ID.test(value)) return value;
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value);
  return undefined;
}

function optionalResourceId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : resourceId(value, label);
}

function resourceId(value: unknown, label: string): string {
  if (typeof value !== "string" || !RESOURCE_ID.test(value)) {
    invalidParams(`${label} is invalid`);
  }
  return value;
}

function optionalModel(value: unknown): ModelRef | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) invalidParams("model is invalid");
  exactKeys(value, ["provider", "id"]);
  if (
    typeof value["provider"] !== "string" ||
    !PROVIDER_ID.test(value["provider"]) ||
    typeof value["id"] !== "string" ||
    !MODEL_ID.test(value["id"])
  ) {
    invalidParams("model is invalid");
  }
  return { provider: value["provider"], id: value["id"] };
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  bytes = false,
): string {
  if (typeof value !== "string") invalidParams("text is invalid");
  const normalized = value.trim();
  const length = bytes
    ? Buffer.byteLength(normalized, "utf8")
    : normalized.length;
  if (
    length < minimum ||
    length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) {
    invalidParams("text is invalid");
  }
  return normalized;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalidParams("params contain unknown fields");
  }
}

function invalidRequest(
  id: JsonRpcId | null,
  message: string,
): JsonRpcProtocolError {
  return new JsonRpcProtocolError(-32600, "Invalid Request", id, message);
}

function invalidParams(message: string): never {
  throw new JsonRpcProtocolError(-32602, "Invalid params", null, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

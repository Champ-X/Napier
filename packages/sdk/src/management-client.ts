import {
  isEffectiveAgentCapabilityProjectionV1,
  type EffectiveAgentCapabilityProjectionV1,
} from "@napier/contracts/agent-capability-contract";
import {
  isNapierManagementHttpErrorCode,
  managementHttpErrorCodeForStatus,
  type NapierManagementClientErrorData,
  type NapierManagementOperation,
} from "@napier/contracts/management-http";

import { NapierManagementClientError } from "./management-client-error.js";

const OPERATION: NapierManagementOperation = "get_effective_agent_capabilities";
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const MIN_REQUEST_TIMEOUT_MS = 1;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JSON_CONTENT_TYPE =
  /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/iu;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface NapierManagementClientOptions {
  baseUrl: string | URL;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export interface GetEffectiveAgentCapabilitiesOptions {
  agentId: string;
  signal?: AbortSignal;
}

export interface NapierManagementClient {
  getEffectiveAgentCapabilities(
    options: GetEffectiveAgentCapabilitiesOptions,
  ): Promise<EffectiveAgentCapabilityProjectionV1>;
}

export function createNapierManagementClient(
  options: NapierManagementClientOptions,
): NapierManagementClient {
  if (!options || typeof options !== "object") {
    throw new TypeError("Napier management client options are required");
  }
  const baseUrl = managementOrigin(options.baseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Napier management fetch must be a function");
  }
  const requestTimeoutMs = requestTimeout(options.requestTimeoutMs);
  return Object.freeze({
    async getEffectiveAgentCapabilities(
      methodOptions: GetEffectiveAgentCapabilitiesOptions,
    ): Promise<EffectiveAgentCapabilityProjectionV1> {
      const agentId = validatedAgentId(methodOptions?.agentId);
      const callerSignal = methodOptions?.signal;
      if (
        callerSignal !== undefined &&
        !(callerSignal instanceof AbortSignal)
      ) {
        throw new TypeError("Napier management signal must be an AbortSignal");
      }
      return getEffectiveAgentCapabilities({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        agentId,
        ...(callerSignal ? { callerSignal } : {}),
      });
    },
  });
}

async function getEffectiveAgentCapabilities(input: {
  baseUrl: URL;
  fetchImplementation: typeof globalThis.fetch;
  requestTimeoutMs: number;
  agentId: string;
  callerSignal?: AbortSignal;
}): Promise<EffectiveAgentCapabilityProjectionV1> {
  const timeoutSignal = AbortSignal.timeout(input.requestTimeoutMs);
  throwTransportIfAborted(input.callerSignal, timeoutSignal);
  const signal = input.callerSignal
    ? AbortSignal.any([input.callerSignal, timeoutSignal])
    : timeoutSignal;
  const url = new URL(
    `api/agents/${encodeURIComponent(input.agentId)}/capabilities`,
    input.baseUrl,
  );
  let response: Response;
  try {
    response = await input.fetchImplementation(url.href, {
      method: "GET",
      redirect: "error",
      signal,
    });
  } catch {
    throw transportError(input.callerSignal, timeoutSignal);
  }
  throwTransportIfAborted(input.callerSignal, timeoutSignal);
  if (response.redirected) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "redirected",
    });
  }
  if (response.ok && response.status !== 200) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "unexpected_status",
    });
  }
  if (response.status === 200) {
    return parseSuccessResponse(
      response,
      input.agentId,
      input.callerSignal,
      timeoutSignal,
    );
  }
  return parseErrorResponse(response, input.callerSignal, timeoutSignal);
}

async function parseSuccessResponse(
  response: Response,
  agentId: string,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<EffectiveAgentCapabilityProjectionV1> {
  if (!JSON_CONTENT_TYPE.test(response.headers.get("content-type") ?? "")) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "content_type_invalid",
    });
  }
  const bytes = await readResponseBytes(response, callerSignal, timeoutSignal);
  await verifyContentDigest(response, bytes, callerSignal, timeoutSignal);
  const parsed = decodeJson(bytes, response.status);
  if (!isEffectiveAgentCapabilityProjectionV1(parsed)) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "projection_invalid",
    });
  }
  if (parsed.agentId !== agentId) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "agent_identity_mismatch",
    });
  }
  verifyProjectionDigest(response, parsed.projectionSha256);
  return parsed;
}

async function parseErrorResponse(
  response: Response,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<never> {
  const bytes = await readResponseBytes(response, callerSignal, timeoutSignal);
  const contentSha256 = await verifyContentDigest(
    response,
    bytes,
    callerSignal,
    timeoutSignal,
  );
  const parsed = decodeJson(bytes, response.status);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof (parsed as { error?: unknown }).error !== "string"
  ) {
    throw clientError({
      kind: "protocol",
      operation: OPERATION,
      status: response.status,
      reason: "error_envelope_invalid",
    });
  }
  const serverMessage = (parsed as { error: string }).error;
  verifyErrorStatus(response);
  const code = verifyErrorCode(response);
  const messageSha256 = await verifyErrorMessageDigest(
    response,
    serverMessage,
    callerSignal,
    timeoutSignal,
  );
  throw clientError({
    kind: "http",
    operation: OPERATION,
    status: response.status,
    code,
    serverMessage,
    contentSha256,
    messageSha256,
  });
}

async function readResponseBytes(
  response: Response,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/u.test(contentLength) &&
    BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw protocolError(response.status, "response_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwTransportIfAborted(callerSignal, timeoutSignal);
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw transportError(callerSignal, timeoutSignal);
      }
      throwTransportIfAborted(callerSignal, timeoutSignal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw protocolError(response.status, "response_too_large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function verifyContentDigest(
  response: Response,
  bytes: Uint8Array,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<string> {
  if (response.headers.get("x-napier-content-sha256-mode") !== "body") {
    throw integrityError(response.status, "content_hash_mode_invalid");
  }
  const expected = response.headers.get("x-napier-content-sha256");
  if (expected === null) {
    throw integrityError(response.status, "content_hash_missing");
  }
  if (!SHA256_PATTERN.test(expected)) {
    throw integrityError(response.status, "content_hash_invalid");
  }
  const actual = await sha256Bytes(bytes);
  throwTransportIfAborted(callerSignal, timeoutSignal);
  if (actual !== expected) {
    throw integrityError(response.status, "content_hash_mismatch", {
      expectedSha256: expected,
      actualSha256: actual,
    });
  }
  return expected;
}

function verifyProjectionDigest(response: Response, actual: string): void {
  const expected = response.headers.get(
    "x-napier-agent-capability-projection-sha256",
  );
  if (expected === null) {
    throw integrityError(response.status, "projection_hash_missing");
  }
  if (!SHA256_PATTERN.test(expected)) {
    throw integrityError(response.status, "projection_hash_invalid");
  }
  if (expected !== actual) {
    throw integrityError(response.status, "projection_hash_mismatch", {
      expectedSha256: expected,
      actualSha256: actual,
    });
  }
}

function verifyErrorStatus(response: Response): void {
  const value = response.headers.get("x-napier-error-status");
  if (value === null)
    throw protocolError(response.status, "error_status_missing");
  if (!/^\d{3}$/u.test(value)) {
    throw protocolError(response.status, "error_status_invalid");
  }
  if (Number(value) !== response.status) {
    throw protocolError(response.status, "error_status_mismatch");
  }
}

function verifyErrorCode(response: Response) {
  const value = response.headers.get("x-napier-error-code");
  if (value === null)
    throw protocolError(response.status, "error_code_missing");
  if (!isNapierManagementHttpErrorCode(value)) {
    throw protocolError(response.status, "error_code_invalid");
  }
  if (value !== managementHttpErrorCodeForStatus(response.status)) {
    throw protocolError(response.status, "error_code_mismatch");
  }
  return value;
}

async function verifyErrorMessageDigest(
  response: Response,
  message: string,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<string> {
  const expected = response.headers.get("x-napier-error-message-sha256");
  if (expected === null) {
    throw integrityError(response.status, "error_message_hash_missing");
  }
  if (!SHA256_PATTERN.test(expected)) {
    throw integrityError(response.status, "error_message_hash_invalid");
  }
  const actual = await sha256Bytes(new TextEncoder().encode(message));
  throwTransportIfAborted(callerSignal, timeoutSignal);
  if (expected !== actual) {
    throw integrityError(response.status, "error_message_hash_mismatch", {
      expectedSha256: expected,
      actualSha256: actual,
    });
  }
  return expected;
}

function decodeJson(bytes: Uint8Array, status: number): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw protocolError(status, "utf8_invalid");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw protocolError(status, "json_invalid");
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function managementOrigin(value: string | URL): URL {
  if (typeof value !== "string" && !(value instanceof URL)) {
    throw new TypeError("Napier management baseUrl must be a string or URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.toString());
  } catch {
    throw new TypeError("Napier management baseUrl must be a valid URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("Napier management baseUrl must be an HTTP(S) origin");
  }
  return new URL(parsed.origin);
}

function requestTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_REQUEST_TIMEOUT_MS ||
    timeout > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new TypeError(
      "Napier management requestTimeoutMs must be an integer from 1 through 30000",
    );
  }
  return timeout;
}

function validatedAgentId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    ASCII_CONTROL_PATTERN.test(value) ||
    new TextEncoder().encode(value).byteLength > 256
  ) {
    throw new TypeError(
      "Napier management agentId must be a trimmed non-empty string of at most 256 UTF-8 bytes without ASCII controls",
    );
  }
  return value;
}

function throwTransportIfAborted(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): void {
  if (callerSignal?.aborted || timeoutSignal.aborted) {
    throw transportError(callerSignal, timeoutSignal);
  }
}

function transportError(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): NapierManagementClientError {
  return clientError({
    kind: "transport",
    operation: OPERATION,
    reason: callerSignal?.aborted
      ? "aborted"
      : timeoutSignal.aborted
        ? "timeout"
        : "network_failure",
  });
}

function integrityError(
  status: number,
  reason: Extract<
    NapierManagementClientErrorData,
    { kind: "integrity" }
  >["reason"],
  hashes?: { expectedSha256: string; actualSha256: string },
): NapierManagementClientError {
  return clientError({
    kind: "integrity",
    operation: OPERATION,
    status,
    reason,
    ...(hashes ?? {}),
  });
}

function protocolError(
  status: number,
  reason: Extract<
    NapierManagementClientErrorData,
    { kind: "protocol" }
  >["reason"],
): NapierManagementClientError {
  return clientError({
    kind: "protocol",
    operation: OPERATION,
    status,
    reason,
  });
}

function clientError(
  data: NapierManagementClientErrorData,
): NapierManagementClientError {
  return new NapierManagementClientError(data);
}

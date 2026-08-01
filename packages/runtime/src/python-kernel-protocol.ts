import type { JsonValue } from "@napier/contracts";

import { MAX_PYTHON_KERNEL_JSON_VALUE_BYTES } from "./python-kernel-json-worker.js";
import {
  MAX_PYTHON_KERNEL_CONSOLE_CHARS,
  MAX_PYTHON_KERNEL_CONSOLE_ENTRIES,
  MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_PYTHON_KERNEL_PREVIEW_CHARS,
  MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES,
  PYTHON_KERNEL_PROTOCOL_PREFIX,
} from "./python-kernel-worker.js";

const PYTHON_KERNEL_VALUE_TYPES = new Set([
  "none",
  "boolean",
  "integer",
  "float",
  "complex",
  "string",
  "bytes",
  "list",
  "tuple",
  "dict",
  "set",
  "function",
  "object",
  "error",
]);

export type PythonKernelValueType =
  | "none"
  | "boolean"
  | "integer"
  | "float"
  | "complex"
  | "string"
  | "bytes"
  | "list"
  | "tuple"
  | "dict"
  | "set"
  | "function"
  | "object"
  | "error";

export interface PythonKernelProtocolResult {
  kind: "napier.python-kernel-result";
  schemaVersion: 1;
  id: string;
  status: "ok" | "error";
  terminal: boolean;
  valueType: PythonKernelValueType;
  preview: string;
  jsonValue?: JsonValue;
  previewTruncated: boolean;
  console: string[];
  consoleTruncated: boolean;
  durationMs: number;
  pythonVersion: string;
  memoryPeakBytes: number;
  memoryLimitBytes: number;
}

export function parsePythonKernelResult(
  line: string,
  requestId: string,
): PythonKernelProtocolResult | undefined {
  if (!line.startsWith(PYTHON_KERNEL_PROTOCOL_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(PYTHON_KERNEL_PROTOCOL_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!record(value) || !hasOnlyProtocolKeys(value)) return undefined;
  const status = value["status"];
  const terminal = value["terminal"];
  const valueType = value["valueType"];
  const preview = decodeUtf16Base64(
    value["previewUtf16Base64"],
    MAX_PYTHON_KERNEL_PREVIEW_CHARS,
  );
  const previewTruncated = value["previewTruncated"];
  const jsonValue = decodeJsonValue(value["jsonValueUtf8Base64"]);
  const consoleEntries = decodePythonKernelConsole(value["consoleUtf16Base64"]);
  const consoleTruncated = value["consoleTruncated"];
  const durationMs = value["durationMs"];
  const pythonVersion = value["pythonVersion"];
  const memoryPeakBytes = value["memoryPeakBytes"];
  const memoryLimitBytes = value["memoryLimitBytes"];
  if (
    value["kind"] !== "napier.python-kernel-result" ||
    value["schemaVersion"] !== 1 ||
    value["id"] !== requestId ||
    (status !== "ok" && status !== "error") ||
    typeof terminal !== "boolean" ||
    !pythonKernelValueType(valueType) ||
    preview === undefined ||
    jsonValue.valid !== true ||
    typeof previewTruncated !== "boolean" ||
    consoleEntries === undefined ||
    typeof consoleTruncated !== "boolean" ||
    !boundedInteger(
      durationMs,
      0,
      MAX_PYTHON_KERNEL_EVALUATION_TIMEOUT_MS + 1_000,
    ) ||
    typeof pythonVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(pythonVersion) ||
    !boundedInteger(
      memoryPeakBytes,
      0,
      MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES * 16,
    ) ||
    memoryLimitBytes !== MAX_PYTHON_KERNEL_TRACED_MEMORY_BYTES ||
    (status === "ok"
      ? valueType === "error" || terminal !== false
      : valueType !== "error")
  ) {
    return undefined;
  }
  return {
    kind: "napier.python-kernel-result",
    schemaVersion: 1,
    id: requestId,
    status,
    terminal,
    valueType,
    preview,
    ...(jsonValue.available ? { jsonValue: jsonValue.value! } : {}),
    previewTruncated,
    console: consoleEntries.slice(),
    consoleTruncated,
    durationMs: Number(durationMs),
    pythonVersion,
    memoryPeakBytes: Number(memoryPeakBytes),
    memoryLimitBytes: Number(memoryLimitBytes),
  };
}

function hasOnlyProtocolKeys(value: Record<string, unknown>): boolean {
  const allowed = new Set([
    "kind",
    "schemaVersion",
    "id",
    "status",
    "terminal",
    "valueType",
    "previewUtf16Base64",
    "jsonValueUtf8Base64",
    "previewTruncated",
    "consoleUtf16Base64",
    "consoleTruncated",
    "durationMs",
    "pythonVersion",
    "memoryPeakBytes",
    "memoryLimitBytes",
  ]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function decodeJsonValue(value: unknown): {
  valid: boolean;
  available: boolean;
  value?: JsonValue;
} {
  if (value === null) return { valid: true, available: false };
  if (typeof value !== "string") return { valid: false, available: false };
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_PYTHON_KERNEL_JSON_VALUE_BYTES ||
    bytes.toString("base64") !== value
  ) {
    return { valid: false, available: false };
  }
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0) {
    return { valid: false, available: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { valid: false, available: false };
  }
  if (!jsonValue(parsed, 0, { nodes: 0 })) {
    return { valid: false, available: false };
  }
  return {
    valid: true,
    available: true,
    value: parsed as JsonValue,
  };
}

function jsonValue(
  value: unknown,
  depth: number,
  state: { nodes: number },
): value is JsonValue {
  state.nodes += 1;
  if (state.nodes > 4_096 || depth > 16) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isSafeInteger(value)
      ? true
      : Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => jsonValue(item, depth + 1, state));
  }
  if (!record(value)) return false;
  return Object.values(value).every((item) =>
    jsonValue(item, depth + 1, state),
  );
}

function pythonKernelValueType(value: unknown): value is PythonKernelValueType {
  return typeof value === "string" && PYTHON_KERNEL_VALUE_TYPES.has(value);
}

function decodePythonKernelConsole(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PYTHON_KERNEL_CONSOLE_ENTRIES
  ) {
    return undefined;
  }
  const decoded = value.map((entry) =>
    decodeUtf16Base64(entry, MAX_PYTHON_KERNEL_CONSOLE_CHARS),
  );
  return decoded.every((entry) => entry !== undefined)
    ? (decoded as string[])
    : undefined;
}

function decodeUtf16Base64(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength % 2 !== 0) return undefined;
  const decoded = bytes.toString("utf16le");
  if (
    decoded.length > maxChars ||
    Buffer.from(decoded, "utf16le").toString("base64") !== value
  ) {
    return undefined;
  }
  return decoded;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

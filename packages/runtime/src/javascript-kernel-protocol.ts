import {
  JAVASCRIPT_KERNEL_PROTOCOL_PREFIX,
  MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS,
  MAX_JAVASCRIPT_KERNEL_CONSOLE_ENTRIES,
  MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS,
  MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS,
} from "./javascript-kernel-worker.js";

const JAVASCRIPT_KERNEL_VALUE_TYPES = new Set([
  "undefined",
  "null",
  "array",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "function",
  "object",
  "error",
]);

export type JavascriptKernelValueType =
  | "undefined"
  | "null"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "function"
  | "object"
  | "error";

export interface JavascriptKernelProtocolResult {
  kind: "napier.javascript-kernel-result";
  schemaVersion: 1;
  id: string;
  status: "ok" | "error";
  terminal: boolean;
  valueType: JavascriptKernelValueType;
  preview: string;
  previewTruncated: boolean;
  console: string[];
  consoleTruncated: boolean;
  durationMs: number;
}

export function parseJavascriptKernelResult(
  line: string,
  requestId: string,
): JavascriptKernelProtocolResult | undefined {
  if (!line.startsWith(JAVASCRIPT_KERNEL_PROTOCOL_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(JAVASCRIPT_KERNEL_PROTOCOL_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!record(value) || !hasOnlyProtocolKeys(value)) return undefined;
  const status = value["status"];
  const terminal = value["terminal"];
  const valueType = value["valueType"];
  const preview = decodeUtf16Base64(
    value["previewUtf16Base64"],
    MAX_JAVASCRIPT_KERNEL_PREVIEW_CHARS,
  );
  const previewTruncated = value["previewTruncated"];
  const consoleEntries = decodeJavascriptKernelConsole(
    value["consoleUtf16Base64"],
  );
  const consoleTruncated = value["consoleTruncated"];
  const durationMs = value["durationMs"];
  if (
    value["kind"] !== "napier.javascript-kernel-result" ||
    value["schemaVersion"] !== 1 ||
    value["id"] !== requestId ||
    (status !== "ok" && status !== "error") ||
    typeof terminal !== "boolean" ||
    !javascriptKernelValueType(valueType) ||
    preview === undefined ||
    typeof previewTruncated !== "boolean" ||
    consoleEntries === undefined ||
    typeof consoleTruncated !== "boolean" ||
    !boundedInteger(
      durationMs,
      0,
      MAX_JAVASCRIPT_KERNEL_EVALUATION_TIMEOUT_MS + 1_000,
    ) ||
    (status === "ok"
      ? valueType === "error" || terminal !== false
      : valueType !== "error")
  ) {
    return undefined;
  }
  return {
    kind: "napier.javascript-kernel-result",
    schemaVersion: 1,
    id: requestId,
    status,
    terminal,
    valueType,
    preview,
    previewTruncated,
    console: consoleEntries.slice(),
    consoleTruncated,
    durationMs: Number(durationMs),
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
    "previewTruncated",
    "consoleUtf16Base64",
    "consoleTruncated",
    "durationMs",
  ]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function javascriptKernelValueType(
  value: unknown,
): value is JavascriptKernelValueType {
  return typeof value === "string" && JAVASCRIPT_KERNEL_VALUE_TYPES.has(value);
}

function decodeJavascriptKernelConsole(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_JAVASCRIPT_KERNEL_CONSOLE_ENTRIES
  ) {
    return undefined;
  }
  const decoded = value.map((entry) =>
    decodeUtf16Base64(entry, MAX_JAVASCRIPT_KERNEL_CONSOLE_CHARS),
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

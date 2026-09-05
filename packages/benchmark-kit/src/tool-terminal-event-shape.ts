import { isToolUiProjectionV2 } from "@napier/contracts/tool-protocol";

const REQUIRED_KEYS = [
  "callId",
  "toolName",
  "status",
  "outputTextSha256",
  "outputTextBytes",
  "outputSha256",
  "outputBytes",
  "outputRedacted",
  "details",
  "toolProtocol",
] as const;
const OPTIONAL_KEYS = [
  "resultSha256",
  "operationSetSha256",
  "toolOperationSet",
] as const;
const OPERATION_SET_KEYS = [
  "kind",
  "schemaVersion",
  "parentCallId",
  "operationCount",
  "settledOperationCount",
  "operationSetSha256",
] as const;

export interface CompletedToolPayloadExpectation {
  toolId: string;
  resultSha256: "required" | "optional" | "forbidden";
}

/**
 * Shared verifier for runtime-owned fields on a completed Tool event.
 * Tool-specific benchmark readers remain responsible only for `details`.
 */
export function completedToolEventPayload(
  value: unknown,
  expectation: CompletedToolPayloadExpectation,
): Record<string, unknown> | undefined {
  if (completedToolEventPayloadDiagnostics(value, expectation).length > 0) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function completedToolEventPayloadDiagnostics(
  value: unknown,
  expectation: CompletedToolPayloadExpectation,
): string[] {
  if (!exactOptionalRecord(value, REQUIRED_KEYS, OPTIONAL_KEYS)) {
    const observed = record(value) ? Object.keys(value) : [];
    return [
      "fields_invalid",
      ...REQUIRED_KEYS.filter((key) => !observed.includes(key)).map(
        (key) => `missing_${key}`,
      ),
      ...observed
        .filter(
          (key) =>
            !(REQUIRED_KEYS as readonly string[]).includes(key) &&
            !(OPTIONAL_KEYS as readonly string[]).includes(key),
        )
        .map((key) => `extra_${key}`),
    ];
  }
  const diagnostics: string[] = [];
  if (!boundedString(value["callId"], 1, 200)) diagnostics.push("call_id");
  if (value["toolName"] !== expectation.toolId) diagnostics.push("tool_id");
  if (value["status"] !== "completed") diagnostics.push("status");
  if (!digest(value["outputTextSha256"])) diagnostics.push("output_text_hash");
  if (!nonNegativeInteger(value["outputTextBytes"]))
    diagnostics.push("output_text_bytes");
  if (!digest(value["outputSha256"])) diagnostics.push("output_hash");
  if (!nonNegativeInteger(value["outputBytes"]))
    diagnostics.push("output_bytes");
  if (value["outputRedacted"] !== true) diagnostics.push("output_redaction");
  if (!record(value["details"])) diagnostics.push("details");
  if (
    !isToolUiProjectionV2(value["toolProtocol"], {
      toolId: expectation.toolId,
      status: "completed",
    })
  ) {
    diagnostics.push("tool_protocol");
  }
  if (!resultHashMatchesExpectation(value["resultSha256"], expectation)) {
    diagnostics.push("result_hash");
  }
  if (!operationSetProjectionValid(value)) diagnostics.push("operation_set");
  return diagnostics;
}

function resultHashMatchesExpectation(
  value: unknown,
  expectation: CompletedToolPayloadExpectation,
): boolean {
  if (expectation.resultSha256 === "required") return digest(value);
  if (expectation.resultSha256 === "forbidden") return value === undefined;
  return value === undefined || digest(value);
}

function operationSetProjectionValid(
  payload: Record<string, unknown>,
): boolean {
  const outer = payload["operationSetSha256"];
  const set = payload["toolOperationSet"];
  if (outer === undefined && set === undefined) return true;
  if (!digest(outer) || !exactRecord(set, OPERATION_SET_KEYS)) return false;
  return (
    set["kind"] === "napier.tool-operation-set" &&
    set["schemaVersion"] === 1 &&
    set["parentCallId"] === payload["callId"] &&
    nonNegativeInteger(set["operationCount"]) &&
    nonNegativeInteger(set["settledOperationCount"]) &&
    Number(set["settledOperationCount"]) <= Number(set["operationCount"]) &&
    set["operationSetSha256"] === outer
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function exactOptionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (!record(value) || required.some((key) => !Object.hasOwn(value, key))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

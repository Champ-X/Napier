import type { ExecutionPlanWorkflowExperimentToolEffects } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";

export const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
export const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
export const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error("Workflow experiment fields are invalid");
  }
}

export function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

export function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function toolNameList(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 64 ||
    input.some(
      (value) => typeof value !== "string" || !TOOL_NAME.test(value),
    ) ||
    new Set(input).size !== input.length ||
    canonicalJson(input) !==
      canonicalJson(
        [...input].sort((left, right) =>
          String(left).localeCompare(String(right)),
        ),
      )
  ) {
    throw new Error("Workflow experiment tool names are invalid");
  }
  return [...input] as string[];
}

export function validateToolEffects(
  input: unknown,
  index: number,
): ExecutionPlanWorkflowExperimentToolEffects {
  const effects = record(
    input,
    `Workflow experiment tool effects ${String(index + 1)}`,
  );
  assertExactKeys(effects, [
    "nodeId",
    "attemptCount",
    "toolCallCount",
    "readOnlyCount",
    "writeCount",
    "unknownCount",
    "unresolvedCount",
    "writeToolNames",
    "unknownToolNames",
  ]);
  if (
    typeof effects["nodeId"] !== "string" ||
    !RESOURCE_ID.test(effects["nodeId"])
  ) {
    throw new Error("Workflow experiment tool effect node is invalid");
  }
  for (const key of [
    "attemptCount",
    "toolCallCount",
    "readOnlyCount",
    "writeCount",
    "unknownCount",
    "unresolvedCount",
  ]) {
    if (!nonNegativeInteger(effects[key])) {
      throw new Error("Workflow experiment tool effect count is invalid");
    }
  }
  if (
    Number(effects["toolCallCount"]) !==
      Number(effects["readOnlyCount"]) +
        Number(effects["writeCount"]) +
        Number(effects["unknownCount"]) ||
    Number(effects["unresolvedCount"]) > Number(effects["toolCallCount"])
  ) {
    throw new Error("Workflow experiment tool effect counts conflict");
  }
  return {
    nodeId: effects["nodeId"],
    attemptCount: Number(effects["attemptCount"]),
    toolCallCount: Number(effects["toolCallCount"]),
    readOnlyCount: Number(effects["readOnlyCount"]),
    writeCount: Number(effects["writeCount"]),
    unknownCount: Number(effects["unknownCount"]),
    unresolvedCount: Number(effects["unresolvedCount"]),
    writeToolNames: toolNameList(effects["writeToolNames"]),
    unknownToolNames: toolNameList(effects["unknownToolNames"]),
  };
}

export function assertEncodedBytes(
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

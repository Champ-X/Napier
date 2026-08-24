import type {
  ToolLoopGuardContextReceipt,
  ToolLoopGuardTriggerReceipt,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";

export const MIN_TOOL_LOOP_GUARD_THRESHOLD = 2;
export const MAX_TOOL_LOOP_GUARD_THRESHOLD = 8;
export const MAX_TOOL_LOOP_GUARD_EXEMPT_TOOLS = 32;
export const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function parseToolLoopGuardContextReceipt(
  input: unknown,
): ToolLoopGuardContextReceipt | undefined {
  if (!record(input)) return undefined;
  const keys = [
    "kind",
    "schemaVersion",
    "enabled",
    "threshold",
    "exemptToolCount",
    "exemptToolSetSha256",
    "policySha256",
    "contentSha256",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    input["kind"] !== "napier.tool-loop-guard-context" ||
    input["schemaVersion"] !== 1 ||
    typeof input["enabled"] !== "boolean"
  ) {
    return undefined;
  }
  const threshold = boundedInteger(
    input["threshold"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const exemptToolCount = boundedInteger(
    input["exemptToolCount"],
    0,
    MAX_TOOL_LOOP_GUARD_EXEMPT_TOOLS,
  );
  const enabled = input["enabled"];
  const exemptToolSetSha256 = hashValue(input["exemptToolSetSha256"]);
  const policySha256 = hashValue(input["policySha256"]);
  const contentSha256 = hashValue(input["contentSha256"]);
  if (
    threshold === undefined ||
    exemptToolCount === undefined ||
    typeof enabled !== "boolean" ||
    exemptToolSetSha256 === undefined ||
    policySha256 === undefined ||
    contentSha256 === undefined
  ) {
    return undefined;
  }
  const content = {
    kind: "napier.tool-loop-guard-context" as const,
    schemaVersion: 1 as const,
    enabled,
    threshold,
    exemptToolCount,
    exemptToolSetSha256,
    policySha256,
  };
  return sha256(canonicalJson(content)) === contentSha256
    ? { ...content, contentSha256 }
    : undefined;
}

export function parseToolLoopGuardTriggerReceipt(
  input: unknown,
): ToolLoopGuardTriggerReceipt | undefined {
  if (!record(input)) return undefined;
  const keys = [
    "kind",
    "schemaVersion",
    "toolName",
    "threshold",
    "attemptCount",
    "fromSeq",
    "toSeq",
    "callSha256",
    "resultSha256",
    "attemptSetSha256",
    "policySha256",
    "contentSha256",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    input["kind"] !== "napier.tool-loop-guard-trigger" ||
    input["schemaVersion"] !== 1 ||
    typeof input["toolName"] !== "string" ||
    !TOOL_NAME.test(input["toolName"])
  ) {
    return undefined;
  }
  const threshold = boundedInteger(
    input["threshold"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const attemptCount = boundedInteger(
    input["attemptCount"],
    MIN_TOOL_LOOP_GUARD_THRESHOLD,
    MAX_TOOL_LOOP_GUARD_THRESHOLD,
  );
  const fromSeq = boundedInteger(input["fromSeq"], 1, Number.MAX_SAFE_INTEGER);
  const toSeq = boundedInteger(input["toSeq"], 1, Number.MAX_SAFE_INTEGER);
  const callSha256 = hashValue(input["callSha256"]);
  const resultSha256 = hashValue(input["resultSha256"]);
  const attemptSetSha256 = hashValue(input["attemptSetSha256"]);
  const policySha256 = hashValue(input["policySha256"]);
  const contentSha256 = hashValue(input["contentSha256"]);
  if (
    threshold === undefined ||
    attemptCount !== threshold ||
    fromSeq === undefined ||
    toSeq === undefined ||
    fromSeq > toSeq ||
    callSha256 === undefined ||
    resultSha256 === undefined ||
    attemptSetSha256 === undefined ||
    policySha256 === undefined ||
    contentSha256 === undefined
  ) {
    return undefined;
  }
  const content = {
    kind: "napier.tool-loop-guard-trigger" as const,
    schemaVersion: 1 as const,
    toolName: input["toolName"],
    threshold,
    attemptCount,
    fromSeq,
    toSeq,
    callSha256,
    resultSha256,
    attemptSetSha256,
    policySha256,
  };
  return sha256(canonicalJson(content)) === contentSha256
    ? { ...content, contentSha256 }
    : undefined;
}

export function hashValue(input: unknown): string | undefined {
  return typeof input === "string" && SHA256.test(input) ? input : undefined;
}

export function boundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(input) &&
    Number(input) >= minimum &&
    Number(input) <= maximum
    ? Number(input)
    : undefined;
}

export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

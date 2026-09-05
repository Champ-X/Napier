import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const TOOL_FAILURE_SHA256 = /^[a-f0-9]{64}$/u;

export function failureDiagnosticSha256(value: unknown): string {
  return sha256(toolFailureDiagnosticText(value).slice(0, 16_000));
}

export function stableFailureBindingSha256(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && TOOL_FAILURE_SHA256.test(value))
    return value;
  try {
    return sha256(
      canonicalJson(JSON.parse(JSON.stringify(value)) as JsonValue),
    );
  } catch {
    return undefined;
  }
}

export function toolFailureDiagnosticText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  const object = failureRecord(value);
  if (object) {
    const output = failureText(object["output"]);
    const content = Array.isArray(object["content"])
      ? object["content"]
          .flatMap((item) => {
            const part = failureRecord(item);
            return part?.["type"] === "text" ? [failureText(part["text"])] : [];
          })
          .join("\n")
      : "";
    return `${output || content}\n${safeFailureDetails(object["details"] ?? value)}`;
  }
  return String(value ?? "tool execution failed");
}

export function failureRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function failureText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeFailureDetails(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown): JsonValue | undefined =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null ||
        Array.isArray(item) ||
        (item && typeof item === "object")
          ? (item as JsonValue)
          : undefined,
    );
  } catch {
    return "";
  }
}

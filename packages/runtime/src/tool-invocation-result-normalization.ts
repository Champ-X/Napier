import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const TOOL_INVOCATION_RESULT_TOOL_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;

export interface ReplayableToolResult {
  content: TextContent[];
  details: JsonValue;
  usage?: JsonValue;
  addedToolNames?: string[];
}

export function toolInvocationResultSha256(
  result: AgentToolResult<unknown>,
): string {
  return sha256(canonicalJson(normalizeReplayableToolResult(result)));
}

export function normalizeReplayableToolResult(
  input: unknown,
): ReplayableToolResult {
  const value = record(input);
  exactResultKeys(value);
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
    input.some(
      (name) =>
        typeof name !== "string" ||
        !TOOL_INVOCATION_RESULT_TOOL_NAME_PATTERN.test(name),
    )
  ) {
    throw new Error("Replayable tool result added tools are invalid");
  }
  return [...input] as string[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Replayable tool result must be an object");
  }
  return value as Record<string, unknown>;
}

function exactResultKeys(value: Record<string, unknown>): void {
  const required = ["content", "details"];
  const allowed = new Set([...required, "usage", "addedToolNames"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Tool invocation result capsule fields are invalid");
  }
}

import type { Usage } from "@earendil-works/pi-ai";

import { canonicalJson } from "./ed25519.js";

export function normalizeConversationSurfaceUsage(input: unknown): Usage {
  const value = record(input, "Conversation Surface tool usage");
  const cost = record(value["cost"], "Conversation Surface tool usage cost");
  assertFields(value, [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "totalTokens",
  ]);
  assertFields(cost, ["input", "output", "cacheRead", "cacheWrite", "total"]);
  if (
    (value["cacheWrite1h"] !== undefined &&
      !nonNegativeNumber(value["cacheWrite1h"])) ||
    (value["reasoning"] !== undefined && !nonNegativeNumber(value["reasoning"]))
  ) {
    throw new Error("Conversation Surface optional tool usage is invalid");
  }
  return JSON.parse(canonicalJson(value)) as Usage;
}

function assertFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  if (fields.some((field) => !nonNegativeNumber(value[field]))) {
    throw new Error("Conversation Surface tool usage is invalid");
  }
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

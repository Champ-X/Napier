import type { Message } from "@earendil-works/pi-ai";
import { canonicalJson } from "./ed25519.js";

/** Retain provider signatures, images and exact tool results, never public step text. */
export function normalizeSubagentWorkingMessages(input: readonly unknown[]): Message[] {
  if (!Array.isArray(input) || input.length > 1_024) invalid();
  assertJson(input, 0);
  const messages = JSON.parse(canonicalJson(input)) as unknown[];
  const pending = new Map<string, string>();
  for (const value of messages) {
    if (!record(value) || !Number.isFinite(value["timestamp"])) invalid();
    const role = value["role"];
    if (role === "user") {
      if (pending.size || !(typeof value["content"] === "string" || validContent(value["content"], false))) invalid();
    } else if (role === "assistant") {
      validateAssistant(value, pending);
    } else if (role === "toolResult") {
      if (!text(value["toolCallId"]) || !text(value["toolName"]) ||
          pending.get(value["toolCallId"]) !== value["toolName"] ||
          !validContent(value["content"], false) || typeof value["isError"] !== "boolean") invalid();
      pending.delete(value["toolCallId"]);
    } else invalid();
  }
  if (pending.size) throw new Error("Child working set has an unsettled tool batch");
  return messages as Message[];
}

function validateAssistant(value: Record<string, unknown>, pending: Map<string, string>): void {
  if (pending.size || !validContent(value["content"], true) ||
      !["api", "provider", "model"].every((key) => text(value[key])) ||
      !["stop", "length", "toolUse"].includes(String(value["stopReason"])) ||
      !validUsage(value["usage"])) invalid();
  for (const block of value["content"] as Record<string, unknown>[]) {
    if (block["type"] !== "toolCall") continue;
    const id = String(block["id"]);
    if (pending.has(id)) invalid();
    pending.set(id, String(block["name"]));
  }
}

function validContent(value: unknown, assistant: boolean): boolean {
  return Array.isArray(value) && value.every((block) => {
    if (!record(block)) return false;
    if (block["type"] === "text") return typeof block["text"] === "string";
    if (assistant && block["type"] === "thinking") return typeof block["thinking"] === "string";
    if (!assistant && block["type"] === "image")
      return typeof block["data"] === "string" && text(block["mimeType"]);
    return assistant && block["type"] === "toolCall" &&
      text(block["id"]) && text(block["name"]) && record(block["arguments"]);
  });
}

function validUsage(value: unknown): boolean {
  if (!record(value) || !record(value["cost"])) return false;
  const cost = value["cost"];
  return ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]
    .every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) &&
    ["input", "output", "cacheRead", "cacheWrite", "total"]
      .every((key) => typeof cost[key] === "number" && Number.isFinite(cost[key]) && cost[key] >= 0);
}

/** Undefined optional object fields follow the existing exact-capture JSON semantics. */
function assertJson(value: unknown, depth: number): void {
  if (depth > 64) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return; }
  if (Array.isArray(value)) { for (const item of value) assertJson(item, depth + 1); return; }
  if (record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    for (const item of Object.values(value)) if (item !== undefined) assertJson(item, depth + 1);
    return;
  }
  invalid();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function invalid(): never { throw new Error("Child working set messages are invalid"); }

import type {
  AssistantMessage,
  Context,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  LARGE_TOOL_RESULT_CONTEXT_BYTES,
  pruneToolResultContext,
} from "../src/tool-result-context-pruner.js";

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("tool-result model context pruning", () => {
  it("replaces an older exact read with a pointer to the latest result", () => {
    const oldText = `old:${"x".repeat(500)}`;
    const latestText = `latest:${"y".repeat(600)}`;
    const original = context([
      user("Inspect the file."),
      assistantCall("call_old", "read_file", { path: "src/a.ts" }),
      result("call_old", "read_file", oldText),
      assistantCall("call_latest", "read_file", { path: "src/a.ts" }),
      result("call_latest", "read_file", latestText),
    ]);

    const pruning = pruneToolResultContext(original, 1);

    expect(resultText(pruning.context.messages[2] as ToolResultMessage)).toBe(
      "[Superseded result; see call_latest.]",
    );
    expect(resultText(pruning.context.messages[4] as ToolResultMessage)).toBe(latestText);
    expect(resultText(original.messages[2] as ToolResultMessage)).toBe(oldText);
    expect(pruning.receipt).toEqual(expect.objectContaining({
      replacementCount: 1,
      supersededResultCount: 1,
      savedToolResultTextBytes: expect.any(Number),
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(pruning.receipt.savedToolResultTextBytes).toBeGreaterThan(0);
  });

  it("does not supersede reads across a later user instruction", () => {
    const original = context([
      user("Inspect the file."),
      assistantCall("call_old", "read_file", { path: "src/a.ts" }),
      result("call_old", "read_file", "old content"),
      user("Compare against the previous version."),
      assistantCall("call_latest", "read_file", { path: "src/a.ts" }),
      result("call_latest", "read_file", "latest content"),
    ]);

    const pruning = pruneToolResultContext(original, 1);

    expect(pruning.context).toBe(original);
    expect(pruning.receipt.supersededResultCount).toBe(0);
  });

  it("compacts repeated errors and known empty results without changing the latest error", () => {
    const error = `Permission denied. ${"detail ".repeat(30)}`;
    const original = context([
      user("Inspect the workspace."),
      assistantCall("call_error_old", "read_file", { path: "private.txt" }),
      result("call_error_old", "read_file", error, true),
      assistantCall("call_empty", "search_files", { query: "missing" }),
      result("call_empty", "search_files", "No matches found."),
      assistantCall("call_error_new", "read_file", { path: "other.txt" }),
      result("call_error_new", "read_file", error, true),
    ]);

    const pruning = pruneToolResultContext(original, 2);

    expect(resultText(pruning.context.messages[2] as ToolResultMessage)).toBe(
      "[Repeated error; see call_error_new.]",
    );
    expect(resultText(pruning.context.messages[4] as ToolResultMessage)).toBe("No matches.");
    expect(resultText(pruning.context.messages[6] as ToolResultMessage)).toBe(error);
    expect(pruning.receipt).toEqual(expect.objectContaining({
      repeatedErrorCount: 1,
      emptyResultCount: 1,
      replacementCount: 2,
    }));
  });

  it("bounds a large successful result while preserving both ends and skips images", () => {
    const large = `HEAD\n${"中".repeat(LARGE_TOOL_RESULT_CONTEXT_BYTES)}\nTAIL`;
    const imageResult = result("call_image", "web_fetch", large);
    imageResult.content.push({ type: "image", data: "AA==", mimeType: "image/png" });
    const original = context([
      user("Read the report."),
      assistantCall("call_large", "read_file", { path: "report.txt" }),
      result("call_large", "read_file", large),
      assistantCall("call_image", "web_fetch", { url: "https://example.test" }),
      imageResult,
    ]);

    const pruning = pruneToolResultContext(original, 1);
    const bounded = resultText(pruning.context.messages[2] as ToolResultMessage);

    expect(bounded).toMatch(/^HEAD/u);
    expect(bounded).toContain("Napier bounded");
    expect(bounded).toMatch(/TAIL$/u);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThan(
      Buffer.byteLength(large, "utf8"),
    );
    expect(pruning.context.messages[4]).toBe(imageResult);
    expect(pruning.receipt.largeResultCount).toBe(1);
  });
});

function context(messages: Context["messages"]): Context {
  return { systemPrompt: "system", messages, tools: [] };
}

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function assistantCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: USAGE,
    stopReason: "toolUse",
    timestamp: 2,
  };
}

function result(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: 3,
  };
}

function resultText(message: ToolResultMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

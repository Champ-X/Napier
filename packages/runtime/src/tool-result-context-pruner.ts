import type {
  Context,
  Message,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";

export const LARGE_TOOL_RESULT_CONTEXT_BYTES = 32 * 1024;
export const RETAINED_LARGE_TOOL_RESULT_CONTEXT_BYTES = 12 * 1024;

export type ToolResultPruningReason =
  | "empty"
  | "large"
  | "repeated_error"
  | "superseded";

export interface ToolResultContextPruningReceipt {
  kind: "napier.tool-result-context-pruning";
  schemaVersion: 1;
  attempt: number;
  messageCount: number;
  toolResultCount: number;
  replacementCount: number;
  supersededResultCount: number;
  repeatedErrorCount: number;
  largeResultCount: number;
  emptyResultCount: number;
  originalToolResultTextBytes: number;
  activeToolResultTextBytes: number;
  savedToolResultTextBytes: number;
  originalToolResultSetSha256: string;
  activeToolResultSetSha256: string;
  replacementSetSha256: string;
  contentSha256: string;
}

export interface ToolResultContextPruning {
  context: Context;
  receipt: ToolResultContextPruningReceipt;
}

interface ReplacementEvidence {
  toolCallId: string;
  toolName: string;
  reason: ToolResultPruningReason;
  originalBytes: number;
  activeBytes: number;
  originalSha256: string;
  activeSha256: string;
  relatedCallId?: string;
}

const SUPERSEDED_READ_TOOLS = new Set([
  "inspect_code",
  "inspect_data",
  "list_files",
  "list_symbols",
  "read_file",
  "read_symbol",
  "search_files",
  "web_fetch",
]);

const LARGE_TEXT_TOOLS = new Set([
  ...SUPERSEDED_READ_TOOLS,
  "run_command",
  "web_search",
]);

const EMPTY_RESULT_REPLACEMENTS = new Map([
  ["(empty directory)", "Empty directory."],
  ["No matches found.", "No matches."],
]);

/**
 * Compacts only model-visible copies of tool results. The agent transcript,
 * Ledger events, and result capsules remain unchanged and authoritative.
 */
export function pruneToolResultContext(
  context: Context,
  attempt: number,
): ToolResultContextPruning {
  const calls = toolCallKeys(context.messages);
  const replacements = new Map<number, ReplacementEvidence & { text: string }>();
  const latestReads = new Map<string, string>();
  const latestErrors = new Map<string, string>();

  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index];
    if (!message) continue;
    if (message.role === "user") {
      latestReads.clear();
      latestErrors.clear();
      continue;
    }
    if (message.role !== "toolResult" || hasImage(message)) continue;
    const original = toolResultText(message);
    const originalBytes = Buffer.byteLength(original, "utf8");
    const callKey = calls.get(message.toolCallId);
    let candidate: { reason: ToolResultPruningReason; text: string; relatedCallId?: string } | undefined;

    if (message.isError) {
      const errorKey = `${message.toolName}:${sha256(original.trim())}`;
      const laterCallId = latestErrors.get(errorKey);
      if (laterCallId) {
        candidate = {
          reason: "repeated_error",
          text: `[Repeated error; see ${laterCallId}.]`,
          relatedCallId: laterCallId,
        };
      } else {
        latestErrors.set(errorKey, message.toolCallId);
      }
    } else if (callKey && SUPERSEDED_READ_TOOLS.has(message.toolName)) {
      const laterCallId = latestReads.get(callKey);
      if (laterCallId) {
        candidate = {
          reason: "superseded",
          text: `[Superseded result; see ${laterCallId}.]`,
          relatedCallId: laterCallId,
        };
      } else {
        latestReads.set(callKey, message.toolCallId);
      }
    }
    candidate ??= compactEmptyResult(original);
    candidate ??= compactLargeResult(message, original, originalBytes);
    if (!candidate || Buffer.byteLength(candidate.text, "utf8") >= originalBytes) continue;
    const activeBytes = Buffer.byteLength(candidate.text, "utf8");
    replacements.set(index, {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      reason: candidate.reason,
      originalBytes,
      activeBytes,
      originalSha256: sha256(original),
      activeSha256: sha256(candidate.text),
      ...(candidate.relatedCallId ? { relatedCallId: candidate.relatedCallId } : {}),
      text: candidate.text,
    });
  }

  const messages = context.messages.map((message, index) => {
    const replacement = replacements.get(index);
    return replacement && message.role === "toolResult"
      ? { ...message, content: [{ type: "text" as const, text: replacement.text }] }
      : message;
  });
  const originalResults = context.messages.filter(isToolResult);
  const activeResults = messages.filter(isToolResult);
  const evidence = [...replacements.values()].map(({ text: _text, ...item }) => item);
  const originalBytes = toolResultTextBytes(originalResults);
  const activeBytes = toolResultTextBytes(activeResults);
  const receipt = withReceiptHash({
    kind: "napier.tool-result-context-pruning" as const,
    schemaVersion: 1 as const,
    attempt,
    messageCount: context.messages.length,
    toolResultCount: originalResults.length,
    replacementCount: evidence.length,
    supersededResultCount: reasonCount(evidence, "superseded"),
    repeatedErrorCount: reasonCount(evidence, "repeated_error"),
    largeResultCount: reasonCount(evidence, "large"),
    emptyResultCount: reasonCount(evidence, "empty"),
    originalToolResultTextBytes: originalBytes,
    activeToolResultTextBytes: activeBytes,
    savedToolResultTextBytes: originalBytes - activeBytes,
    originalToolResultSetSha256: toolResultSetSha256(originalResults),
    activeToolResultSetSha256: toolResultSetSha256(activeResults),
    replacementSetSha256: sha256(canonicalJson(evidence)),
  });
  return {
    context: replacements.size > 0 ? { ...context, messages } : context,
    receipt,
  };
}

function toolCallKeys(messages: readonly Message[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const content of message.content) {
      if (content.type !== "toolCall" || !SUPERSEDED_READ_TOOLS.has(content.name)) continue;
      keys.set(content.id, `${content.name}:${sha256(canonicalJson(content.arguments))}`);
    }
  }
  return keys;
}

function compactEmptyResult(
  text: string,
): { reason: "empty"; text: string } | undefined {
  const replacement = EMPTY_RESULT_REPLACEMENTS.get(text.trim());
  return replacement ? { reason: "empty", text: replacement } : undefined;
}

function compactLargeResult(
  message: ToolResultMessage,
  text: string,
  bytes: number,
): { reason: "large"; text: string } | undefined {
  if (message.isError || bytes <= LARGE_TOOL_RESULT_CONTEXT_BYTES || !LARGE_TEXT_TOOLS.has(message.toolName)) {
    return undefined;
  }
  const headBudget = Math.floor(RETAINED_LARGE_TOOL_RESULT_CONTEXT_BYTES * 2 / 3);
  const tailBudget = RETAINED_LARGE_TOOL_RESULT_CONTEXT_BYTES - headBudget;
  const head = truncateUtf8(text, headBudget);
  const tail = truncateUtf8FromEnd(text, tailBudget);
  return {
    reason: "large",
    text: [
      head,
      "",
      `[Napier bounded ${String(bytes)} UTF-8 bytes; full result SHA-256 ${sha256(text)}. Re-run ${message.toolName} with a narrower scope to reopen omitted content.]`,
      "",
      tail,
    ].join("\n"),
  };
}

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

function toolResultTextBytes(messages: readonly ToolResultMessage[]): number {
  return messages.reduce(
    (total, message) => total + Buffer.byteLength(toolResultText(message), "utf8"),
    0,
  );
}

function toolResultSetSha256(messages: readonly ToolResultMessage[]): string {
  return sha256(canonicalJson(messages.map((message) => ({
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    textSha256: sha256(toolResultText(message)),
  }))));
}

function isToolResult(message: Message): message is ToolResultMessage {
  return message.role === "toolResult";
}

function hasImage(message: ToolResultMessage): boolean {
  return message.content.some((content) => content.type === "image");
}

function reasonCount(
  evidence: readonly ReplacementEvidence[],
  reason: ToolResultPruningReason,
): number {
  return evidence.filter((item) => item.reason === reason).length;
}

function truncateUtf8(text: string, maximumBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) return text;
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function truncateUtf8FromEnd(text: string, maximumBytes: number): string {
  const characters = [...text];
  let bytes = 0;
  let start = characters.length;
  while (start > 0) {
    const characterBytes = Buffer.byteLength(characters[start - 1]!, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    start -= 1;
  }
  return characters.slice(start).join("");
}

function withReceiptHash<T extends Omit<ToolResultContextPruningReceipt, "contentSha256">>(
  content: T,
): ToolResultContextPruningReceipt {
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { sha256 } from "./ed25519.js";

export const MAX_TOOL_FAILURE_CONTEXT_BYTES = 8 * 1024;

const RECEIVED_ARGUMENTS_MARKER = "\nReceived arguments:";

export function boundToolFailureContext(
  messages: AgentMessage[],
): AgentMessage[] {
  let changed = false;
  const bounded = messages.map((message) => {
    if (message.role !== "toolResult" || message.isError !== true) {
      return message;
    }
    const text = message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const originalBytes = Buffer.byteLength(text, "utf8");
    if (originalBytes <= MAX_TOOL_FAILURE_CONTEXT_BYTES) return message;

    changed = true;
    const contentSha256 = sha256(text);
    const diagnostic = compactDiagnostic(text);
    const suffix = [
      "",
      "[Napier bounded an oversized tool failure before the next model call.]",
      `Original UTF-8 bytes: ${String(originalBytes)}`,
      `Original SHA-256: ${contentSha256}`,
      "Correct the call using the diagnostic above; the durable tool.failed receipt retains the full size and digest.",
    ].join("\n");
    const prefixBudget = Math.max(
      0,
      MAX_TOOL_FAILURE_CONTEXT_BYTES - Buffer.byteLength(suffix, "utf8"),
    );
    return {
      ...message,
      content: [
        {
          type: "text" as const,
          text: `${truncateUtf8(diagnostic, prefixBudget)}${suffix}`,
        },
      ],
    };
  });
  return changed ? bounded : messages;
}

function compactDiagnostic(text: string): string {
  const marker = text.indexOf(RECEIVED_ARGUMENTS_MARKER);
  return marker >= 0 ? text.slice(0, marker) : text;
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

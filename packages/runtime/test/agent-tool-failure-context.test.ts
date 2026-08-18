import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import {
  boundToolFailureContext,
  MAX_TOOL_FAILURE_CONTEXT_BYTES,
} from "../src/agent-tool-failure-context.js";
import { sha256 } from "../src/ed25519.js";

describe("Agent tool failure context", () => {
  it("removes oversized echoed arguments while retaining diagnostic identity", () => {
    const output = [
      'Validation failed for tool "apply_patch":',
      "  - root: must not have additional properties",
      "",
      "Received arguments:",
      JSON.stringify({ content: "PRIVATE_PAYLOAD".repeat(8_000) }),
    ].join("\n");
    const messages: AgentMessage[] = [toolFailure(output)];

    const bounded = boundToolFailureContext(messages);
    const serialized = JSON.stringify(bounded);

    expect(bounded).not.toBe(messages);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(
      MAX_TOOL_FAILURE_CONTEXT_BYTES + 1_000,
    );
    expect(serialized).toContain("must not have additional properties");
    expect(serialized).toContain(sha256(output));
    expect(serialized).toContain(String(Buffer.byteLength(output, "utf8")));
    expect(serialized).not.toContain("PRIVATE_PAYLOAD");
    expect(JSON.stringify(messages)).toContain("PRIVATE_PAYLOAD");
  });

  it("preserves ordinary failures and the original message array", () => {
    const messages: AgentMessage[] = [toolFailure("range precondition failed")];

    expect(boundToolFailureContext(messages)).toBe(messages);
  });

  it("bounds generic oversized failures without losing their prefix", () => {
    const output = `command failed\n${"x".repeat(20_000)}`;
    const bounded = boundToolFailureContext([toolFailure(output)]);
    const message = bounded[0];
    const text =
      message?.role === "toolResult" && message.content[0]?.type === "text"
        ? message.content[0].text
        : "";

    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_FAILURE_CONTEXT_BYTES,
    );
    expect(text).toContain("command failed");
    expect(text).toContain(sha256(output));
  });
});

function toolFailure(text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call_failure",
    toolName: "apply_patch",
    content: [{ type: "text", text }],
    details: {},
    isError: true,
    timestamp: 1,
  };
}

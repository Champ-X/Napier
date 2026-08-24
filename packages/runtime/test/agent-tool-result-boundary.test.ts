import { describe, expect, it } from "vitest";

import {
  canonicalizeAgentToolResult,
  presentCanonicalAgentToolResult,
} from "../src/agent-tool-result-boundary.js";

describe("agent tool result boundary", () => {
  it("keeps canonical capture separate from model-visible presentation", () => {
    const source = {
      content: [{ type: "text" as const, text: "full evidence" }],
      details: { evidence: "canonical" },
      addedToolNames: ["deferred_read"],
      terminate: true,
    };
    const canonical = canonicalizeAgentToolResult({
      result: source,
      isError: false,
    });
    const presentation = presentCanonicalAgentToolResult(canonical, {
      content: [{ type: "text", text: "model summary" }],
      details: { evidence: "projected" },
      terminate: false,
    });

    expect(canonical.result).not.toBe(source);
    expect(canonical.result.content).not.toBe(source.content);
    expect(canonical.result.content).toEqual([
      { type: "text", text: "full evidence" },
    ]);
    expect(canonical.result.details).toEqual({ evidence: "canonical" });
    expect(presentation).toMatchObject({
      content: [{ type: "text", text: "model summary" }],
      details: { evidence: "projected" },
      isError: false,
      terminate: false,
    });
  });

  it("rejects malformed results before durable capture and presentation", () => {
    expect(() =>
      canonicalizeAgentToolResult({
        result: { content: undefined, details: {} } as never,
        isError: false,
      }),
    ).toThrow("Tool result content must be an array");
  });
});

import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  createResearchSourceTool,
  researchSourceToolCallArgumentsLedgerProjection,
  researchSourceToolInputLedgerProjection,
  researchSourceToolOutputLedgerProjection,
} from "../src/research-source-tool.js";
import {
  RunResearchSourceManager,
  type ResearchSourceToolDetails,
} from "../src/research-sources.js";
import { assessToolCall } from "../src/policy.js";

describe("research_source Agent tool", () => {
  it("requires unrestricted policy while remaining a read effect", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "workspace",
        "research_source",
        { action: "capture" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "external Browser Sessions require unrestricted policy",
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "research_source",
        { action: "cite" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        risk: "high",
      }),
    );
    expect(builtInToolEffect("research_source", { action: "capture" })).toBe(
      "read",
    );
    expect(builtInToolEffect("research_source", { action: "cite" })).toBe(
      "read",
    );
  });

  it("redacts claims, source text, URLs, and live output from Ledger projections", () => {
    const args = {
      action: "cite",
      sourceId: "source_fixture0001",
      sourceContentSha256: "a".repeat(64),
      startLine: 2,
      endLine: 3,
      claim: "  CLAIM_SECRET  ",
    };
    const call = researchSourceToolCallArgumentsLedgerProjection(args);
    const input = researchSourceToolInputLedgerProjection(args);
    const output = researchSourceToolOutputLedgerProjection(
      "QUOTE_SECRET https://source-secret.example/",
      {
        details: details("cite"),
      },
    );
    const serialized = JSON.stringify({ call, input, output });

    expect(serialized).not.toContain("CLAIM_SECRET");
    expect(serialized).not.toContain("QUOTE_SECRET");
    expect(serialized).not.toContain("source-secret");
    expect(call).toEqual(
      expect.objectContaining({
        action: "cite",
        sourceId: "source_fixture0001",
        sourceContentSha256: "a".repeat(64),
        startLine: 2,
        endLine: 3,
        claimBytes: 12,
        redacted: true,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputBytes: 43,
        outputRedacted: true,
      }),
    );
  });

  it("returns Source text only as live tool content", async () => {
    const execute = vi.fn(async () => ({
      output: "SOURCE_TEXT_SECRET",
      details: details("capture"),
    }));
    const tool = createResearchSourceTool(
      { execute } as unknown as RunResearchSourceManager,
      { threadId: "thread_research", runId: "run_research" },
    );

    const result = await tool.execute("call_research", {
      action: "capture",
      maxChars: 12_000,
    });

    expect(result.content).toEqual([
      { type: "text", text: "SOURCE_TEXT_SECRET" },
    ]);
    expect(result.details).toEqual(details("capture"));
    expect(execute).toHaveBeenCalledWith(
      { threadId: "thread_research", runId: "run_research" },
      { action: "capture", maxChars: 12_000 },
      undefined,
    );
  });
});

function details(
  action: ResearchSourceToolDetails["action"],
): ResearchSourceToolDetails {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action,
    sourceId: "source_fixture0001",
    sourceContentSha256: "a".repeat(64),
    sourceUrlSha256: "b".repeat(64),
    sourceOriginSha256: "c".repeat(64),
    sourceTitleSha256: "d".repeat(64),
    sourceTextSha256: "e".repeat(64),
    sourceLineCount: 3,
    sourceTextChars: 100,
    sourceTruncated: false,
    sourceCount: 1,
    citationCount: action === "cite" ? 1 : 0,
    sourceSetSha256: "f".repeat(64),
    browserSessionOperation: 2,
    browserSessionIdSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    browserLimitsSha256: "4".repeat(64),
    browserNetworkDestinationsSha256: "5".repeat(64),
  };
}

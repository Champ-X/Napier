import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import {
  agentToolAllowsGenericDetailsFallback,
  agentToolGenericDetailsLedgerProjection,
} from "../src/agent-tool-ledger.js";
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
  it("is available under read-only policy while preserving report boundaries", () => {
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
        allowed: true,
        risk: "low",
        reason: "Run-local Browser Source and report verification",
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
        risk: "low",
      }),
    );
    expect(
      assessToolCall(
        "unrestricted",
        "research_source",
        {
          action: "verify_report",
          path: "reports/brief.md",
          expectedSha256: "a".repeat(64),
        },
        workspace,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "low" }));
    expect(
      assessToolCall(
        "unrestricted",
        "research_source",
        {
          action: "verify_report",
          path: "../brief.md",
          expectedSha256: "a".repeat(64),
        },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "research reports must be inside the workspace",
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
        details: expect.objectContaining({
          kind: "napier.research-source-evidence",
          action: "cite",
          browserActiveTabIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(JSON.stringify(output)).not.toContain("tab_1");

    const invalid = researchSourceToolOutputLedgerProjection("PRIVATE_OUTPUT", {
      details: { ...details("cite"), rawSource: "PRIVATE_RAW_SOURCE" },
    });
    expect(invalid).not.toHaveProperty("details");
    expect(JSON.stringify(invalid)).not.toContain("PRIVATE_RAW_SOURCE");
    expect(agentToolAllowsGenericDetailsFallback("research_source")).toBe(
      false,
    );
    expect(agentToolAllowsGenericDetailsFallback("custom_tool")).toBe(true);
    expect(
      agentToolGenericDetailsLedgerProjection(
        "research_source",
        invalid,
        { rawSource: "PRIVATE_RAW_SOURCE" },
      ),
    ).toEqual({});
    expect(
      JSON.stringify(
        agentToolGenericDetailsLedgerProjection(
          "research_source",
          invalid,
          { rawSource: "PRIVATE_RAW_SOURCE" },
        ),
      ),
    ).not.toContain("PRIVATE_RAW_SOURCE");
  });

  it("redacts Web Fetch Source IDs while retaining exact content bindings", () => {
    const projection = researchSourceToolCallArgumentsLedgerProjection({
      action: "capture_fetch",
      webSourceId: "websource_private0001",
      webSourceContentSha256: "a".repeat(64),
      maxChars: 12_000,
    });
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain("websource_private0001");
    expect(projection).toEqual(
      expect.objectContaining({
        action: "capture_fetch",
        webSourceIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        webSourceContentSha256: "a".repeat(64),
        maxChars: 12_000,
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

  it("redacts report paths while retaining expected file identity", () => {
    const projection = researchSourceToolCallArgumentsLedgerProjection({
      action: "verify_report",
      path: "PRIVATE_REPORT_PATH/brief.md",
      expectedSha256: "a".repeat(64),
    });

    expect(JSON.stringify(projection)).not.toContain("PRIVATE_REPORT_PATH");
    expect(projection).toEqual(
      expect.objectContaining({
        action: "verify_report",
        reportPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reportPathBytes: 28,
        expectedSha256: "a".repeat(64),
      }),
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
    sourceKind: "browser",
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
    browserActiveTabId: "tab_1",
    browserTabCount: 1,
    browserTabSetSha256: "6".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    browserLimitsSha256: "4".repeat(64),
    browserNetworkDestinationsSha256: "5".repeat(64),
    ...(action === "cite"
      ? {
          citationId: "citation_fixture0001",
          citationTokenSha256: "7".repeat(64),
          citationStartLine: 1,
          citationEndLine: 2,
          citationQuoteSha256: "8".repeat(64),
          citationClaimSha256: "9".repeat(64),
        }
      : {}),
  };
}

import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  researchSourceEventEvidence,
  researchSourceSummaryParts,
} from "../src/research-source-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Research Source Trace projection", () => {
  it("projects bounded Source and citation evidence", () => {
    const view = researchSourceEventEvidence(citationDetails());

    expect(view).toEqual(
      expect.objectContaining({
        researchSourceAction: "cite",
        researchSourceId: "source_fixture0001",
        researchCitationId: "citation_fixture0001",
        researchSourceLineCount: 8,
        researchSourceTextChars: 1_024,
        researchCitationStartLine: 2,
        researchCitationEndLine: 4,
        researchSourceCount: 2,
        researchCitationCount: 3,
        researchBrowserSessionOperation: 5,
      }),
    );
    expect(researchSourceSummaryParts(view!)).toContain("research-source cite");
    expect(researchSourceSummaryParts(view!)).toContain("citation-range 2-4");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_RESEARCH");
  });

  it("integrates Research Source evidence into generic tool summaries", () => {
    const event: RunEvent = {
      id: "event_research",
      threadId: "thread_research",
      runId: "run_research",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "research_source",
        status: "completed",
        effect: "read",
        output: "PRIVATE_RESEARCH_SOURCE_TEXT",
        details: citationDetails(),
      },
      createdAt: "2026-07-31T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "research_source",
        status: "completed",
        effect: "read",
        researchSourceAction: "cite",
        researchCitationStartLine: 2,
        researchCitationEndLine: 4,
      }),
    );
    const summary = toolEventTraceSummary(event);
    expect(summary).toContain(
      "tool / research_source / completed / effect read",
    );
    expect(summary).toContain("research-source cite");
    expect(summary).toContain("citation-range 2-4");
    expect(summary).not.toContain("PRIVATE_RESEARCH");
  });

  it("accepts count-only lists and fails closed on inconsistent evidence", () => {
    expect(
      researchSourceEventEvidence({
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "list",
        sourceCount: 0,
        citationCount: 0,
        sourceSetSha256: "a".repeat(64),
      }),
    ).toEqual({
      researchSourceAction: "list",
      researchSourceCount: 0,
      researchCitationCount: 0,
      researchSourceSetSha256: "a".repeat(64),
    });
    expect(
      researchSourceEventEvidence({
        ...citationDetails(),
        citationEndLine: 9,
      }),
    ).toBeUndefined();
    expect(
      researchSourceEventEvidence({
        ...citationDetails(),
        action: "capture",
      }),
    ).toBeUndefined();
    expect(
      researchSourceEventEvidence({
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "list",
        sourceId: "source_fixture0001",
        sourceCount: 1,
        citationCount: 0,
        sourceSetSha256: "a".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      researchSourceEventEvidence({
        kind: "napier.research-source",
        schemaVersion: 1,
        action: "list",
        sourceCount: 0,
        citationCount: 1,
        sourceSetSha256: "a".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      researchSourceEventEvidence({
        ...citationDetails(),
        sourceLineCount: 8,
        sourceTextChars: 8,
      }),
    ).toBeUndefined();
  });

  it("projects verified report bytes without paths or Markdown", () => {
    const view = researchSourceEventEvidence(reportDetails());

    expect(view).toEqual(
      expect.objectContaining({
        researchSourceAction: "verify_report",
        researchSourceCount: 2,
        researchCitationCount: 3,
        researchReportFileBytes: 2_048,
        researchReportCitationCount: 2,
        researchReportPathSha256: "1".repeat(64),
        researchReportFileSha256: "2".repeat(64),
      }),
    );
    expect(researchSourceSummaryParts(view!)).toContain(
      "research-source verify_report",
    );
    expect(researchSourceSummaryParts(view!)).toContain("report-citations 2");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_REPORT");

    expect(
      researchSourceEventEvidence({
        ...reportDetails(),
        reportCitationCount: 4,
      }),
    ).toBeUndefined();
    expect(
      researchSourceEventEvidence({
        ...reportDetails(),
        sourceId: "source_fixture0001",
      }),
    ).toBeUndefined();
  });
});

function citationDetails() {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action: "cite",
    sourceId: "source_fixture0001",
    citationId: "citation_fixture0001",
    citationTokenSha256: "1".repeat(64),
    sourceContentSha256: "2".repeat(64),
    sourceUrlSha256: "3".repeat(64),
    sourceOriginSha256: "4".repeat(64),
    sourceTitleSha256: "5".repeat(64),
    sourceTextSha256: "6".repeat(64),
    sourceLineCount: 8,
    sourceTextChars: 1_024,
    sourceTruncated: false,
    citationStartLine: 2,
    citationEndLine: 4,
    citationQuoteSha256: "7".repeat(64),
    citationClaimSha256: "8".repeat(64),
    sourceCount: 2,
    citationCount: 3,
    sourceSetSha256: "9".repeat(64),
    browserSessionOperation: 5,
    browserSessionIdSha256: "a".repeat(64),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    browserLimitsSha256: "d".repeat(64),
    browserNetworkDestinationsSha256: "e".repeat(64),
    sourceText: "PRIVATE_RESEARCH_SOURCE_TEXT",
    sourceUrl: "https://private-research.example/",
    quote: "PRIVATE_RESEARCH_QUOTE",
  };
}

function reportDetails() {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action: "verify_report",
    sourceCount: 2,
    citationCount: 3,
    sourceSetSha256: "9".repeat(64),
    reportPathSha256: "1".repeat(64),
    reportFileSha256: "2".repeat(64),
    reportFileBytes: 2_048,
    reportCitationCount: 2,
    reportCitationSetSha256: "3".repeat(64),
    path: "PRIVATE_REPORT_PATH",
    markdown: "PRIVATE_REPORT_MARKDOWN",
  };
}

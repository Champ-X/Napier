import { createHash } from "node:crypto";

import { parseResearchSourceEvidenceV1 } from "../src/skill-load.js";
import { describe, expect, it } from "vitest";

const H = (value: string) => createHash("sha256").update(value).digest("hex");
const common = {
  kind: "napier.research-source",
  schemaVersion: 1,
  sourceCount: 1,
  citationCount: 0,
  sourceSetSha256: H("sources"),
};
const source = {
  sourceId: "source_12345678",
  sourceContentSha256: H("source"),
  sourceUrlSha256: H("url"),
  sourceOriginSha256: H("origin"),
  sourceTitleSha256: H("title"),
  sourceTextSha256: H("text"),
  sourceLineCount: 3,
  sourceTextChars: 12,
  sourceTruncated: false,
};
const browser = {
  sourceKind: "browser",
  browserSessionOperation: 1,
  browserSessionIdSha256: H("session"),
  browserActiveTabId: "tab_1",
  browserTabCount: 1,
  browserTabSetSha256: H("tabs"),
  browserExecutableSha256: H("browser"),
  browserVersionSha256: H("version"),
  browserLimitsSha256: H("limits"),
  browserNetworkDestinationsSha256: H("destinations"),
};
const web = {
  sourceKind: "web_fetch",
  webSourceContentSha256: H("web-source"),
  webSourceBodySha256: H("body"),
  webSourceFormat: "html",
  webSourceLineCount: 100,
};
const citation = {
  citationId: "citation_12345678",
  citationTokenSha256: H("[citation:citation_12345678]"),
  citationStartLine: 1,
  citationEndLine: 2,
  citationQuoteSha256: H("quote"),
  citationClaimSha256: H("claim"),
};
const capsule = {
  kind: "napier.research-source-capsule-receipt",
  schemaVersion: 1,
  sourceRunId: "run_12345678",
  sourceCount: 1,
  citationCount: 1,
  sourceSetSha256: H("sources"),
  capsuleSha256: H("capsule"),
  capsuleBytes: 1024,
  storage: "local_only",
  contentSha256: H("capsule-receipt"),
};

describe("Research Source evidence parser", () => {
  it("normalizes the exact list, Browser capture and Browser cite members", () => {
    const list = parseResearchSourceEvidenceV1({ ...common, sourceCount: 0, action: "list" });
    expect(list).toEqual(expect.objectContaining({ action: "list", sourceCount: 0 }));
    expect(parseResearchSourceEvidenceV1(list)).toEqual(list);
    const capture = parseResearchSourceEvidenceV1({
      ...common,
      ...source,
      ...browser,
      action: "capture",
    });
    expect(capture).toEqual(
      expect.objectContaining({
        action: "capture",
        sourceKind: "browser",
        browserActiveTabIdSha256: H("tab_1"),
      }),
    );
    expect(capture).not.toHaveProperty("browserActiveTabId");
    expect(parseResearchSourceEvidenceV1(capture)).toEqual(capture);

    const cite = parseResearchSourceEvidenceV1({
      ...common,
      citationCount: 1,
      ...source,
      ...browser,
      ...citation,
      action: "cite",
      stateCapsule: capsule,
    });
    expect(cite).toEqual(
      expect.objectContaining({
        action: "cite",
        citationId: citation.citationId,
        continuityCapsuleContentSha256: capsule.capsuleSha256,
      }),
    );
    expect(parseResearchSourceEvidenceV1(cite)).toEqual(cite);
  });

  it("accepts current static, unavailable, used and legacy Web Fetch provenance", () => {
    const variants = [
      { webSourceRenderMode: "static", browserFallbackStatus: "not_needed" },
      {
        webSourceRenderMode: "static",
        browserFallbackStatus: "unavailable",
        browserFallbackDiagnostic: "browser_unavailable",
      },
      {
        webSourceRenderMode: "browser_fallback",
        browserFallbackStatus: "used",
        webFetchBrowserSessionOperation: 2,
        webFetchBrowserSessionIdSha256: H("fallback-session"),
        webFetchBrowserActiveTabId: "tab_2",
        webFetchBrowserTabCount: 2,
        webFetchBrowserTabSetSha256: H("fallback-tabs"),
        webFetchBrowserExecutableSha256: H("fallback-browser"),
        webFetchBrowserVersionSha256: H("fallback-version"),
        webFetchBrowserLimitsSha256: H("fallback-limits"),
        webFetchBrowserNetworkDestinationsSha256: H("fallback-destinations"),
      },
      {},
    ];
    for (const variant of variants) {
      const evidence = parseResearchSourceEvidenceV1({
        ...common,
        ...source,
        ...web,
        ...variant,
        action: "capture_fetch",
      });
      expect(evidence, JSON.stringify(variant)).toEqual(
        expect.objectContaining({
          action: "capture_fetch",
          sourceKind: "web_fetch",
          webSourceRenderMode:
            variant.webSourceRenderMode ?? "static",
          browserFallbackStatus:
            variant.browserFallbackStatus ?? "not_needed",
        }),
      );
      expect(parseResearchSourceEvidenceV1(evidence)).toEqual(evidence);
    }
  });

  it("requires Web provenance to cover every captured Source line in raw and normalized evidence", () => {
    const raw = {
      ...common,
      ...source,
      ...web,
      action: "capture_fetch",
      webSourceLineCount: source.sourceLineCount,
      webSourceRenderMode: "static",
      browserFallbackStatus: "not_needed",
    };
    const normalized = parseResearchSourceEvidenceV1(raw);
    expect(normalized).toEqual(
      expect.objectContaining({ webSourceLineCount: source.sourceLineCount }),
    );
    expect(
      parseResearchSourceEvidenceV1({
        ...raw,
        webSourceLineCount: source.sourceLineCount - 1,
      }),
    ).toBeUndefined();
    expect(
      parseResearchSourceEvidenceV1({
        ...normalized,
        webSourceLineCount: source.sourceLineCount - 1,
      }),
    ).toBeUndefined();
  });

  it("normalizes Web Fetch citation and every report registration value", () => {
    const webCitation = parseResearchSourceEvidenceV1({
        ...common,
        citationCount: 1,
        ...source,
        ...web,
        webSourceRenderMode: "static",
        browserFallbackStatus: "not_needed",
        ...citation,
        action: "cite",
      });
    expect(webCitation).toEqual(expect.objectContaining({ action: "cite", sourceKind: "web_fetch" }));
    expect(parseResearchSourceEvidenceV1(webCitation)).toEqual(webCitation);

    for (const reportArtifactRegistration of [
      "registered",
      "no_run_bound_plan",
      "no_matching_artifact",
      "artifact_not_expected",
      "artifact_registration_failed",
    ]) {
      const report = parseResearchSourceEvidenceV1({
          ...common,
          citationCount: 1,
          action: "verify_report",
          reportPathSha256: H("path"),
          reportFileSha256: H("report"),
          reportFileBytes: 100,
          reportCitationCount: 1,
          reportCitationSetSha256: H("citation-set"),
          reportArtifactRegistration,
        });
      expect(report).toEqual(expect.objectContaining({ action: "verify_report", reportArtifactRegistration }));
      expect(parseResearchSourceEvidenceV1(report)).toEqual(report);
    }
  });

  it("rejects unknown keys, mixed branches, partial fallback and invalid ranges", () => {
    const valid = {
      ...common,
      ...source,
      ...web,
      action: "capture_fetch",
      webSourceRenderMode: "static",
      browserFallbackStatus: "not_needed",
    };
    expect(parseResearchSourceEvidenceV1({ ...valid, rawUrl: "https://secret.invalid" })).toBeUndefined();
    expect(parseResearchSourceEvidenceV1({ ...valid, browserSessionOperation: 1 })).toBeUndefined();
    expect(parseResearchSourceEvidenceV1({ ...valid, browserFallbackStatus: "used" })).toBeUndefined();
    expect(
      parseResearchSourceEvidenceV1({
        ...valid,
        action: "cite",
        citationCount: 1,
        ...citation,
        citationEndLine: 4,
      }),
    ).toBeUndefined();
  });
});

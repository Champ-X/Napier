import type { RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  ResearchBenchmarkExpected,
  ResearchBenchmarkSourceFixture,
} from "./research-benchmark-types.js";

const CITATION_TOKEN = /\s+(?:\[citation:citation_[a-z0-9]{8,80}\]\s*)+$/u;

export interface ResearchBenchmarkEvidenceSummary {
  expectedClaimsSha256: string;
  actualClaimsSha256?: string;
  claimsMatch: boolean;
  expectedCitationEvidenceSha256: string;
  actualCitationEvidenceSha256: string;
  citationEvidenceMatch: boolean;
  expectedSourceSetSha256: string;
  actualSourceSetSha256: string;
  sourceCaptureMatch: boolean;
  captureCount: number;
  citationCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  contradictionFound: boolean;
  reportVerified: boolean;
}

export function collectResearchBenchmarkEvents(
  events: RunEvent[],
  runId: string,
): RunEvent[] {
  return events
    .filter((event) => {
      const payload = record(event.payload);
      const action = record(payload?.["details"])?.["action"];
      return (
        event.runId === runId &&
        event.type === "tool.completed" &&
        payload?.["toolName"] === "research_source" &&
        ["capture", "cite", "verify_report"].includes(String(action))
      );
    })
    .sort((left, right) => left.seq - right.seq);
}

export function deriveResearchBenchmarkEvidence(input: {
  events: RunEvent[];
  sources: ResearchBenchmarkSourceFixture[];
  expected: ResearchBenchmarkExpected;
  report?: string;
  reportFileSha256?: string;
}): ResearchBenchmarkEvidenceSummary {
  const details = input.events.flatMap((event) => {
    const value = record(record(event.payload)?.["details"]);
    return value ? [value] : [];
  });
  const captureHashes = detailHashes(details, "capture");
  const citationHashes = detailHashes(details, "cite");
  const expectedSourceHashes = input.sources
    .map((source) => source.capture.capturedContentSha256)
    .sort();
  const actualClaims = input.report
    ? extractResearchBenchmarkClaims(input.report, input.expected.claims)
    : undefined;
  const expectedClaimsSha256 = sha256(canonicalJson(input.expected.claims));
  const actualClaimsSha256 = actualClaims
    ? sha256(canonicalJson(actualClaims))
    : undefined;
  const expectedCitationEvidenceSha256 = citationEvidenceSha256(
    input.expected.requiredCitations.map((citation) => {
      const source = input.sources.find(
        (candidate) => candidate.id === citation.sourceId,
      )!;
      return {
        sourceContentSha256: source.capture.capturedContentSha256,
        citationClaimSha256: sha256(
          input.expected.claims[citation.claimIndex]!,
        ),
        citationStartLine: citation.startLine,
        citationEndLine: citation.endLine,
        citationQuoteSha256: sha256(
          source.capture.lines
            .slice(citation.startLine - 1, citation.endLine)
            .join("\n"),
        ),
      };
    }),
  );
  const actualCitationEvidenceSha256 = citationEvidenceSha256(
    citationEvidenceFromDetails(details),
  );
  const authorityByHash = new Map(
    input.sources.map((source) => [
      source.capture.capturedContentSha256,
      source.authority,
    ]),
  );
  const citedSources = [...new Set(citationHashes)];
  const reportVerification = details.find(
    (detail) => detail["action"] === "verify_report",
  );
  return {
    expectedClaimsSha256,
    ...(actualClaimsSha256 ? { actualClaimsSha256 } : {}),
    claimsMatch: actualClaimsSha256 === expectedClaimsSha256,
    expectedCitationEvidenceSha256,
    actualCitationEvidenceSha256,
    citationEvidenceMatch:
      actualCitationEvidenceSha256 === expectedCitationEvidenceSha256,
    expectedSourceSetSha256: sourceSetSha256(expectedSourceHashes),
    actualSourceSetSha256: sourceSetSha256(captureHashes),
    sourceCaptureMatch:
      canonicalJson(captureHashes) === canonicalJson(expectedSourceHashes),
    captureCount: details.filter((detail) => detail["action"] === "capture")
      .length,
    citationCount: details.filter((detail) => detail["action"] === "cite")
      .length,
    primarySourceCount: citedSources.filter(
      (hash) => authorityByHash.get(hash) === "primary",
    ).length,
    secondarySourceCount: citedSources.filter(
      (hash) => authorityByHash.get(hash) === "secondary",
    ).length,
    contradictionFound:
      actualClaims?.includes(input.expected.claims[1]!) ?? false,
    reportVerified:
      reportVerification?.["reportFileSha256"] === input.reportFileSha256 &&
      reportVerification?.["reportCitationCount"] ===
        input.expected.requiredCitationCount,
  };
}

export function extractResearchBenchmarkClaims(
  report: string,
  expectedClaims: string[],
): string[] {
  return report
    .split(/\r?\n/u)
    .map((line) => line.replace(CITATION_TOKEN, "").trim())
    .filter((line) => expectedClaims.includes(line));
}

export function sourceSetSha256(hashes: string[]): string {
  return sha256(canonicalJson([...new Set(hashes)].sort()));
}

export function citationEvidenceFromDetails(
  details: Record<string, unknown>[],
): Array<{
  sourceContentSha256: string;
  citationClaimSha256: string;
  citationStartLine: number;
  citationEndLine: number;
  citationQuoteSha256: string;
}> {
  return details.flatMap((detail) =>
    detail["action"] === "cite" &&
    digest(detail["sourceContentSha256"]) &&
    digest(detail["citationClaimSha256"]) &&
    nonNegativeInteger(detail["citationStartLine"]) &&
    nonNegativeInteger(detail["citationEndLine"]) &&
    digest(detail["citationQuoteSha256"])
      ? [
          {
            sourceContentSha256: detail["sourceContentSha256"],
            citationClaimSha256: detail["citationClaimSha256"],
            citationStartLine: Number(detail["citationStartLine"]),
            citationEndLine: Number(detail["citationEndLine"]),
            citationQuoteSha256: detail["citationQuoteSha256"],
          },
        ]
      : [],
  );
}

export function citationEvidenceSha256(
  evidence: ReturnType<typeof citationEvidenceFromDetails>,
): string {
  return sha256(
    canonicalJson(
      [...evidence].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    ),
  );
}

function detailHashes(
  details: Record<string, unknown>[],
  action: "capture" | "cite",
): string[] {
  return details
    .filter((detail) => detail["action"] === action)
    .flatMap((detail) =>
      typeof detail["sourceContentSha256"] === "string"
        ? [detail["sourceContentSha256"]]
        : [],
    )
    .sort();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

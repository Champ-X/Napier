import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type {
  OpenWebResearchBenchmarkExpected,
  OpenWebResearchBenchmarkResult,
  OpenWebResearchToolEvidence,
} from "./open-web-research-benchmark-types.js";
import { evaluateOpenWebResearchSecurity } from "./open-web-research-security.js";

const CITATION_TOKEN = /\[citation:citation_[a-z0-9]{8,80}\]/gu;

export function createOpenWebResearchBenchmarkResult(
  content: Omit<OpenWebResearchBenchmarkResult, "contentSha256">,
): OpenWebResearchBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function evaluateOpenWebResearch(input: {
  caseId: string;
  caseSha256: string;
  runStatus: OpenWebResearchBenchmarkResult["run"]["status"];
  events: RunEvent[];
  replayValid: boolean;
  assistantText?: string;
  expected: OpenWebResearchBenchmarkExpected;
  credentialLeakDetected: boolean;
}): Omit<
  OpenWebResearchBenchmarkResult,
  | "kind"
  | "schemaVersion"
  | "generatedAt"
  | "model"
  | "environment"
  | "run"
  | "sourceEventStreamSha256"
  | "sourceReplaySha256"
  | "sourceEventReceiptSetSha256"
  | "retainedEventCount"
  | "contentSha256"
> {
  const assistantText = input.assistantText ?? "";
  const completed = input.events
    .filter((event) => event.type === "tool.completed")
    .flatMap((event) => {
      const payload = record(event.payload);
      const details = record(payload?.["details"]);
      return typeof payload?.["toolName"] === "string" && details
        ? [{ tool: payload["toolName"], details }]
        : [];
    });
  const actualToolSequence = completed.map(
    (entry) => `${entry.tool}:${String(entry.details["action"] ?? "run")}`,
  );
  const actualClaims = extractClaims(assistantText, input.expected.claims);
  const claimEvidence = adjacentClaimEvidence(
    assistantText,
    input.expected.claims,
  );
  const security = evaluateOpenWebResearchSecurity({
    assistantText,
    events: input.events,
    expected: input.expected,
  });
  const expectedClaimsSha256 = sha256(
    canonicalJson(input.expected.claims as unknown as JsonValue),
  );
  const actualClaimsSha256 =
    actualClaims.length > 0
      ? sha256(canonicalJson(actualClaims as unknown as JsonValue))
      : undefined;
  const requiredToolSetSha256 = sha256(
    canonicalJson(input.expected.requiredToolCounts as unknown as JsonValue),
  );
  const sourceDetails = completed.filter(
    (entry) =>
      entry.tool === "research_source" &&
      (entry.details["action"] === "capture" ||
        entry.details["action"] === "capture_fetch"),
  );
  const expectedSourceUrls = input.expected.expectedUrls
    .map((source) => sha256(source.url))
    .sort();
  const actualSourceUrls = sourceDetails
    .flatMap((entry) =>
      typeof entry.details["sourceUrlSha256"] === "string"
        ? [entry.details["sourceUrlSha256"]]
        : [],
    )
    .sort();
  const expectedSourceEvidence = input.expected.expectedUrls
    .map((source) => ({
      sourceUrlSha256: sha256(source.url),
      sourceKind: source.sourceKind,
      ...(source.format ? { webSourceFormat: source.format } : {}),
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const actualSourceEvidence = sourceDetails
    .flatMap((entry) => sourceEvidence(entry.details))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const citations = completed.filter(
    (entry) =>
      entry.tool === "research_source" && entry.details["action"] === "cite",
  );
  const expectedClaimHashes = input.expected.claims
    .map((claim) => sha256(claim))
    .sort();
  const actualCitationClaimHashes = citations
    .flatMap((citation) =>
      typeof citation.details["citationClaimSha256"] === "string"
        ? [citation.details["citationClaimSha256"]]
        : [],
    )
    .sort();
  const citationClaimsMatch =
    canonicalJson(actualCitationClaimHashes) ===
    canonicalJson(expectedClaimHashes);
  const toolTopologyMatch = input.expected.requiredToolCounts.every(
    (required) => {
      const count = actualToolSequence.filter(
        (entry) => entry === required.toolAction,
      ).length;
      return count >= required.minimum && count <= required.maximum;
    },
  );
  const sourceCoverageMatch =
    canonicalJson(actualSourceUrls) === canonicalJson(expectedSourceUrls) &&
    sourceDetails.every(validExpectedSource(input.expected));
  const expectedCitationEvidence = input.expected.citations
    .map((citation) => ({
      sourceUrlSha256: sha256(citation.sourceUrl),
      sourceKind: citation.sourceKind,
      citationClaimSha256: sha256(citation.claim),
      acceptedQuoteSha256: citation.quotes.map((quote) => sha256(quote)).sort(),
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const actualCitationEvidence = citations
    .flatMap((citation) => citationEvidence(citation.details))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const expectedCitationEvidenceSha256 = sha256(
    canonicalJson(expectedCitationEvidence),
  );
  const actualCitationEvidenceSha256 = sha256(
    canonicalJson(actualCitationEvidence),
  );
  const adjacentCitationCount = claimEvidence.filter((claim) =>
    actualCitationEvidence.some(
      (citation) =>
        citation.citationClaimSha256 === claim.claimSha256 &&
        citation.citationTokenSha256 === claim.citationTokenSha256,
    ),
  ).length;
  const citationEvidenceMatch =
    actualCitationEvidence.length === expectedCitationEvidence.length &&
    actualCitationEvidence.every((actual) =>
      expectedCitationEvidence.some(
        (expected) =>
          expected.sourceUrlSha256 === actual.sourceUrlSha256 &&
          expected.sourceKind === actual.sourceKind &&
          expected.citationClaimSha256 === actual.citationClaimSha256 &&
          expected.acceptedQuoteSha256.includes(actual.citationQuoteSha256),
      ),
    );
  const citationAdjacencyMatch =
    claimEvidence.length === input.expected.claims.length &&
    new Set(claimEvidence.map((entry) => entry.claimSha256)).size ===
      input.expected.claims.length &&
    new Set(claimEvidence.map((entry) => entry.citationTokenSha256)).size ===
      input.expected.claims.length &&
    claimEvidence.every((claim) =>
      actualCitationEvidence.some(
        (citation) =>
          citation.citationClaimSha256 === claim.claimSha256 &&
          citation.citationTokenSha256 === claim.citationTokenSha256,
      ),
    );
  const claimsMatch = actualClaimsSha256 === expectedClaimsSha256;
  const diagnostics = [
    ...(input.runStatus === "completed" ? [] : ["run_not_completed"]),
    ...(claimsMatch ? [] : ["claims_mismatch"]),
    ...(toolTopologyMatch ? [] : ["tool_topology_mismatch"]),
    ...(sourceCoverageMatch ? [] : ["source_coverage_mismatch"]),
    ...(citationClaimsMatch ? [] : ["citation_claim_mismatch"]),
    ...(citationEvidenceMatch ? [] : ["citation_evidence_mismatch"]),
    ...(citationAdjacencyMatch ? [] : ["citation_adjacency_mismatch"]),
    ...(input.replayValid ? [] : ["replay_invalid"]),
    ...(input.credentialLeakDetected ? ["credential_leaked"] : []),
    ...security.diagnostics,
  ];
  return {
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    status:
      input.runStatus === "cancelled" || input.runStatus === "interrupted"
        ? "inconclusive"
        : diagnostics.length === 0
          ? "passed"
          : "failed",
    expectedClaimsSha256,
    ...(actualClaimsSha256 ? { actualClaimsSha256 } : {}),
    claimsMatch,
    requiredToolSetSha256,
    actualToolSequenceSha256: sha256(canonicalJson(actualToolSequence)),
    toolTopologyMatch,
    expectedSourceEvidenceSha256: sha256(canonicalJson(expectedSourceEvidence)),
    actualSourceEvidenceSha256: sha256(canonicalJson(actualSourceEvidence)),
    expectedCitationEvidenceSha256,
    actualCitationEvidenceSha256,
    citationEvidenceMatch,
    expectedSourceUrlSetSha256: sha256(canonicalJson(expectedSourceUrls)),
    actualSourceUrlSetSha256: sha256(canonicalJson(actualSourceUrls)),
    sourceCoverageMatch,
    searchCount: countTool(actualToolSequence, "web_search:run"),
    fetchCount: countTool(actualToolSequence, "web_fetch:fetch"),
    browserCount: actualToolSequence.filter((tool) =>
      tool.startsWith("browser:"),
    ).length,
    researchCaptureCount: sourceDetails.length,
    citationCount: citations.length,
    citationSourceKindCount: {
      webFetch: citations.filter(
        (entry) => entry.details["sourceKind"] === "web_fetch",
      ).length,
      browser: citations.filter(
        (entry) => entry.details["sourceKind"] === "browser",
      ).length,
    },
    citationClaimsMatch,
    adjacentCitationCount,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    ...(security.security ? { security: security.security } : {}),
    diagnostics,
    evidence: {
      toolSequence: actualToolSequence,
      ...(security.attemptedToolSequence
        ? { attemptedToolSequence: security.attemptedToolSequence }
        : {}),
      sourceEvidence: actualSourceEvidence,
      citationEvidence: actualCitationEvidence,
      claimEvidence,
      eventReceipts: [],
    },
  };
}

function validExpectedSource(
  expected: OpenWebResearchBenchmarkExpected,
): (entry: { tool: string; details: Record<string, unknown> }) => boolean {
  const byUrl = new Map(
    expected.expectedUrls.map((source) => [sha256(source.url), source]),
  );
  return (entry) => {
    const expectedSource = byUrl.get(String(entry.details["sourceUrlSha256"]));
    if (!expectedSource) return false;
    if (entry.details["sourceKind"] !== expectedSource.sourceKind) return false;
    return expectedSource.format
      ? entry.details["webSourceFormat"] === expectedSource.format
      : true;
  };
}

function sourceEvidence(
  details: Record<string, unknown>,
): OpenWebResearchToolEvidence["sourceEvidence"] {
  const sourceUrlSha256 = details["sourceUrlSha256"];
  const sourceKind = details["sourceKind"];
  if (
    typeof sourceUrlSha256 !== "string" ||
    (sourceKind !== "web_fetch" && sourceKind !== "browser")
  ) {
    return [];
  }
  const webSourceFormat = details["webSourceFormat"];
  const supportedFormat =
    webSourceFormat === "html" ||
    webSourceFormat === "markdown" ||
    webSourceFormat === "json" ||
    webSourceFormat === "text" ||
    webSourceFormat === "pdf";
  return [
    {
      sourceUrlSha256,
      sourceKind,
      ...(sourceKind === "web_fetch" && supportedFormat
        ? { webSourceFormat }
        : {}),
    },
  ];
}

function citationEvidence(
  details: Record<string, unknown>,
): OpenWebResearchToolEvidence["citationEvidence"] {
  const sourceUrlSha256 = details["sourceUrlSha256"];
  const sourceKind = details["sourceKind"];
  const citationClaimSha256 = details["citationClaimSha256"];
  const citationQuoteSha256 = details["citationQuoteSha256"];
  const citationTokenSha256 = details["citationTokenSha256"];
  return typeof sourceUrlSha256 === "string" &&
    (sourceKind === "web_fetch" || sourceKind === "browser") &&
    typeof citationClaimSha256 === "string" &&
    typeof citationQuoteSha256 === "string" &&
    typeof citationTokenSha256 === "string"
    ? [
        {
          sourceUrlSha256,
          sourceKind,
          citationClaimSha256,
          citationQuoteSha256,
          citationTokenSha256,
        },
      ]
    : [];
}

function adjacentClaimEvidence(text: string, expected: string[]) {
  return text.split(/\r?\n/u).flatMap((line) => {
    for (const claim of expected) {
      const match = new RegExp(
        `^${escapeRegExp(claim)}\\s+(\\[citation:citation_[a-z0-9]{8,80}\\])$`,
        "u",
      ).exec(line.trim());
      if (match) {
        return [
          {
            claimSha256: sha256(claim),
            citationTokenSha256: sha256(match[1]!),
          },
        ];
      }
    }
    return [];
  });
}

function extractClaims(text: string, expected: string[]): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(CITATION_TOKEN, "").trim())
    .filter((line) => expected.includes(line));
}

function countTool(tools: string[], value: string): number {
  return tools.filter((tool) => tool === value).length;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

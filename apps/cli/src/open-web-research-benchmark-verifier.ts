import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  OpenWebResearchBenchmarkCase,
  OpenWebResearchBenchmarkExpected,
} from "./open-web-research-benchmark-types.js";

export interface OpenWebResearchBenchmarkVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
}

export function verifyOpenWebResearchBenchmarkResult(
  input: unknown,
): OpenWebResearchBenchmarkVerification {
  const value = record(input);
  if (!value) {
    return {
      valid: false,
      diagnostics: ["result_not_object"],
      resultSha256: sha256(String(input)),
    };
  }
  const diagnostics: string[] = [];
  const contentSha256 = value["contentSha256"];
  const { contentSha256: _ignored, ...content } = value;
  if (
    value["kind"] !== "napier.open-web-research-benchmark-result" ||
    value["schemaVersion"] !== 1 ||
    !digest(contentSha256) ||
    sha256(canonicalJson(content as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("result_shape_or_hash_invalid");
  }
  if (
    !["passed", "failed", "inconclusive"].includes(String(value["status"])) ||
    !stringArray(value["diagnostics"]) ||
    !digest(value["sourceEventStreamSha256"]) ||
    !digest(value["sourceReplaySha256"]) ||
    !digest(value["sourceEventReceiptSetSha256"]) ||
    !validEvidence(value["evidence"], value["sourceEventReceiptSetSha256"])
  ) {
    diagnostics.push("result_evidence_invalid");
  }
  if (!validSummaryBindings(value)) {
    diagnostics.push("result_summary_binding_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: digest(contentSha256) ? contentSha256 : sha256(String(input)),
  };
}

export function verifyOpenWebResearchBenchmarkAgainstCase(
  input: unknown,
  benchmarkCase: OpenWebResearchBenchmarkCase,
  expected: OpenWebResearchBenchmarkExpected,
): OpenWebResearchBenchmarkVerification {
  const generic = verifyOpenWebResearchBenchmarkResult(input);
  const value = record(input);
  if (!value || !generic.valid) return generic;

  const evidence = benchmarkEvidence(value["evidence"]);
  const diagnostics = evidence
    ? verifyCaseBindings(value, evidence, benchmarkCase, expected)
    : ["result_case_binding_invalid"];
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: generic.resultSha256,
  };
}

function verifyCaseBindings(
  value: Record<string, unknown>,
  evidence: BenchmarkEvidence,
  benchmarkCase: OpenWebResearchBenchmarkCase,
  expected: OpenWebResearchBenchmarkExpected,
): string[] {
  const expectedClaimsSha256 = sha256(
    canonicalJson(expected.claims as unknown as JsonValue),
  );
  const expectedClaimHashes = expected.claims.map((claim) => sha256(claim));
  const expectedSourceEvidence = expected.expectedUrls
    .map((source) => ({
      sourceUrlSha256: sha256(source.url),
      sourceKind: source.sourceKind,
      ...(source.format ? { webSourceFormat: source.format } : {}),
    }))
    .sort(compareCanonical);
  const expectedSourceUrls = expected.expectedUrls
    .map((source) => sha256(source.url))
    .sort();
  const expectedCitationEvidence = expected.citations
    .map((citation) => ({
      sourceUrlSha256: sha256(citation.sourceUrl),
      sourceKind: citation.sourceKind,
      citationClaimSha256: sha256(citation.claim),
      acceptedQuoteSha256: citation.quotes.map((quote) => sha256(quote)).sort(),
    }))
    .sort(compareCanonical);
  const actualSources = [...evidence.sourceEvidence].sort(compareCanonical);
  const actualCitations = [...evidence.citationEvidence].sort(compareCanonical);
  const actualSourceUrls = actualSources
    .map((source) => source.sourceUrlSha256)
    .sort();
  const toolTopologyMatch = expected.requiredToolCounts.every((required) => {
    const count = countTool(evidence.toolSequence, required.toolAction);
    return count >= required.minimum && count <= required.maximum;
  });
  const sourceCoverageMatch =
    canonicalJson(actualSourceUrls) === canonicalJson(expectedSourceUrls) &&
    actualSources.length === expectedSourceEvidence.length &&
    canonicalJson(actualSources) === canonicalJson(expectedSourceEvidence);
  const claimsMatch = value["actualClaimsSha256"] === expectedClaimsSha256;
  const citationClaimsMatch =
    sortedStrings(actualCitations.map((entry) => entry.citationClaimSha256)) ===
    sortedStrings(expectedClaimHashes);
  const citationEvidenceMatch =
    actualCitations.length === expectedCitationEvidence.length &&
    actualCitations.every((actual) =>
      expectedCitationEvidence.some(
        (accepted) =>
          accepted.sourceUrlSha256 === actual.sourceUrlSha256 &&
          accepted.sourceKind === actual.sourceKind &&
          accepted.citationClaimSha256 === actual.citationClaimSha256 &&
          accepted.acceptedQuoteSha256.includes(actual.citationQuoteSha256),
      ),
    );
  const adjacentCitationCount = evidence.claimEvidence.filter((claim) =>
    actualCitations.some(
      (citation) =>
        citation.citationClaimSha256 === claim.claimSha256 &&
        citation.citationTokenSha256 === claim.citationTokenSha256,
    ),
  ).length;
  const citationAdjacencyMatch =
    adjacentCitationCount === expected.claims.length &&
    sortedStrings(evidence.claimEvidence.map((entry) => entry.claimSha256)) ===
      sortedStrings(expectedClaimHashes) &&
    uniqueStrings(
      evidence.claimEvidence.map((entry) => entry.citationTokenSha256),
    ) &&
    uniqueStrings(actualCitations.map((entry) => entry.citationTokenSha256));
  const evaluationDiagnostics = [
    ...(value["run"] && record(value["run"])?.["status"] === "completed"
      ? []
      : ["run_not_completed"]),
    ...(claimsMatch ? [] : ["claims_mismatch"]),
    ...(toolTopologyMatch ? [] : ["tool_topology_mismatch"]),
    ...(sourceCoverageMatch ? [] : ["source_coverage_mismatch"]),
    ...(citationClaimsMatch ? [] : ["citation_claim_mismatch"]),
    ...(citationEvidenceMatch ? [] : ["citation_evidence_mismatch"]),
    ...(citationAdjacencyMatch ? [] : ["citation_adjacency_mismatch"]),
    ...(value["replayValid"] === true ? [] : ["replay_invalid"]),
    ...(value["credentialLeakDetected"] === true ? ["credential_leaked"] : []),
  ];
  const runStatus = record(value["run"])?.["status"];
  const expectedStatus =
    runStatus === "cancelled" || runStatus === "interrupted"
      ? "inconclusive"
      : evaluationDiagnostics.length === 0
        ? "passed"
        : "failed";
  const expectedBindings: Array<[unknown, unknown]> = [
    [value["caseId"], benchmarkCase.id],
    [value["caseSha256"], benchmarkCase.contentSha256],
    [value["expectedClaimsSha256"], expectedClaimsSha256],
    [
      value["requiredToolSetSha256"],
      sha256(
        canonicalJson(expected.requiredToolCounts as unknown as JsonValue),
      ),
    ],
    [
      value["expectedSourceEvidenceSha256"],
      sha256(canonicalJson(expectedSourceEvidence)),
    ],
    [
      value["expectedCitationEvidenceSha256"],
      sha256(canonicalJson(expectedCitationEvidence)),
    ],
    [
      value["expectedSourceUrlSetSha256"],
      sha256(canonicalJson(expectedSourceUrls)),
    ],
    [value["claimsMatch"], claimsMatch],
    [value["toolTopologyMatch"], toolTopologyMatch],
    [value["sourceCoverageMatch"], sourceCoverageMatch],
    [value["citationClaimsMatch"], citationClaimsMatch],
    [value["citationEvidenceMatch"], citationEvidenceMatch],
    [value["adjacentCitationCount"], adjacentCitationCount],
    [value["status"], expectedStatus],
    [
      canonicalJson(value["diagnostics"] as JsonValue),
      canonicalJson(evaluationDiagnostics),
    ],
  ];
  return expectedBindings.every(([actual, accepted]) => actual === accepted)
    ? []
    : ["result_case_binding_invalid"];
}

function validEvidence(value: unknown, expectedReceiptSet: unknown): boolean {
  const evidence = benchmarkEvidence(value);
  if (!evidence || !digest(expectedReceiptSet)) return false;
  return (
    validReceiptChain(evidence.eventReceipts) &&
    sha256(canonicalJson(evidence.eventReceipts as unknown as JsonValue)) ===
      expectedReceiptSet
  );
}

function benchmarkEvidence(value: unknown): BenchmarkEvidence | undefined {
  const evidence = record(value);
  if (
    !evidence ||
    !stringArray(evidence["toolSequence"]) ||
    !Array.isArray(evidence["sourceEvidence"]) ||
    !evidence["sourceEvidence"].every(validSourceEvidence) ||
    !Array.isArray(evidence["citationEvidence"]) ||
    !evidence["citationEvidence"].every(validCitationEvidence) ||
    !Array.isArray(evidence["claimEvidence"]) ||
    !evidence["claimEvidence"].every(validClaimEvidence) ||
    !Array.isArray(evidence["eventReceipts"]) ||
    !evidence["eventReceipts"].every(validReceiptShape)
  ) {
    return undefined;
  }
  return evidence as unknown as BenchmarkEvidence;
}

function validSummaryBindings(value: Record<string, unknown>): boolean {
  const evidence = benchmarkEvidence(value["evidence"]);
  if (!evidence) return false;
  const sourceUrls = evidence.sourceEvidence
    .map((source) => source.sourceUrlSha256)
    .sort();
  const webFetchCitationCount = evidence.citationEvidence.filter(
    (citation) => citation.sourceKind === "web_fetch",
  ).length;
  const browserCitationCount = evidence.citationEvidence.filter(
    (citation) => citation.sourceKind === "browser",
  ).length;
  const adjacentCitationCount = evidence.claimEvidence.filter((claim) =>
    evidence.citationEvidence.some(
      (citation) =>
        citation.citationClaimSha256 === claim.claimSha256 &&
        citation.citationTokenSha256 === claim.citationTokenSha256,
    ),
  ).length;
  return (
    value["actualToolSequenceSha256"] ===
      sha256(canonicalJson(evidence.toolSequence)) &&
    value["actualSourceEvidenceSha256"] ===
      sha256(canonicalJson(evidence.sourceEvidence as unknown as JsonValue)) &&
    value["actualCitationEvidenceSha256"] ===
      sha256(
        canonicalJson(evidence.citationEvidence as unknown as JsonValue),
      ) &&
    value["actualSourceUrlSetSha256"] === sha256(canonicalJson(sourceUrls)) &&
    value["searchCount"] ===
      countTool(evidence.toolSequence, "web_search:run") &&
    value["fetchCount"] ===
      countTool(evidence.toolSequence, "web_fetch:fetch") &&
    value["browserCount"] ===
      evidence.toolSequence.filter((tool) => tool.startsWith("browser:"))
        .length &&
    value["researchCaptureCount"] ===
      countTool(evidence.toolSequence, "research_source:capture") +
        countTool(evidence.toolSequence, "research_source:capture_fetch") &&
    value["citationCount"] ===
      countTool(evidence.toolSequence, "research_source:cite") &&
    record(value["citationSourceKindCount"])?.["webFetch"] ===
      webFetchCitationCount &&
    record(value["citationSourceKindCount"])?.["browser"] ===
      browserCitationCount &&
    value["adjacentCitationCount"] === adjacentCitationCount &&
    value["retainedEventCount"] === evidence.eventReceipts.length
  );
}

function validReceiptChain(value: BenchmarkEvidence["eventReceipts"]): boolean {
  let previous = sha256("");
  for (const receipt of value) {
    if (receipt.previousReceiptSha256 !== previous) return false;
    const content = {
      seq: receipt.seq,
      type: receipt.type,
      payloadSha256: receipt.payloadSha256,
      previousReceiptSha256: receipt.previousReceiptSha256,
    };
    if (sha256(canonicalJson(content)) !== receipt.receiptSha256) return false;
    previous = receipt.receiptSha256;
  }
  return true;
}

function validSourceEvidence(value: unknown): boolean {
  const source = record(value);
  if (
    !source ||
    !digest(source["sourceUrlSha256"]) ||
    (source["sourceKind"] !== "web_fetch" && source["sourceKind"] !== "browser")
  ) {
    return false;
  }
  return source["sourceKind"] === "browser"
    ? exactKeys(source, ["sourceUrlSha256", "sourceKind"])
    : exactKeys(source, ["sourceUrlSha256", "sourceKind", "webSourceFormat"]) &&
        (source["webSourceFormat"] === "html" ||
          source["webSourceFormat"] === "pdf");
}

function validCitationEvidence(value: unknown): boolean {
  const citation = record(value);
  return Boolean(
    citation &&
    exactKeys(citation, [
      "sourceUrlSha256",
      "sourceKind",
      "citationClaimSha256",
      "citationQuoteSha256",
      "citationTokenSha256",
    ]) &&
    digest(citation["sourceUrlSha256"]) &&
    (citation["sourceKind"] === "web_fetch" ||
      citation["sourceKind"] === "browser") &&
    digest(citation["citationClaimSha256"]) &&
    digest(citation["citationQuoteSha256"]) &&
    digest(citation["citationTokenSha256"]),
  );
}

function validClaimEvidence(value: unknown): boolean {
  const claim = record(value);
  return Boolean(
    claim &&
    exactKeys(claim, ["claimSha256", "citationTokenSha256"]) &&
    digest(claim["claimSha256"]) &&
    digest(claim["citationTokenSha256"]),
  );
}

function validReceiptShape(value: unknown): boolean {
  const receipt = record(value);
  return Boolean(
    receipt &&
    exactKeys(receipt, [
      "seq",
      "type",
      "payloadSha256",
      "previousReceiptSha256",
      "receiptSha256",
    ]) &&
    Number.isSafeInteger(receipt["seq"]) &&
    typeof receipt["type"] === "string" &&
    digest(receipt["payloadSha256"]) &&
    digest(receipt["previousReceiptSha256"]) &&
    digest(receipt["receiptSha256"]),
  );
}

function countTool(tools: string[], value: string): number {
  return tools.filter((tool) => tool === value).length;
}

function sortedStrings(values: string[]): string {
  return canonicalJson([...values].sort());
}

function uniqueStrings(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function compareCanonical(left: unknown, right: unknown): number {
  return canonicalJson(left as JsonValue).localeCompare(
    canonicalJson(right as JsonValue),
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

interface BenchmarkEvidence {
  toolSequence: string[];
  sourceEvidence: Array<{
    sourceUrlSha256: string;
    sourceKind: "web_fetch" | "browser";
    webSourceFormat?: "html" | "pdf";
  }>;
  citationEvidence: Array<{
    sourceUrlSha256: string;
    sourceKind: "web_fetch" | "browser";
    citationClaimSha256: string;
    citationQuoteSha256: string;
    citationTokenSha256: string;
  }>;
  claimEvidence: Array<{
    claimSha256: string;
    citationTokenSha256: string;
  }>;
  eventReceipts: Array<{
    seq: number;
    type: string;
    payloadSha256: string;
    previousReceiptSha256: string;
    receiptSha256: string;
  }>;
}

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type { OpenWebResearchToolEvidence } from "./open-web-research-benchmark-types.js";
import { validOpenWebResearchSecuritySummary } from "./open-web-research-security.js";

export interface OpenWebResearchBenchmarkVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
}

const RESULT_KEYS = [
  "kind",
  "schemaVersion",
  "generatedAt",
  "caseId",
  "caseSha256",
  "status",
  "model",
  "environment",
  "run",
  "expectedClaimsSha256",
  "claimsMatch",
  "requiredToolSetSha256",
  "actualToolSequenceSha256",
  "toolTopologyMatch",
  "expectedSourceEvidenceSha256",
  "actualSourceEvidenceSha256",
  "expectedCitationEvidenceSha256",
  "actualCitationEvidenceSha256",
  "citationEvidenceMatch",
  "expectedSourceUrlSetSha256",
  "actualSourceUrlSetSha256",
  "sourceCoverageMatch",
  "searchCount",
  "fetchCount",
  "browserCount",
  "researchCaptureCount",
  "citationCount",
  "citationSourceKindCount",
  "citationClaimsMatch",
  "adjacentCitationCount",
  "replayValid",
  "credentialLeakDetected",
  "diagnostics",
  "sourceEventStreamSha256",
  "sourceReplaySha256",
  "sourceEventReceiptSetSha256",
  "retainedEventCount",
  "evidence",
  "contentSha256",
] as const;

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
    (value["schemaVersion"] !== 1 && value["schemaVersion"] !== 2) ||
    !exactKeys(value, [
      ...RESULT_KEYS,
      ...(value["actualClaimsSha256"] !== undefined
        ? ["actualClaimsSha256"]
        : []),
      ...(value["schemaVersion"] === 2 ? ["security"] : []),
    ]) ||
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

export function openWebResearchBenchmarkEvidence(
  value: unknown,
): OpenWebResearchToolEvidence | undefined {
  const evidence = record(value);
  if (
    !evidence ||
    !exactKeys(evidence, [
      "toolSequence",
      ...(evidence["attemptedToolSequence"] !== undefined
        ? ["attemptedToolSequence"]
        : []),
      "sourceEvidence",
      "citationEvidence",
      "claimEvidence",
      "eventReceipts",
    ]) ||
    !stringArray(evidence["toolSequence"]) ||
    (evidence["attemptedToolSequence"] !== undefined &&
      !stringArray(evidence["attemptedToolSequence"])) ||
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
  return evidence as unknown as OpenWebResearchToolEvidence;
}

function validEvidence(value: unknown, expectedReceiptSet: unknown): boolean {
  const evidence = openWebResearchBenchmarkEvidence(value);
  if (!evidence || !digest(expectedReceiptSet)) return false;
  return (
    validReceiptChain(evidence.eventReceipts) &&
    sha256(canonicalJson(evidence.eventReceipts as unknown as JsonValue)) ===
      expectedReceiptSet
  );
}

function validSummaryBindings(value: Record<string, unknown>): boolean {
  const evidence = openWebResearchBenchmarkEvidence(value["evidence"]);
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
  const securityValid =
    value["schemaVersion"] === 1
      ? value["security"] === undefined &&
        evidence.attemptedToolSequence === undefined
      : validOpenWebResearchSecuritySummary(value["security"], evidence);
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
    value["retainedEventCount"] === evidence.eventReceipts.length &&
    securityValid
  );
}

function validReceiptChain(
  value: OpenWebResearchToolEvidence["eventReceipts"],
): boolean {
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
          source["webSourceFormat"] === "markdown" ||
          source["webSourceFormat"] === "json" ||
          source["webSourceFormat"] === "text" ||
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

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
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

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import { validResearchBenchmarkResultShape } from "./research-benchmark-artifact-shape.js";
import {
  citationEvidenceFromDetails,
  citationEvidenceSha256,
  sourceSetSha256,
} from "./research-benchmark-evidence.js";
import { verifyResearchBenchmarkLedgerBundle } from "./research-benchmark-ledger.js";
import type {
  ResearchBenchmarkArtifactVerification,
  ResearchBenchmarkDiagnostic,
  ResearchBenchmarkEvaluation,
  ResearchBenchmarkLedgerBundle,
  ResearchBenchmarkResult,
} from "./research-benchmark-types.js";

const CRITERIA = [
  "run_completed",
  "exact_claim_lines",
  "fixed_source_capture_set",
  "exact_claim_source_line_citations",
  "two_primary_sources",
  "one_secondary_source",
  "explicit_contradiction",
  "workspace_report_verified",
  "portable_replay",
  "credential_absent",
] as const;
interface CreateResearchBenchmarkEvaluationInput {
  caseId: string;
  caseSha256: string;
  runStatus: ResearchBenchmarkResult["run"]["status"];
  expectedClaimsSha256: string;
  actualClaimsSha256?: string;
  expectedCitationEvidenceSha256: string;
  actualCitationEvidenceSha256: string;
  expectedSourceSetSha256: string;
  actualSourceSetSha256: string;
  captureCount: number;
  citationCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  contradictionFound: boolean;
  reportVerified: boolean;
  reportFileSha256?: string;
  reportFileBytes: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
}

export function createResearchBenchmarkEvaluation(
  input: CreateResearchBenchmarkEvaluationInput,
): ResearchBenchmarkEvaluation {
  const claimsMatch = input.actualClaimsSha256 === input.expectedClaimsSha256;
  const sourceCaptureMatch =
    input.actualSourceSetSha256 === input.expectedSourceSetSha256 &&
    input.captureCount === 3;
  const citationEvidenceMatch =
    input.actualCitationEvidenceSha256 === input.expectedCitationEvidenceSha256;
  const diagnostics = researchBenchmarkDiagnostics(
    input,
    claimsMatch,
    sourceCaptureMatch,
    citationEvidenceMatch,
  );
  const status =
    input.runStatus === "cancelled" || input.runStatus === "interrupted"
      ? ("inconclusive" as const)
      : diagnostics.length === 0
        ? ("passed" as const)
        : ("failed" as const);
  const content = {
    kind: "napier.research-benchmark-evaluation" as const,
    schemaVersion: 1 as const,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    status,
    runStatus: input.runStatus,
    criteriaSha256: sha256(canonicalJson(CRITERIA)),
    expectedClaimsSha256: input.expectedClaimsSha256,
    ...(input.actualClaimsSha256
      ? { actualClaimsSha256: input.actualClaimsSha256 }
      : {}),
    claimsMatch,
    expectedCitationEvidenceSha256: input.expectedCitationEvidenceSha256,
    actualCitationEvidenceSha256: input.actualCitationEvidenceSha256,
    citationEvidenceMatch,
    expectedSourceSetSha256: input.expectedSourceSetSha256,
    actualSourceSetSha256: input.actualSourceSetSha256,
    sourceCaptureMatch,
    captureCount: input.captureCount,
    citationCount: input.citationCount,
    primarySourceCount: input.primarySourceCount,
    secondarySourceCount: input.secondarySourceCount,
    contradictionFound: input.contradictionFound,
    reportVerified: input.reportVerified,
    ...(input.reportFileSha256
      ? { reportFileSha256: input.reportFileSha256 }
      : {}),
    reportFileBytes: input.reportFileBytes,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    diagnostics,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

function researchBenchmarkDiagnostics(
  input: CreateResearchBenchmarkEvaluationInput,
  claimsMatch: boolean,
  sourceCaptureMatch: boolean,
  citationEvidenceMatch: boolean,
): ResearchBenchmarkDiagnostic[] {
  const diagnostics: ResearchBenchmarkDiagnostic[] = [];
  if (input.runStatus !== "completed") diagnostics.push("run_not_completed");
  if (!input.reportFileSha256) diagnostics.push("report_missing");
  if (!claimsMatch) diagnostics.push("claims_mismatch");
  if (!sourceCaptureMatch) diagnostics.push("source_capture_mismatch");
  if (input.citationCount !== 7) {
    diagnostics.push("citation_count_mismatch");
  }
  if (!citationEvidenceMatch) {
    diagnostics.push("citation_evidence_mismatch");
  }
  if (input.primarySourceCount !== 2) {
    diagnostics.push("primary_source_coverage_mismatch");
  }
  if (input.secondarySourceCount !== 1) {
    diagnostics.push("secondary_source_coverage_mismatch");
  }
  if (!input.contradictionFound) diagnostics.push("contradiction_missing");
  if (!input.reportVerified) diagnostics.push("report_not_verified");
  if (!input.replayValid) diagnostics.push("replay_invalid");
  if (input.credentialLeakDetected) diagnostics.push("credential_leaked");
  return diagnostics;
}

export function createResearchBenchmarkResult(
  content: Omit<ResearchBenchmarkResult, "contentSha256">,
): ResearchBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyResearchBenchmarkArtifacts(
  resultInput: unknown,
  bundleInput: unknown,
): ResearchBenchmarkArtifactVerification {
  if (!validResearchBenchmarkResultShape(resultInput)) {
    return {
      valid: false,
      diagnostics: ["result_shape_invalid"],
      resultSha256: sha256(String(resultInput)),
    };
  }
  const result = resultInput;
  const diagnostics: string[] = [];
  const { contentSha256, ...content } = result;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  const ledger = verifyResearchBenchmarkLedgerBundle(bundleInput);
  if (!ledger.valid) {
    diagnostics.push(
      "ledger_invalid",
      ...ledger.diagnostics.map((diagnostic) => `ledger:${diagnostic}`),
    );
  }
  const bundle = bundleInput as ResearchBenchmarkLedgerBundle;
  if (ledger.valid && !bundleMatchesResult(result, bundle)) {
    diagnostics.push("ledger_binding_mismatch");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256: result.contentSha256,
    ...(ledger.valid ? { bundleSha256: bundle.contentSha256 } : {}),
  };
}

function bundleMatchesResult(
  result: ResearchBenchmarkResult,
  bundle: ResearchBenchmarkLedgerBundle,
): boolean {
  const expectedEvaluation = createResearchBenchmarkEvaluation({
    caseId: result.caseId,
    caseSha256: result.caseSha256,
    runStatus: bundle.run.status,
    expectedClaimsSha256: bundle.expectedClaimsSha256,
    ...(bundle.actualClaimsSha256
      ? { actualClaimsSha256: bundle.actualClaimsSha256 }
      : {}),
    expectedCitationEvidenceSha256: bundle.expectedCitationEvidenceSha256,
    expectedSourceSetSha256: bundle.expectedSourceSetSha256,
    ...researchEventOutcome(bundle),
    ...(bundle.report.fileSha256
      ? { reportFileSha256: bundle.report.fileSha256 }
      : {}),
    reportFileBytes: bundle.report.fileBytes,
    replayValid: result.evaluation.replayValid,
    credentialLeakDetected: result.evaluation.credentialLeakDetected,
  });
  return (
    bundle.caseId === result.caseId &&
    bundle.caseSha256 === result.caseSha256 &&
    bundle.threadId === result.run.threadId &&
    canonicalJson(bundle.run as unknown as JsonValue) ===
      canonicalJson(result.run as unknown as JsonValue) &&
    canonicalJson(bundle.report as unknown as JsonValue) ===
      canonicalJson(result.report as unknown as JsonValue) &&
    canonicalJson(bundle.evaluationEvent.payload) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    canonicalJson(expectedEvaluation as unknown as JsonValue) ===
      canonicalJson(result.evaluation as unknown as JsonValue) &&
    result.ledger.eventId === bundle.evaluationEvent.id &&
    result.ledger.eventSeq === bundle.evaluationEvent.seq &&
    result.ledger.eventSha256 ===
      sha256(JSON.stringify(bundle.evaluationEvent)) &&
    result.ledger.eventStreamSha256 === bundle.sourceEventStreamSha256 &&
    result.ledger.bundleSha256 === bundle.contentSha256
  );
}

function researchEventOutcome(bundle: ResearchBenchmarkLedgerBundle) {
  const details = bundle.researchEvents.flatMap((event) => {
    const payload = record(event.payload);
    const value = record(payload?.["details"]);
    return value ? [value] : [];
  });
  const captures = sourceHashes(details, "capture");
  const cited = [...new Set(sourceHashes(details, "cite"))];
  const authority = new Map(
    bundle.sourceAuthorities.map((source) => [
      source.sourceContentSha256,
      source.authority,
    ]),
  );
  const verification = details.find(
    (detail) => detail["action"] === "verify_report",
  );
  const claimsMatch =
    bundle.actualClaimsSha256 !== undefined &&
    bundle.actualClaimsSha256 === bundle.expectedClaimsSha256;
  return {
    actualSourceSetSha256: sourceSetSha256(captures),
    actualCitationEvidenceSha256: citationEvidenceSha256(
      citationEvidenceFromDetails(details),
    ),
    captureCount: details.filter((detail) => detail["action"] === "capture")
      .length,
    citationCount: details.filter((detail) => detail["action"] === "cite")
      .length,
    primarySourceCount: cited.filter(
      (hash) => authority.get(hash) === "primary",
    ).length,
    secondarySourceCount: cited.filter(
      (hash) => authority.get(hash) === "secondary",
    ).length,
    contradictionFound: claimsMatch && digest(bundle.contradictionClaimSha256),
    reportVerified:
      verification?.["reportFileSha256"] === bundle.report.fileSha256 &&
      verification?.["reportCitationCount"] === 7,
  };
}

function sourceHashes(
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

export function researchBenchmarkResultFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-research-benchmark-result-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

export function researchBenchmarkLedgerFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-research-benchmark-ledger-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

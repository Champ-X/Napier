import type {
  ModelAdvisorDiagnostic,
  ModelAdvisorNoticePayload,
  ModelAdvisorRuleId,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export interface CreateModelAdvisorNoticeInput {
  assistantText: string;
  runEvents: RunEvent[];
  turnSource: string;
}

const VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:tests?|test suite|typecheck|type-check|build|lint|checks?|verification|verify_workspace)\b.{0,40}\b(?:passed|pass|green|succeeded|successful|clean)\b/iu,
  /\b(?:passed|green|succeeded|successful|clean)\b.{0,40}\b(?:tests?|test suite|typecheck|type-check|build|lint|checks?|verification|verify_workspace)\b/iu,
  /(?:测试|构建|类型检查|检查|校验).{0,16}(?:通过|成功|全绿)/u,
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\bgit\s+reset\s+--hard\b/iu,
  /\bgit\s+checkout\s+--\s+\S+/iu,
  /\brm\s+-rf\s+(?:\/|~|\.)/iu,
  /\bsudo\s+rm\s+-rf\b/iu,
  /\bmkfs(?:\.[a-z0-9]+)?\s+/iu,
  /\bdiskutil\s+erase\w*\b/iu,
];

export function createModelAdvisorNotice(
  input: CreateModelAdvisorNoticeInput,
): ModelAdvisorNoticePayload | undefined {
  const textSha256 = sha256(input.assistantText);
  const evidence = createAdvisorEvidence(input.assistantText, input.runEvents);
  const diagnostics = [
    createVerificationClaimDiagnostic(input.assistantText, evidence),
    createDestructiveCommandDiagnostic(input.assistantText),
  ].filter((diagnostic): diagnostic is ModelAdvisorDiagnostic =>
    Boolean(diagnostic),
  );
  if (diagnostics.length === 0) return undefined;

  const diagnosticSetSha256 = sha256(
    canonicalJson(
      diagnostics.map((diagnostic) => ({
        ruleId: diagnostic.ruleId,
        severity: diagnostic.severity,
        matchCount: diagnostic.matchCount,
        evidenceSha256: diagnostic.evidenceSha256,
      })),
    ),
  );
  const content = {
    kind: "napier.model-advisor-notice" as const,
    schemaVersion: 1 as const,
    source: "deterministic_stream_lint" as const,
    turnSource: input.turnSource,
    status: "notice" as const,
    textSha256,
    diagnosticCount: diagnostics.length,
    diagnosticSetSha256,
    diagnostics,
    evidence,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createAdvisorEvidence(
  assistantText: string,
  runEvents: RunEvent[],
): ModelAdvisorNoticePayload["evidence"] {
  const toolCompletedEvents = runEvents.filter(
    (event) => event.type === "tool.completed",
  );
  return {
    assistantTextBytes: Buffer.byteLength(assistantText, "utf8"),
    assistantLineCount:
      assistantText.length === 0
        ? 0
        : assistantText.split(/\r\n|\r|\n/u).length,
    toolCompletedCount: toolCompletedEvents.length,
    verificationToolCompleted: toolCompletedEvents.some(
      (event) =>
        isRecord(event.payload) &&
        event.payload["toolName"] === "verify_workspace",
    ),
  };
}

function createVerificationClaimDiagnostic(
  assistantText: string,
  evidence: ModelAdvisorNoticePayload["evidence"],
): ModelAdvisorDiagnostic | undefined {
  const matchCount = countPatternHits(
    assistantText,
    VERIFICATION_CLAIM_PATTERNS,
  );
  if (matchCount === 0 || evidence.verificationToolCompleted) {
    return undefined;
  }
  return createDiagnostic(
    "unverified_verification_claim",
    "warning",
    matchCount,
    {
      matchCount,
      verificationToolCompleted: evidence.verificationToolCompleted,
      toolCompletedCount: evidence.toolCompletedCount,
    },
  );
}

function createDestructiveCommandDiagnostic(
  assistantText: string,
): ModelAdvisorDiagnostic | undefined {
  const matchCount = countPatternHits(
    assistantText,
    DESTRUCTIVE_COMMAND_PATTERNS,
  );
  if (matchCount === 0) return undefined;
  return createDiagnostic(
    "destructive_command_reference",
    "blocker",
    matchCount,
    { matchCount },
  );
}

function createDiagnostic(
  ruleId: ModelAdvisorRuleId,
  severity: ModelAdvisorDiagnostic["severity"],
  matchCount: number,
  evidence: Record<string, unknown>,
): ModelAdvisorDiagnostic {
  return {
    ruleId,
    severity,
    matchCount,
    evidenceSha256: sha256(canonicalJson({ ruleId, ...evidence })),
  };
}

function countPatternHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

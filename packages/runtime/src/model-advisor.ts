import type {
  IndependentModelAdvisorReview,
  ModelAdvisorBlockerId,
  ModelAdvisorCorrectionOutcomePayload,
  ModelAdvisorCorrectionRequestPayload,
  ModelAdvisorDiagnostic,
  ModelAdvisorNoticePayload,
  ModelAdvisorRuleId,
  ResolvedModelAdvisorPolicy,
  RunEvent,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { IndependentModelAdvisorGuidance } from "./independent-model-advisor.js";

export interface CreateModelAdvisorNoticeInput {
  assistantText: string;
  runEvents: RunEvent[];
  turnSource: string;
  policy: ResolvedModelAdvisorPolicy;
}

export interface ModelAdvisorCorrectionRequest {
  prompt: string;
  payload: ModelAdvisorCorrectionRequestPayload;
}

export interface ModelAdvisorBlockEvidence {
  textSha256: string;
  evidenceSha256: string;
  blockerIds: ModelAdvisorBlockerId[];
  guidance: string[];
  correctable: boolean;
}

export class ModelAdvisorBlockedError extends Error {
  readonly block: ModelAdvisorBlockEvidence;

  constructor(readonly notice: ModelAdvisorNoticePayload) {
    const block = createModelAdvisorBlockFromNotice(notice);
    super(`Model Advisor blocked assistant response: ${block.evidenceSha256}`);
    this.name = "ModelAdvisorBlockedError";
    this.block = block;
  }
}

export class CombinedModelAdvisorBlockedError extends Error {
  constructor(readonly block: ModelAdvisorBlockEvidence) {
    super(`Model Advisor blocked assistant response: ${block.evidenceSha256}`);
    this.name = "CombinedModelAdvisorBlockedError";
  }
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
  if (input.policy.mode === "off" || input.policy.enabledRules.length === 0) {
    return undefined;
  }
  const textSha256 = sha256(input.assistantText);
  const evidence = createAdvisorEvidence(input.assistantText, input.runEvents);
  const diagnostics = [
    input.policy.enabledRules.includes("unverified_verification_claim")
      ? createVerificationClaimDiagnostic(input.assistantText, evidence)
      : undefined,
    input.policy.enabledRules.includes("destructive_command_reference")
      ? createDestructiveCommandDiagnostic(input.assistantText)
      : undefined,
  ].filter((diagnostic): diagnostic is ModelAdvisorDiagnostic =>
    Boolean(diagnostic),
  );
  if (diagnostics.length === 0) return undefined;

  const blocked =
    input.policy.mode === "enforce" &&
    diagnostics.some((diagnostic) => diagnostic.severity === "blocker");
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
    policy: input.policy,
    status: blocked ? ("blocked" as const) : ("notice" as const),
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

export function isModelAdvisorBlocked(
  notice: ModelAdvisorNoticePayload,
): boolean {
  return notice.status === "blocked";
}

export function createModelAdvisorCorrectionRequest(input: {
  notice: ModelAdvisorNoticePayload;
  turnSource: string;
  attempt: number;
  maxAttempts: number;
}): ModelAdvisorCorrectionRequest {
  if (!isModelAdvisorBlocked(input.notice)) {
    throw new Error("Model Advisor correction request is invalid");
  }
  return createModelAdvisorCorrectionRequestFromBlock({
    block: createModelAdvisorBlockFromNotice(input.notice),
    turnSource: input.turnSource,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
  });
}

export function createModelAdvisorCorrectionRequestFromBlock(input: {
  block: ModelAdvisorBlockEvidence;
  turnSource: string;
  attempt: number;
  maxAttempts: number;
}): ModelAdvisorCorrectionRequest {
  if (
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !Number.isSafeInteger(input.maxAttempts) ||
    input.maxAttempts < input.attempt ||
    !input.block.correctable ||
    !/^[a-f0-9]{64}$/u.test(input.block.textSha256) ||
    !/^[a-f0-9]{64}$/u.test(input.block.evidenceSha256)
  ) {
    throw new Error("Model Advisor correction request is invalid");
  }
  const blockerRuleIds = [
    ...new Set(input.block.blockerIds),
  ].sort() as ModelAdvisorBlockerId[];
  if (blockerRuleIds.length === 0) {
    throw new Error("Model Advisor correction request has no blocker rule");
  }
  const guidance = input.block.guidance.map((entry) =>
    normalizeCorrectionGuidance(entry),
  );
  if (guidance.length > 6) {
    throw new Error("Model Advisor correction guidance is invalid");
  }
  const prompt = [
    "<model-advisor-correction>",
    "The previous draft was blocked by the configured output advisors.",
    "Rewrite the final answer for the original operator request.",
    "Do not call tools, claim new tool results, or quote the previous draft.",
    `Address blocker categories: ${blockerRuleIds.join(", ")}.`,
    ...guidance.map((entry) => `Reviewer guidance: ${entry}`),
    `Advisor evidence SHA-256: ${input.block.evidenceSha256}`,
    `Correction attempt: ${input.attempt} of ${input.maxAttempts}`,
    "Return only the corrected final answer.",
    "</model-advisor-correction>",
  ].join("\n");
  const content = {
    kind: "napier.model-advisor-correction-request" as const,
    schemaVersion: 1 as const,
    source: blockerRuleIds.some((rule) =>
      rule.startsWith("independent_review:"),
    )
      ? ("combined_advisor" as const)
      : ("deterministic_stream_lint" as const),
    turnSource: input.turnSource,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    predecessorTextSha256: input.block.textSha256,
    diagnosticSetSha256: input.block.evidenceSha256,
    blockerRuleIds,
    correctivePromptSha256: sha256(prompt),
  };
  return {
    prompt,
    payload: {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  };
}

export function createCombinedModelAdvisorBlock(input: {
  notice?: ModelAdvisorNoticePayload;
  review?: IndependentModelAdvisorReview;
  reviewGuidance?: IndependentModelAdvisorGuidance[];
  policy: ResolvedModelAdvisorPolicy;
}): ModelAdvisorBlockEvidence | undefined {
  const deterministicBlocked = Boolean(
    input.notice && isModelAdvisorBlocked(input.notice),
  );
  const independentBlocked = Boolean(
    input.review &&
    input.policy.mode === "enforce" &&
    input.review.verdict !== "accept",
  );
  if (!deterministicBlocked && !independentBlocked) return undefined;
  const blockerIds: ModelAdvisorBlockerId[] = [
    ...(deterministicBlocked
      ? input
          .notice!.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "blocker",
          )
          .map((diagnostic) => diagnostic.ruleId)
      : []),
    ...(independentBlocked && input.review
      ? input.review.issues.length > 0
        ? input.review.issues.map(
            (issue) =>
              `independent_review:${issue.code}` as ModelAdvisorBlockerId,
          )
        : (["independent_review:inconclusive"] as ModelAdvisorBlockerId[])
      : []),
  ];
  const evidenceParts = {
    deterministicNoticeSha256: input.notice?.contentSha256 ?? "",
    independentReviewSha256: input.review?.contentSha256 ?? "",
  };
  const evidenceSha256 =
    deterministicBlocked && !independentBlocked
      ? input.notice!.diagnosticSetSha256
      : sha256(canonicalJson(evidenceParts));
  return {
    textSha256: input.review?.candidateTextSha256 ?? input.notice!.textSha256,
    evidenceSha256,
    blockerIds,
    guidance:
      input.reviewGuidance?.map((issue) => issue.guidance) ??
      (independentBlocked
        ? [
            "Return a conservative answer that clearly states unresolved evidence and uncertainty.",
          ]
        : []),
    correctable: input.review?.verdict !== "inconclusive",
  };
}

export function createModelAdvisorCorrectionOutcome(input: {
  request: ModelAdvisorCorrectionRequestPayload;
  status: ModelAdvisorCorrectionOutcomePayload["status"];
  responseTextSha256: string;
  diagnosticSetSha256?: string;
}): ModelAdvisorCorrectionOutcomePayload {
  if (
    !/^[a-f0-9]{64}$/u.test(input.responseTextSha256) ||
    (input.status === "accepted" && input.diagnosticSetSha256 !== undefined) ||
    (input.status !== "accepted" &&
      !/^[a-f0-9]{64}$/u.test(input.diagnosticSetSha256 ?? ""))
  ) {
    throw new Error("Model Advisor correction outcome is invalid");
  }
  const content = {
    kind: "napier.model-advisor-correction-outcome" as const,
    schemaVersion: 1 as const,
    source: input.request.source,
    status: input.status,
    attempt: input.request.attempt,
    maxAttempts: input.request.maxAttempts,
    requestContentSha256: input.request.contentSha256,
    responseTextSha256: input.responseTextSha256,
    ...(input.diagnosticSetSha256
      ? { diagnosticSetSha256: input.diagnosticSetSha256 }
      : {}),
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

function normalizeCorrectionGuidance(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || normalized.length > 600) {
    throw new Error("Model Advisor correction guidance is invalid");
  }
  return normalized;
}

export function createModelAdvisorBlockFromNotice(
  notice: ModelAdvisorNoticePayload,
): ModelAdvisorBlockEvidence {
  return {
    textSha256: notice.textSha256,
    evidenceSha256: notice.diagnosticSetSha256,
    blockerIds: notice.diagnostics
      .filter((diagnostic) => diagnostic.severity === "blocker")
      .map((diagnostic) => diagnostic.ruleId),
    guidance: [],
    correctable: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import type {
ModelAdvisorDiagnostic,
ModelAdvisorNoticePayload,
ModelAdvisorRuleId,
} from "@napier/contracts";
import { canonicalJson,sha256 } from "./ed25519.js";

const TEST_VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:tests?|test suite)\b.{0,40}\b(?:passed|pass|green|succeeded|successful|clean)\b/iu,
  /\b(?:passed|green|succeeded|successful|clean)\b.{0,40}\b(?:tests?|test suite)\b/iu,
  /测试.{0,16}(?:通过|成功|全绿)/u,
];
const NON_TEST_VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:typecheck|type-check|build|lint|checks?|verification|verify_workspace)\b.{0,40}\b(?:passed|pass|green|succeeded|successful|clean)\b/iu,
  /\b(?:passed|green|succeeded|successful|clean)\b.{0,40}\b(?:typecheck|type-check|build|lint|checks?|verification|verify_workspace)\b/iu,
  /(?:构建|类型检查|检查|校验).{0,16}(?:通过|成功|全绿)/u,
];
const PLAN_COMPLETION_CLAIM_PATTERNS = [
  /\b(?:execution\s+plan|durable\s+plan|plan|workflow)\b.{0,40}\b(?:completed|complete|done|settled|finished)\b/iu,
  /\b(?:completed|complete|done|settled|finished)\b.{0,40}\b(?:execution\s+plan|durable\s+plan|plan|workflow)\b/iu,
  /(?:执行计划|计划|工作流).{0,18}(?:完成|已完成|结清|已结清|闭环)/u,
];
const ARTIFACT_VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:artifact|artifacts|deliverable|deliverables|output|outputs|report|file)\b.{0,48}\b(?:verified|validated|hashed|hash-bound|produced\s+and\s+verified)\b/iu,
  /\b(?:verified|validated|hashed|hash-bound)\b.{0,48}\b(?:artifact|artifacts|deliverable|deliverables|output|outputs|report|file)\b/iu,
  /(?:产物|交付物|输出|报告|文件).{0,18}(?:验证|已验证|校验|已校验|哈希|已哈希)/u,
];
const GOAL_COMPLETION_CLAIM_PATTERNS = [
  /\b(?:goal|objective)\b.{0,32}\b(?:is|was|has been|now)\s+(?:complete|completed|satisfied|met|achieved|done)\b/iu,
  /\b(?:completed|satisfied|met|achieved)\b.{0,32}\b(?:goal|objective)\b/iu,
  /(?:目标|任务目标).{0,18}(?:完成|已完成|满足|已满足|达成|已达成)/u,
];
const RECOVERY_COMPLETION_CLAIM_PATTERNS = [
  /\b(?:recovery|recover|restoration|resume|resumption)\b.{0,40}\b(?:completed|complete|done|succeeded|successful|finished)\b/iu,
  /\b(?:completed|complete|done|succeeded|successful|finished)\b.{0,40}\b(?:recovery|recover|restoration|resume|resumption)\b/iu,
  /\b(?:recovered|resumed)\s+(?:successfully|cleanly)\b/iu,
  /(?:恢复|自动恢复|故障恢复).{0,18}(?:完成|已完成|成功|已成功|闭环)/u,
];
const EVALUATION_COMPLETION_CLAIM_PATTERNS = [
  /\b(?:evaluation|evaluations|eval|evals|benchmark|benchmarks|assessment|assessments)\b.{0,40}\b(?:completed|complete|done|finished|settled)\b/iu,
  /\b(?:completed|complete|done|finished|settled)\b.{0,40}\b(?:evaluation|evaluations|eval|evals|benchmark|benchmarks|assessment|assessments)\b/iu,
  /(?:评测|评估|基准测试).{0,18}(?:完成|已完成|结清|已结清|闭环)/u,
];
const EVALUATION_PASS_CLAIM_PATTERNS = [
  /\b(?:evaluation|evaluations|eval|evals|benchmark|benchmarks|assessment|assessments|suite|qualification|gate)\b.{0,40}\b(?:passed|green|qualified|succeeded|successful)\b/iu,
  /\b(?:passed|green|qualified|succeeded|successful)\b.{0,40}\b(?:evaluation|evaluations|eval|evals|benchmark|benchmarks|assessment|assessments|suite|qualification|gate)\b/iu,
  /(?:评测|评估|基准测试|套件|资格赛|门禁).{0,18}(?:通过|已通过|成功|全绿|合格)/u,
];
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\bgit\s+reset\s+--hard\b/iu,
  /\bgit\s+checkout\s+--\s+\S+/iu,
  /\brm\s+-rf\s+(?:\/|~|\.)/iu,
  /\bsudo\s+rm\s+-rf\b/iu,
  /\bmkfs(?:\.[a-z0-9]+)?\s+/iu,
  /\bdiskutil\s+erase\w*\b/iu,
];

export function createVerificationClaimDiagnostic(
  assistantText: string,
  evidence: ModelAdvisorNoticePayload["evidence"],
  writeLinkedTestsPassedAfterWorkspaceWrite: boolean,
): ModelAdvisorDiagnostic | undefined {
  const testVerificationClaimCount = countPatternHits(
    assistantText,
    TEST_VERIFICATION_CLAIM_PATTERNS,
  );
  const nonTestVerificationClaimCount = countPatternHits(
    assistantText,
    NON_TEST_VERIFICATION_CLAIM_PATTERNS,
  );
  const verificationClaimCount =
    testVerificationClaimCount + nonTestVerificationClaimCount;
  const planCompletionClaimCount = countPatternHits(
    assistantText,
    PLAN_COMPLETION_CLAIM_PATTERNS,
  );
  const artifactVerificationClaimCount = countPatternHits(
    assistantText,
    ARTIFACT_VERIFICATION_CLAIM_PATTERNS,
  );
  const goalCompletionClaimCount = countPatternHits(
    assistantText,
    GOAL_COMPLETION_CLAIM_PATTERNS,
  );
  const recoveryCompletionClaimCount = countPatternHits(
    assistantText,
    RECOVERY_COMPLETION_CLAIM_PATTERNS,
  );
  const evaluationCompletionClaimCount = countPatternHits(
    assistantText,
    EVALUATION_COMPLETION_CLAIM_PATTERNS,
  );
  const evaluationPassClaimCount = countPatternHits(
    assistantText,
    EVALUATION_PASS_CLAIM_PATTERNS,
  );
  const unsupportedTestVerificationClaimCount =
    evidence.verificationToolPassedAfterWorkspaceWrite ||
    writeLinkedTestsPassedAfterWorkspaceWrite
      ? 0
      : testVerificationClaimCount;
  const unsupportedNonTestVerificationClaimCount =
    evidence.verificationToolPassedAfterWorkspaceWrite
      ? 0
      : nonTestVerificationClaimCount;
  const unsupportedVerificationClaimCount =
    unsupportedTestVerificationClaimCount +
    unsupportedNonTestVerificationClaimCount;
  const unsupportedPlanCompletionClaimCount =
    evidence.planCompletedAfterWorkspaceWrite ? 0 : planCompletionClaimCount;
  const unsupportedArtifactVerificationClaimCount =
    evidence.planArtifactVerifiedAfterWorkspaceWrite
      ? 0
      : artifactVerificationClaimCount;
  const unsupportedGoalCompletionClaimCount =
    evidence.goalSatisfiedAfterWorkspaceWrite ? 0 : goalCompletionClaimCount;
  const unsupportedRecoveryCompletionClaimCount =
    evidence.recoveryCompletedAfterInterruption
      ? 0
      : recoveryCompletionClaimCount;
  const unsupportedEvaluationCompletionClaimCount =
    evidence.evaluationCompletedAfterWorkspaceWrite
      ? 0
      : evaluationCompletionClaimCount;
  const unsupportedEvaluationPassClaimCount =
    evidence.evaluationPassedAfterWorkspaceWrite ? 0 : evaluationPassClaimCount;
  const matchCount =
    unsupportedVerificationClaimCount +
    unsupportedPlanCompletionClaimCount +
    unsupportedArtifactVerificationClaimCount +
    unsupportedGoalCompletionClaimCount +
    unsupportedRecoveryCompletionClaimCount +
    unsupportedEvaluationCompletionClaimCount +
    unsupportedEvaluationPassClaimCount;
  if (matchCount === 0) {
    return undefined;
  }
  return createDiagnostic(
    "unverified_verification_claim",
    "warning",
    matchCount,
    {
      matchCount,
      verificationClaimCount,
      testVerificationClaimCount,
      nonTestVerificationClaimCount,
      planCompletionClaimCount,
      artifactVerificationClaimCount,
      goalCompletionClaimCount,
      recoveryCompletionClaimCount,
      evaluationCompletionClaimCount,
      evaluationPassClaimCount,
      unsupportedVerificationClaimCount,
      unsupportedTestVerificationClaimCount,
      unsupportedNonTestVerificationClaimCount,
      unsupportedPlanCompletionClaimCount,
      unsupportedArtifactVerificationClaimCount,
      unsupportedGoalCompletionClaimCount,
      unsupportedRecoveryCompletionClaimCount,
      unsupportedEvaluationCompletionClaimCount,
      unsupportedEvaluationPassClaimCount,
      verificationToolCompleted: evidence.verificationToolCompleted,
      verificationToolPassed: evidence.verificationToolPassed,
      workspaceWriteCompleted: evidence.workspaceWriteCompleted,
      verificationToolPassedAfterWorkspaceWrite:
        evidence.verificationToolPassedAfterWorkspaceWrite,
      planCompleted: evidence.planCompleted,
      planArtifactVerified: evidence.planArtifactVerified,
      goalSatisfied: evidence.goalSatisfied,
      recoveryCompleted: evidence.recoveryCompleted,
      evaluationCompleted: evidence.evaluationCompleted,
      evaluationPassed: evidence.evaluationPassed,
      planCompletedAfterWorkspaceWrite:
        evidence.planCompletedAfterWorkspaceWrite,
      planArtifactVerifiedAfterWorkspaceWrite:
        evidence.planArtifactVerifiedAfterWorkspaceWrite,
      goalSatisfiedAfterWorkspaceWrite:
        evidence.goalSatisfiedAfterWorkspaceWrite,
      recoveryCompletedAfterInterruption:
        evidence.recoveryCompletedAfterInterruption,
      evaluationCompletedAfterWorkspaceWrite:
        evidence.evaluationCompletedAfterWorkspaceWrite,
      evaluationPassedAfterWorkspaceWrite:
        evidence.evaluationPassedAfterWorkspaceWrite,
      latestWorkspaceWriteSeq: evidence.latestWorkspaceWriteSeq,
      latestPassedVerificationSeq: evidence.latestPassedVerificationSeq,
      latestPlanCompletedSeq: evidence.latestPlanCompletedSeq,
      latestPlanInvalidatedSeq: evidence.latestPlanInvalidatedSeq,
      latestPlanArtifactVerifiedSeq: evidence.latestPlanArtifactVerifiedSeq,
      latestPlanArtifactInvalidatedSeq:
        evidence.latestPlanArtifactInvalidatedSeq,
      latestGoalSatisfiedSeq: evidence.latestGoalSatisfiedSeq,
      latestGoalInvalidatedSeq: evidence.latestGoalInvalidatedSeq,
      latestRecoveryCompletedSeq: evidence.latestRecoveryCompletedSeq,
      latestRunInterruptedSeq: evidence.latestRunInterruptedSeq,
      latestRecoveryInvalidatedSeq: evidence.latestRecoveryInvalidatedSeq,
      latestEvaluationCompletedSeq: evidence.latestEvaluationCompletedSeq,
      latestEvaluationPassedSeq: evidence.latestEvaluationPassedSeq,
      latestEvaluationPassInvalidatedSeq:
        evidence.latestEvaluationPassInvalidatedSeq,
      toolCompletedCount: evidence.toolCompletedCount,
    },
  );
}

export function createDestructiveCommandDiagnostic(
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

export function createDiagnostic(
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

export function countPatternHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
}

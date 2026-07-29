import type { RunEvent } from "@napier/contracts";

export interface ModelAdvisorEventTraceView {
  action: string;
  status?: string;
  source?: string;
  turnSource?: string;
  verdict?: string;
  risk?: string;
  score?: number;
  diagnosticCount?: number;
  issueCount?: number;
  blockerCount?: number;
  attempt?: number;
  maxAttempts?: number;
  verificationToolCompleted?: boolean;
  verificationToolPassed?: boolean;
  workspaceWriteCompleted?: boolean;
  verificationToolPassedAfterWorkspaceWrite?: boolean;
  planCompleted?: boolean;
  planArtifactVerified?: boolean;
  goalSatisfied?: boolean;
  recoveryCompleted?: boolean;
  evaluationCompleted?: boolean;
  evaluationPassed?: boolean;
  planCompletedAfterWorkspaceWrite?: boolean;
  planArtifactVerifiedAfterWorkspaceWrite?: boolean;
  goalSatisfiedAfterWorkspaceWrite?: boolean;
  recoveryCompletedAfterInterruption?: boolean;
  evaluationCompletedAfterWorkspaceWrite?: boolean;
  evaluationPassedAfterWorkspaceWrite?: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
  latestPlanCompletedSeq?: number;
  latestPlanInvalidatedSeq?: number;
  latestPlanArtifactVerifiedSeq?: number;
  latestPlanArtifactInvalidatedSeq?: number;
  latestGoalSatisfiedSeq?: number;
  latestGoalInvalidatedSeq?: number;
  latestRecoveryCompletedSeq?: number;
  latestRunInterruptedSeq?: number;
  latestRecoveryInvalidatedSeq?: number;
  latestEvaluationCompletedSeq?: number;
  latestEvaluationPassedSeq?: number;
  latestEvaluationPassInvalidatedSeq?: number;
  textSha256?: string;
  candidateTextSha256?: string;
  diagnosticSetSha256?: string;
  issueSetSha256?: string;
  evidenceSha256?: string;
  inputSha256?: string;
  promptSha256?: string;
  responseSha256?: string;
  requestContentSha256?: string;
  responseTextSha256?: string;
  contentSha256?: string;
  envelopeSha256?: string;
}

const MODEL_ADVISOR_EVENT =
  /^model\.advisor\.(notice|blocked|independent\.reviewed|correction\.(requested|outcome))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MODEL_ADVISOR_RECEIPT_SUMMARY = "model advisor receipt";

export function modelAdvisorEventTraceView(
  event: RunEvent,
): ModelAdvisorEventTraceView | undefined {
  if (!MODEL_ADVISOR_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const modelContextEnvelope = record(event.payload["modelContextEnvelope"])
    ? event.payload["modelContextEnvelope"]
    : {};
  const evidence = record(event.payload["evidence"])
    ? event.payload["evidence"]
    : record(event.payload["evidenceSummary"])
      ? event.payload["evidenceSummary"]
      : {};
  const diagnostics = Array.isArray(event.payload["diagnostics"])
    ? event.payload["diagnostics"]
    : undefined;
  const diagnosticCodes = Array.isArray(event.payload["diagnosticCodes"])
    ? event.payload["diagnosticCodes"]
    : undefined;
  const issues = Array.isArray(event.payload["issues"])
    ? event.payload["issues"]
    : undefined;
  const blockerRuleIds = Array.isArray(event.payload["blockerRuleIds"])
    ? event.payload["blockerRuleIds"]
    : undefined;
  const status = safeToken(event.payload["status"]);
  const source = safeToken(event.payload["source"]);
  const turnSource = safeToken(event.payload["turnSource"]);
  const verdict = safeToken(event.payload["verdict"]);
  const risk = safeToken(event.payload["risk"]);
  const score = nonNegativeInteger(event.payload["score"]);
  const attempt = nonNegativeInteger(event.payload["attempt"]);
  const maxAttempts = nonNegativeInteger(event.payload["maxAttempts"]);
  const verificationToolCompleted = booleanValue(
    evidence["verificationToolCompleted"],
  );
  const verificationToolPassed = booleanValue(
    evidence["verificationToolPassed"],
  );
  const workspaceWriteCompleted = booleanValue(
    evidence["workspaceWriteCompleted"],
  );
  const verificationToolPassedAfterWorkspaceWrite = booleanValue(
    evidence["verificationToolPassedAfterWorkspaceWrite"],
  );
  const planCompleted = booleanValue(evidence["planCompleted"]);
  const planArtifactVerified = booleanValue(evidence["planArtifactVerified"]);
  const goalSatisfied = booleanValue(evidence["goalSatisfied"]);
  const recoveryCompleted = booleanValue(evidence["recoveryCompleted"]);
  const evaluationCompleted = booleanValue(evidence["evaluationCompleted"]);
  const evaluationPassed = booleanValue(evidence["evaluationPassed"]);
  const planCompletedAfterWorkspaceWrite = booleanValue(
    evidence["planCompletedAfterWorkspaceWrite"],
  );
  const planArtifactVerifiedAfterWorkspaceWrite = booleanValue(
    evidence["planArtifactVerifiedAfterWorkspaceWrite"],
  );
  const goalSatisfiedAfterWorkspaceWrite = booleanValue(
    evidence["goalSatisfiedAfterWorkspaceWrite"],
  );
  const recoveryCompletedAfterInterruption = booleanValue(
    evidence["recoveryCompletedAfterInterruption"],
  );
  const evaluationCompletedAfterWorkspaceWrite = booleanValue(
    evidence["evaluationCompletedAfterWorkspaceWrite"],
  );
  const evaluationPassedAfterWorkspaceWrite = booleanValue(
    evidence["evaluationPassedAfterWorkspaceWrite"],
  );
  const latestWorkspaceWriteSeq = nonNegativeInteger(
    evidence["latestWorkspaceWriteSeq"],
  );
  const latestPassedVerificationSeq = nonNegativeInteger(
    evidence["latestPassedVerificationSeq"],
  );
  const latestPlanCompletedSeq = nonNegativeInteger(
    evidence["latestPlanCompletedSeq"],
  );
  const latestPlanInvalidatedSeq = nonNegativeInteger(
    evidence["latestPlanInvalidatedSeq"],
  );
  const latestPlanArtifactVerifiedSeq = nonNegativeInteger(
    evidence["latestPlanArtifactVerifiedSeq"],
  );
  const latestPlanArtifactInvalidatedSeq = nonNegativeInteger(
    evidence["latestPlanArtifactInvalidatedSeq"],
  );
  const latestGoalSatisfiedSeq = nonNegativeInteger(
    evidence["latestGoalSatisfiedSeq"],
  );
  const latestGoalInvalidatedSeq = nonNegativeInteger(
    evidence["latestGoalInvalidatedSeq"],
  );
  const latestRecoveryCompletedSeq = nonNegativeInteger(
    evidence["latestRecoveryCompletedSeq"],
  );
  const latestRunInterruptedSeq = nonNegativeInteger(
    evidence["latestRunInterruptedSeq"],
  );
  const latestRecoveryInvalidatedSeq = nonNegativeInteger(
    evidence["latestRecoveryInvalidatedSeq"],
  );
  const latestEvaluationCompletedSeq = nonNegativeInteger(
    evidence["latestEvaluationCompletedSeq"],
  );
  const latestEvaluationPassedSeq = nonNegativeInteger(
    evidence["latestEvaluationPassedSeq"],
  );
  const latestEvaluationPassInvalidatedSeq = nonNegativeInteger(
    evidence["latestEvaluationPassInvalidatedSeq"],
  );
  const textSha256 = sha256(event.payload["textSha256"]);
  const candidateTextSha256 = sha256(event.payload["candidateTextSha256"]);
  const diagnosticSetSha256 = sha256(event.payload["diagnosticSetSha256"]);
  const issueSetSha256 = sha256(event.payload["issueSetSha256"]);
  const evidenceSha256 = sha256(event.payload["evidenceSha256"]);
  const inputSha256 = sha256(event.payload["inputSha256"]);
  const promptSha256 = sha256(event.payload["promptSha256"]);
  const responseSha256 = sha256(event.payload["responseSha256"]);
  const requestContentSha256 = sha256(event.payload["requestContentSha256"]);
  const responseTextSha256 = sha256(event.payload["responseTextSha256"]);
  const contentSha256 = sha256(event.payload["contentSha256"]);
  const envelopeSha256 = sha256(modelContextEnvelope["contentSha256"]);
  const diagnosticCount =
    nonNegativeInteger(event.payload["diagnosticCount"]) ??
    (diagnostics ? diagnostics.length : undefined) ??
    (diagnosticCodes ? diagnosticCodes.length : undefined);
  const issueCount = issues ? issues.length : undefined;
  const blockerCount = blockerRuleIds ? blockerRuleIds.length : undefined;
  return {
    action: event.type.slice("model.advisor.".length),
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(turnSource ? { turnSource } : {}),
    ...(verdict ? { verdict } : {}),
    ...(risk ? { risk } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(diagnosticCount !== undefined ? { diagnosticCount } : {}),
    ...(issueCount !== undefined ? { issueCount } : {}),
    ...(blockerCount !== undefined ? { blockerCount } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(candidateTextSha256 ? { candidateTextSha256 } : {}),
    ...(verificationToolCompleted !== undefined
      ? { verificationToolCompleted }
      : {}),
    ...(verificationToolPassed !== undefined ? { verificationToolPassed } : {}),
    ...(workspaceWriteCompleted !== undefined
      ? { workspaceWriteCompleted }
      : {}),
    ...(verificationToolPassedAfterWorkspaceWrite !== undefined
      ? { verificationToolPassedAfterWorkspaceWrite }
      : {}),
    ...(planCompleted !== undefined ? { planCompleted } : {}),
    ...(planArtifactVerified !== undefined ? { planArtifactVerified } : {}),
    ...(goalSatisfied !== undefined ? { goalSatisfied } : {}),
    ...(recoveryCompleted !== undefined ? { recoveryCompleted } : {}),
    ...(evaluationCompleted !== undefined ? { evaluationCompleted } : {}),
    ...(evaluationPassed !== undefined ? { evaluationPassed } : {}),
    ...(planCompletedAfterWorkspaceWrite !== undefined
      ? { planCompletedAfterWorkspaceWrite }
      : {}),
    ...(planArtifactVerifiedAfterWorkspaceWrite !== undefined
      ? { planArtifactVerifiedAfterWorkspaceWrite }
      : {}),
    ...(goalSatisfiedAfterWorkspaceWrite !== undefined
      ? { goalSatisfiedAfterWorkspaceWrite }
      : {}),
    ...(recoveryCompletedAfterInterruption !== undefined
      ? { recoveryCompletedAfterInterruption }
      : {}),
    ...(evaluationCompletedAfterWorkspaceWrite !== undefined
      ? { evaluationCompletedAfterWorkspaceWrite }
      : {}),
    ...(evaluationPassedAfterWorkspaceWrite !== undefined
      ? { evaluationPassedAfterWorkspaceWrite }
      : {}),
    ...(latestWorkspaceWriteSeq !== undefined
      ? { latestWorkspaceWriteSeq }
      : {}),
    ...(latestPassedVerificationSeq !== undefined
      ? { latestPassedVerificationSeq }
      : {}),
    ...(latestPlanCompletedSeq !== undefined ? { latestPlanCompletedSeq } : {}),
    ...(latestPlanInvalidatedSeq !== undefined
      ? { latestPlanInvalidatedSeq }
      : {}),
    ...(latestPlanArtifactVerifiedSeq !== undefined
      ? { latestPlanArtifactVerifiedSeq }
      : {}),
    ...(latestPlanArtifactInvalidatedSeq !== undefined
      ? { latestPlanArtifactInvalidatedSeq }
      : {}),
    ...(latestGoalSatisfiedSeq !== undefined ? { latestGoalSatisfiedSeq } : {}),
    ...(latestGoalInvalidatedSeq !== undefined
      ? { latestGoalInvalidatedSeq }
      : {}),
    ...(latestRecoveryCompletedSeq !== undefined
      ? { latestRecoveryCompletedSeq }
      : {}),
    ...(latestRunInterruptedSeq !== undefined ? { latestRunInterruptedSeq } : {}),
    ...(latestRecoveryInvalidatedSeq !== undefined
      ? { latestRecoveryInvalidatedSeq }
      : {}),
    ...(latestEvaluationCompletedSeq !== undefined
      ? { latestEvaluationCompletedSeq }
      : {}),
    ...(latestEvaluationPassedSeq !== undefined
      ? { latestEvaluationPassedSeq }
      : {}),
    ...(latestEvaluationPassInvalidatedSeq !== undefined
      ? { latestEvaluationPassInvalidatedSeq }
      : {}),
    ...(diagnosticSetSha256 ? { diagnosticSetSha256 } : {}),
    ...(issueSetSha256 ? { issueSetSha256 } : {}),
    ...(evidenceSha256 ? { evidenceSha256 } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(promptSha256 ? { promptSha256 } : {}),
    ...(responseSha256 ? { responseSha256 } : {}),
    ...(requestContentSha256 ? { requestContentSha256 } : {}),
    ...(responseTextSha256 ? { responseTextSha256 } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
    ...(envelopeSha256 ? { envelopeSha256 } : {}),
  };
}

export function modelAdvisorEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!MODEL_ADVISOR_EVENT.test(event.type)) return undefined;
  const view = modelAdvisorEventTraceView(event);
  if (!view) return MODEL_ADVISOR_RECEIPT_SUMMARY;
  return [
    `advisor / ${view.action}`,
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.source ? [`source ${view.source}`] : []),
    ...(view.turnSource ? [`turn ${view.turnSource}`] : []),
    ...(view.verdict ? [`verdict ${view.verdict}`] : []),
    ...(view.risk ? [`risk ${view.risk}`] : []),
    ...(view.score !== undefined ? [`score ${view.score}`] : []),
    ...(view.diagnosticCount !== undefined
      ? [`diagnostics ${view.diagnosticCount}`]
      : []),
    ...(view.issueCount !== undefined ? [`issues ${view.issueCount}`] : []),
    ...(view.blockerCount !== undefined
      ? [`blockers ${view.blockerCount}`]
      : []),
    ...(view.attempt !== undefined
      ? [
          `attempt ${view.attempt}${
            view.maxAttempts !== undefined ? `/${view.maxAttempts}` : ""
          }`,
        ]
      : view.maxAttempts !== undefined
        ? [`max-attempts ${view.maxAttempts}`]
        : []),
    ...(view.verificationToolCompleted !== undefined
      ? [
          view.verificationToolCompleted
            ? "verification completed"
            : "verification missing",
        ]
      : []),
    ...(view.verificationToolPassed !== undefined
      ? [
          view.verificationToolPassed
            ? "verification passed"
            : "verification not-passed",
        ]
      : []),
    ...(view.workspaceWriteCompleted ? ["workspace-write"] : []),
    ...(view.latestWorkspaceWriteSeq !== undefined
      ? [`workspace-write-seq ${view.latestWorkspaceWriteSeq}`]
      : []),
    ...(view.latestPassedVerificationSeq !== undefined
      ? [`passed-verification-seq ${view.latestPassedVerificationSeq}`]
      : []),
    ...(view.verificationToolPassedAfterWorkspaceWrite !== undefined
      ? [
          view.verificationToolPassedAfterWorkspaceWrite
            ? "verification-current"
            : view.verificationToolPassed && view.workspaceWriteCompleted
              ? "verification-stale"
              : "verification-not-current",
        ]
      : []),
    ...(view.planCompleted !== undefined
      ? [view.planCompleted ? "plan-completed" : "plan-not-completed"]
      : []),
    ...(view.latestPlanCompletedSeq !== undefined
      ? [`plan-completed-seq ${view.latestPlanCompletedSeq}`]
      : []),
    ...(view.latestPlanInvalidatedSeq !== undefined
      ? [`plan-invalidated-seq ${view.latestPlanInvalidatedSeq}`]
      : []),
    ...(view.planCompletedAfterWorkspaceWrite !== undefined
      ? [
          view.planCompletedAfterWorkspaceWrite
            ? "plan-completion-current"
            : view.planCompleted &&
                (view.workspaceWriteCompleted ||
                  view.latestPlanInvalidatedSeq !== undefined)
              ? "plan-completion-stale"
              : "plan-completion-not-current",
        ]
      : []),
    ...(view.planArtifactVerified !== undefined
      ? [
          view.planArtifactVerified
            ? "artifact-verified"
            : "artifact-not-verified",
        ]
      : []),
    ...(view.latestPlanArtifactVerifiedSeq !== undefined
      ? [`artifact-verified-seq ${view.latestPlanArtifactVerifiedSeq}`]
      : []),
    ...(view.latestPlanArtifactInvalidatedSeq !== undefined
      ? [`artifact-invalidated-seq ${view.latestPlanArtifactInvalidatedSeq}`]
      : []),
    ...(view.planArtifactVerifiedAfterWorkspaceWrite !== undefined
      ? [
          view.planArtifactVerifiedAfterWorkspaceWrite
            ? "artifact-verification-current"
            : view.planArtifactVerified &&
                (view.workspaceWriteCompleted ||
                  view.latestPlanArtifactInvalidatedSeq !== undefined)
              ? "artifact-verification-stale"
              : "artifact-verification-not-current",
        ]
      : []),
    ...(view.goalSatisfied !== undefined
      ? [view.goalSatisfied ? "goal-satisfied" : "goal-not-satisfied"]
      : []),
    ...(view.latestGoalSatisfiedSeq !== undefined
      ? [`goal-satisfied-seq ${view.latestGoalSatisfiedSeq}`]
      : []),
    ...(view.latestGoalInvalidatedSeq !== undefined
      ? [`goal-invalidated-seq ${view.latestGoalInvalidatedSeq}`]
      : []),
    ...(view.goalSatisfiedAfterWorkspaceWrite !== undefined
      ? [
          view.goalSatisfiedAfterWorkspaceWrite
            ? "goal-satisfaction-current"
            : view.goalSatisfied &&
                (view.workspaceWriteCompleted ||
                  view.latestGoalInvalidatedSeq !== undefined)
              ? "goal-satisfaction-stale"
              : "goal-satisfaction-not-current",
        ]
      : []),
    ...(view.recoveryCompleted !== undefined
      ? [
          view.recoveryCompleted
            ? "recovery-completed"
            : "recovery-not-completed",
        ]
      : []),
    ...(view.latestRecoveryCompletedSeq !== undefined
      ? [`recovery-completed-seq ${view.latestRecoveryCompletedSeq}`]
      : []),
    ...(view.latestRunInterruptedSeq !== undefined
      ? [`run-interrupted-seq ${view.latestRunInterruptedSeq}`]
      : []),
    ...(view.latestRecoveryInvalidatedSeq !== undefined
      ? [`recovery-invalidated-seq ${view.latestRecoveryInvalidatedSeq}`]
      : []),
    ...(view.recoveryCompletedAfterInterruption !== undefined
      ? [
          view.recoveryCompletedAfterInterruption
            ? "recovery-completion-current"
            : view.recoveryCompleted &&
                (view.latestRunInterruptedSeq !== undefined ||
                  view.latestRecoveryInvalidatedSeq !== undefined)
              ? "recovery-completion-stale"
              : "recovery-completion-not-current",
        ]
      : []),
    ...(view.evaluationCompleted !== undefined
      ? [
          view.evaluationCompleted
            ? "evaluation-completed"
            : "evaluation-not-completed",
        ]
      : []),
    ...(view.latestEvaluationCompletedSeq !== undefined
      ? [`evaluation-completed-seq ${view.latestEvaluationCompletedSeq}`]
      : []),
    ...(view.evaluationCompletedAfterWorkspaceWrite !== undefined
      ? [
          view.evaluationCompletedAfterWorkspaceWrite
            ? "evaluation-completion-current"
            : view.evaluationCompleted && view.workspaceWriteCompleted
              ? "evaluation-completion-stale"
              : "evaluation-completion-not-current",
        ]
      : []),
    ...(view.evaluationPassed !== undefined
      ? [view.evaluationPassed ? "evaluation-passed" : "evaluation-not-passed"]
      : []),
    ...(view.latestEvaluationPassedSeq !== undefined
      ? [`evaluation-passed-seq ${view.latestEvaluationPassedSeq}`]
      : []),
    ...(view.latestEvaluationPassInvalidatedSeq !== undefined
      ? [
          `evaluation-pass-invalidated-seq ${view.latestEvaluationPassInvalidatedSeq}`,
        ]
      : []),
    ...(view.evaluationPassedAfterWorkspaceWrite !== undefined
      ? [
          view.evaluationPassedAfterWorkspaceWrite
            ? "evaluation-pass-current"
            : view.evaluationPassed &&
                (view.workspaceWriteCompleted ||
                  view.latestEvaluationPassInvalidatedSeq !== undefined)
              ? "evaluation-pass-stale"
              : "evaluation-pass-not-current",
        ]
      : []),
    ...(view.textSha256 ? [`text ${view.textSha256.slice(0, 12)}`] : []),
    ...(view.candidateTextSha256
      ? [`candidate ${view.candidateTextSha256.slice(0, 12)}`]
      : []),
    ...(view.diagnosticSetSha256
      ? [`diagnostics ${view.diagnosticSetSha256.slice(0, 12)}`]
      : []),
    ...(view.issueSetSha256
      ? [`issue-set ${view.issueSetSha256.slice(0, 12)}`]
      : []),
    ...(view.evidenceSha256
      ? [`evidence ${view.evidenceSha256.slice(0, 12)}`]
      : []),
    ...(view.inputSha256 ? [`input ${view.inputSha256.slice(0, 12)}`] : []),
    ...(view.promptSha256 ? [`prompt ${view.promptSha256.slice(0, 12)}`] : []),
    ...(view.responseSha256
      ? [`response ${view.responseSha256.slice(0, 12)}`]
      : []),
    ...(view.requestContentSha256
      ? [`request ${view.requestContentSha256.slice(0, 12)}`]
      : []),
    ...(view.responseTextSha256
      ? [`response-text ${view.responseTextSha256.slice(0, 12)}`]
      : []),
    ...(view.envelopeSha256
      ? [`envelope ${view.envelopeSha256.slice(0, 12)}`]
      : []),
    ...(view.contentSha256
      ? [`receipt ${view.contentSha256.slice(0, 12)}`]
      : []),
  ].join(" / ");
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

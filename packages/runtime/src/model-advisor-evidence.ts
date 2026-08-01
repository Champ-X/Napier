import type { RunEvent } from "@napier/contracts";

export interface ModelAdvisorVerificationEvidence {
  verificationToolCompleted: boolean;
  verificationToolPassed: boolean;
  workspaceWriteCompleted: boolean;
  verificationToolPassedAfterWorkspaceWrite: boolean;
  planCompleted: boolean;
  planArtifactVerified: boolean;
  goalSatisfied: boolean;
  recoveryCompleted: boolean;
  evaluationCompleted: boolean;
  evaluationPassed: boolean;
  planCompletedAfterWorkspaceWrite: boolean;
  planArtifactVerifiedAfterWorkspaceWrite: boolean;
  goalSatisfiedAfterWorkspaceWrite: boolean;
  recoveryCompletedAfterInterruption: boolean;
  evaluationCompletedAfterWorkspaceWrite: boolean;
  evaluationPassedAfterWorkspaceWrite: boolean;
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
}

export function isVerifyWorkspaceCompletion(event: RunEvent): boolean {
  return (
    event.type === "tool.completed" &&
    isRecord(event.payload) &&
    event.payload["toolName"] === "verify_workspace"
  );
}

export function isPassedVerifyWorkspaceCompletion(event: RunEvent): boolean {
  if (!isVerifyWorkspaceCompletion(event) || !isRecord(event.payload)) {
    return false;
  }
  const details = event.payload["details"];
  return isRecord(details) && details["status"] === "passed";
}

export function hasPassedWriteLinkedTestsAfterWorkspaceWrite(
  events: RunEvent[],
): boolean {
  const latestWriteSeq = latestSeq(events, isWorkspaceWriteCompletion);
  const latestPassedTestsSeq = latestSeq(
    events,
    isPassedWriteLinkedTestCompletion,
  );
  return (
    latestPassedTestsSeq !== undefined &&
    (latestWriteSeq === undefined || latestPassedTestsSeq >= latestWriteSeq)
  );
}

export function isWorkspaceWriteCompletion(event: RunEvent): boolean {
  if (
    event.type !== "tool.completed" ||
    !isRecord(event.payload) ||
    event.payload["status"] !== "completed"
  ) {
    return false;
  }
  return (
    event.payload["toolName"] === "apply_patch" ||
    event.payload["toolName"] === "lsp_rename_apply" ||
    event.payload["toolName"] === "lsp_code_action_apply" ||
    event.payload["toolName"] === "workspace_file_apply"
  );
}

export function isPlanCompletionEvent(event: RunEvent): boolean {
  if (
    !event.type.startsWith("plan.step.") ||
    !isRecord(event.payload) ||
    event.payload["planStatus"] !== "completed"
  ) {
    return false;
  }
  return event.category === "plan";
}

export function isPlanCompletionInvalidationEvent(event: RunEvent): boolean {
  if (
    event.category !== "plan" ||
    !event.type.startsWith("plan.") ||
    !isRecord(event.payload)
  ) {
    return false;
  }
  if (isPlanCompletionEvent(event)) return false;
  const planStatus = event.payload["planStatus"];
  if (typeof planStatus === "string") {
    return planStatus !== "completed";
  }
  const status = event.payload["status"];
  if (typeof status === "string") {
    return status !== "completed" && status !== "verified";
  }
  return false;
}

export function isPlanArtifactVerificationEvent(event: RunEvent): boolean {
  return (
    event.type === "plan.artifact.verified" &&
    event.category === "plan" &&
    isRecord(event.payload) &&
    event.payload["status"] === "verified"
  );
}

export function isPlanArtifactInvalidationEvent(event: RunEvent): boolean {
  if (
    event.category !== "plan" ||
    !event.type.startsWith("plan.artifact.") ||
    event.type === "plan.artifact.verified" ||
    !isRecord(event.payload)
  ) {
    return false;
  }
  const status = event.payload["status"];
  return (
    status === "expected" ||
    status === "produced" ||
    status === "missing" ||
    status === "superseded"
  );
}

export function isGoalSatisfiedEvent(event: RunEvent): boolean {
  return (
    event.type === "goal.evaluated" &&
    event.category === "goal" &&
    isRecord(event.payload) &&
    event.payload["satisfied"] === true &&
    event.payload["status"] === "completed"
  );
}

export function isGoalInvalidationEvent(event: RunEvent): boolean {
  if (
    event.type !== "goal.evaluated" ||
    event.category !== "goal" ||
    !isRecord(event.payload)
  ) {
    return false;
  }
  return !(
    event.payload["satisfied"] === true &&
    event.payload["status"] === "completed"
  );
}

export function isRecoveryCompletionEvent(event: RunEvent): boolean {
  return (
    event.type === "run.recovery.completed" ||
    event.type === "run.recovery.auto.completed"
  );
}

export function isRunInterruptionEvent(event: RunEvent): boolean {
  return event.type === "run.interrupted";
}

export function isRecoveryInvalidationEvent(event: RunEvent): boolean {
  return (
    event.type === "run.recovery.started" ||
    event.type === "run.recovery.failed" ||
    event.type === "run.recovery.prompt" ||
    event.type === "run.recovery.auto.skipped" ||
    event.type === "run.recovery.auto.claimed" ||
    event.type === "run.recovery.auto.started" ||
    event.type === "run.recovery.auto.failed" ||
    event.type === "run.recovery.auto.interrupted" ||
    event.type === "run.recovery.auto.abandoned"
  );
}

export function isEvaluationCompletionEvent(event: RunEvent): boolean {
  return (
    event.type === "evaluation.completed" ||
    event.type === "evaluation.suite.completed" ||
    event.type === "evaluation.casebook.qualification.completed"
  );
}

export function isEvaluationPassEvent(event: RunEvent): boolean {
  if (!isRecord(event.payload)) return false;
  return (
    (event.type === "evaluation.suite.completed" ||
      event.type === "evaluation.casebook.qualification.completed") &&
    event.payload["status"] === "passed"
  );
}

export function isEvaluationPassInvalidationEvent(event: RunEvent): boolean {
  if (!isRecord(event.payload)) return false;
  if (
    (event.type === "evaluation.suite.completed" ||
      event.type === "evaluation.casebook.qualification.completed") &&
    event.payload["status"] !== "passed"
  ) {
    return true;
  }
  return (
    event.type === "evaluation.suite.updated" ||
    event.type === "evaluation.casebook.updated"
  );
}

export function createModelAdvisorVerificationEvidence(
  events: RunEvent[],
): ModelAdvisorVerificationEvidence {
  const latestWorkspaceWriteSeq = latestSeq(events, isWorkspaceWriteCompletion);
  const latestPassedVerificationSeq = latestSeq(
    events,
    isPassedVerifyWorkspaceCompletion,
  );
  const latestPlanCompletedSeq = latestSeq(events, isPlanCompletionEvent);
  const latestPlanInvalidatedSeq = latestSeq(
    events,
    isPlanCompletionInvalidationEvent,
  );
  const latestPlanArtifactVerifiedSeq = latestSeq(
    events,
    isPlanArtifactVerificationEvent,
  );
  const latestPlanArtifactInvalidatedSeq = latestSeq(
    events,
    isPlanArtifactInvalidationEvent,
  );
  const latestGoalSatisfiedSeq = latestSeq(events, isGoalSatisfiedEvent);
  const latestGoalInvalidatedSeq = latestSeq(events, isGoalInvalidationEvent);
  const latestRecoveryCompletedSeq = latestSeq(
    events,
    isRecoveryCompletionEvent,
  );
  const latestRunInterruptedSeq = latestSeq(events, isRunInterruptionEvent);
  const latestRecoveryInvalidatedSeq = latestSeq(
    events,
    isRecoveryInvalidationEvent,
  );
  const latestEvaluationCompletedSeq = latestSeq(
    events,
    isEvaluationCompletionEvent,
  );
  const latestEvaluationPassedSeq = latestSeq(events, isEvaluationPassEvent);
  const latestEvaluationPassInvalidatedSeq = latestSeq(
    events,
    isEvaluationPassInvalidationEvent,
  );
  const verificationToolPassedAfterWorkspaceWrite =
    latestPassedVerificationSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPassedVerificationSeq >= latestWorkspaceWriteSeq);
  const planCompletedAfterWorkspaceWrite =
    latestPlanCompletedSeq !== undefined &&
    (latestPlanInvalidatedSeq === undefined ||
      latestPlanCompletedSeq > latestPlanInvalidatedSeq) &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPlanCompletedSeq > latestWorkspaceWriteSeq);
  const planArtifactVerifiedAfterWorkspaceWrite =
    latestPlanArtifactVerifiedSeq !== undefined &&
    (latestPlanArtifactInvalidatedSeq === undefined ||
      latestPlanArtifactVerifiedSeq > latestPlanArtifactInvalidatedSeq) &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPlanArtifactVerifiedSeq > latestWorkspaceWriteSeq);
  const goalSatisfiedAfterWorkspaceWrite =
    latestGoalSatisfiedSeq !== undefined &&
    (latestGoalInvalidatedSeq === undefined ||
      latestGoalSatisfiedSeq > latestGoalInvalidatedSeq) &&
    (latestWorkspaceWriteSeq === undefined ||
      latestGoalSatisfiedSeq > latestWorkspaceWriteSeq);
  const recoveryCompletedAfterInterruption =
    latestRecoveryCompletedSeq !== undefined &&
    (latestRunInterruptedSeq === undefined ||
      latestRecoveryCompletedSeq > latestRunInterruptedSeq) &&
    (latestRecoveryInvalidatedSeq === undefined ||
      latestRecoveryCompletedSeq > latestRecoveryInvalidatedSeq);
  const evaluationCompletedAfterWorkspaceWrite =
    latestEvaluationCompletedSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestEvaluationCompletedSeq > latestWorkspaceWriteSeq);
  const evaluationPassedAfterWorkspaceWrite =
    latestEvaluationPassedSeq !== undefined &&
    (latestEvaluationPassInvalidatedSeq === undefined ||
      latestEvaluationPassedSeq > latestEvaluationPassInvalidatedSeq) &&
    (latestWorkspaceWriteSeq === undefined ||
      latestEvaluationPassedSeq > latestWorkspaceWriteSeq);
  return {
    verificationToolCompleted: events.some(isVerifyWorkspaceCompletion),
    verificationToolPassed: latestPassedVerificationSeq !== undefined,
    workspaceWriteCompleted: latestWorkspaceWriteSeq !== undefined,
    verificationToolPassedAfterWorkspaceWrite,
    planCompleted: latestPlanCompletedSeq !== undefined,
    planArtifactVerified: latestPlanArtifactVerifiedSeq !== undefined,
    goalSatisfied: latestGoalSatisfiedSeq !== undefined,
    recoveryCompleted: latestRecoveryCompletedSeq !== undefined,
    evaluationCompleted: latestEvaluationCompletedSeq !== undefined,
    evaluationPassed: latestEvaluationPassedSeq !== undefined,
    planCompletedAfterWorkspaceWrite,
    planArtifactVerifiedAfterWorkspaceWrite,
    goalSatisfiedAfterWorkspaceWrite,
    recoveryCompletedAfterInterruption,
    evaluationCompletedAfterWorkspaceWrite,
    evaluationPassedAfterWorkspaceWrite,
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
    ...(latestRunInterruptedSeq !== undefined
      ? { latestRunInterruptedSeq }
      : {}),
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
  };
}

export function isWriteLinkedTestCompletion(event: RunEvent): boolean {
  if (
    event.type !== "tool.completed" ||
    !isRecord(event.payload) ||
    (event.payload["toolName"] !== "apply_patch" &&
      event.payload["toolName"] !== "lsp_rename_apply" &&
      event.payload["toolName"] !== "lsp_code_action_apply")
  ) {
    return false;
  }
  const details = event.payload["details"];
  return isRecord(details) && isRecord(details["tests"]);
}

export function isPassedWriteLinkedTestCompletion(event: RunEvent): boolean {
  if (!isWriteLinkedTestCompletion(event) || !isRecord(event.payload)) {
    return false;
  }
  const details = event.payload["details"];
  if (!isRecord(details)) return false;
  const tests = details["tests"];
  return isRecord(tests) && tests["status"] === "passed";
}

function latestSeq(
  events: RunEvent[],
  predicate: (event: RunEvent) => boolean,
): number | undefined {
  let latest: number | undefined;
  for (const event of events) {
    if (!predicate(event)) continue;
    latest = latest === undefined || event.seq > latest ? event.seq : latest;
  }
  return latest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

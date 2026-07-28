import type { RunEvent } from "@napier/contracts";

export interface ModelAdvisorVerificationEvidence {
  verificationToolCompleted: boolean;
  verificationToolPassed: boolean;
  workspaceWriteCompleted: boolean;
  verificationToolPassedAfterWorkspaceWrite: boolean;
  planCompleted: boolean;
  planArtifactVerified: boolean;
  goalSatisfied: boolean;
  planCompletedAfterWorkspaceWrite: boolean;
  planArtifactVerifiedAfterWorkspaceWrite: boolean;
  goalSatisfiedAfterWorkspaceWrite: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
  latestPlanCompletedSeq?: number;
  latestPlanInvalidatedSeq?: number;
  latestPlanArtifactVerifiedSeq?: number;
  latestPlanArtifactInvalidatedSeq?: number;
  latestGoalSatisfiedSeq?: number;
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

export function isWorkspaceWriteCompletion(event: RunEvent): boolean {
  if (
    event.type !== "tool.completed" ||
    !isRecord(event.payload) ||
    event.payload["status"] !== "completed"
  ) {
    return false;
  }
  return event.payload["toolName"] === "apply_patch";
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
  const verificationToolPassedAfterWorkspaceWrite =
    latestPassedVerificationSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPassedVerificationSeq > latestWorkspaceWriteSeq);
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
    (latestWorkspaceWriteSeq === undefined ||
      latestGoalSatisfiedSeq > latestWorkspaceWriteSeq);
  return {
    verificationToolCompleted: events.some(isVerifyWorkspaceCompletion),
    verificationToolPassed: latestPassedVerificationSeq !== undefined,
    workspaceWriteCompleted: latestWorkspaceWriteSeq !== undefined,
    verificationToolPassedAfterWorkspaceWrite,
    planCompleted: latestPlanCompletedSeq !== undefined,
    planArtifactVerified: latestPlanArtifactVerifiedSeq !== undefined,
    goalSatisfied: latestGoalSatisfiedSeq !== undefined,
    planCompletedAfterWorkspaceWrite,
    planArtifactVerifiedAfterWorkspaceWrite,
    goalSatisfiedAfterWorkspaceWrite,
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
  };
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

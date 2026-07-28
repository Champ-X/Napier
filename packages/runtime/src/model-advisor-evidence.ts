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
  latestPlanArtifactVerifiedSeq?: number;
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

export function isPlanArtifactVerificationEvent(event: RunEvent): boolean {
  return (
    event.type === "plan.artifact.verified" &&
    event.category === "plan" &&
    isRecord(event.payload) &&
    event.payload["status"] === "verified"
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
  const latestPlanArtifactVerifiedSeq = latestSeq(
    events,
    isPlanArtifactVerificationEvent,
  );
  const latestGoalSatisfiedSeq = latestSeq(events, isGoalSatisfiedEvent);
  const verificationToolPassedAfterWorkspaceWrite =
    latestPassedVerificationSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPassedVerificationSeq > latestWorkspaceWriteSeq);
  const planCompletedAfterWorkspaceWrite =
    latestPlanCompletedSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPlanCompletedSeq > latestWorkspaceWriteSeq);
  const planArtifactVerifiedAfterWorkspaceWrite =
    latestPlanArtifactVerifiedSeq !== undefined &&
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
    ...(latestPlanArtifactVerifiedSeq !== undefined
      ? { latestPlanArtifactVerifiedSeq }
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

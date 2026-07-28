import type { RunEvent } from "@napier/contracts";

export interface ModelAdvisorVerificationEvidence {
  verificationToolCompleted: boolean;
  verificationToolPassed: boolean;
  workspaceWriteCompleted: boolean;
  verificationToolPassedAfterWorkspaceWrite: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
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

export function createModelAdvisorVerificationEvidence(
  events: RunEvent[],
): ModelAdvisorVerificationEvidence {
  const latestWorkspaceWriteSeq = latestSeq(events, isWorkspaceWriteCompletion);
  const latestPassedVerificationSeq = latestSeq(
    events,
    isPassedVerifyWorkspaceCompletion,
  );
  const verificationToolPassedAfterWorkspaceWrite =
    latestPassedVerificationSeq !== undefined &&
    (latestWorkspaceWriteSeq === undefined ||
      latestPassedVerificationSeq > latestWorkspaceWriteSeq);
  return {
    verificationToolCompleted: events.some(isVerifyWorkspaceCompletion),
    verificationToolPassed: latestPassedVerificationSeq !== undefined,
    workspaceWriteCompleted: latestWorkspaceWriteSeq !== undefined,
    verificationToolPassedAfterWorkspaceWrite,
    ...(latestWorkspaceWriteSeq !== undefined
      ? { latestWorkspaceWriteSeq }
      : {}),
    ...(latestPassedVerificationSeq !== undefined
      ? { latestPassedVerificationSeq }
      : {}),
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

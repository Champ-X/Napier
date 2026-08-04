import type { AutomaticRecoveryAttempt, RunRecord } from "@napier/contracts";

import {
  normalizeAutomaticRecoveryError,
  settleAutomaticRecoveryAttemptRecord,
  stripAutomaticRecoverySecrets,
  type PersistedAutomaticRecoveryAttempt,
  withAutomaticRecoveryAttemptHash,
} from "./automatic-recovery-store-records.js";

interface AutomaticRecoveryMutationState {
  automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[];
  runs: RunRecord[];
}

interface AutomaticRecoveryMutationInput {
  state: AutomaticRecoveryMutationState;
  attemptId: string;
  token: string;
  now(): Date;
  assertToken(expectedSha256: string | undefined, token: string): void;
}

export function renewAutomaticRecoveryState(
  input: AutomaticRecoveryMutationInput & { ttlMs: number },
): AutomaticRecoveryAttempt {
  const { index, current } = activeAttempt(
    input.state,
    input.attemptId,
    "Automatic recovery claim is not active",
    (attempt) =>
      (attempt.status === "claimed" || attempt.status === "running") &&
      attempt.claim !== undefined,
  );
  input.assertToken(current.claimTokenSha256, input.token);
  if (Date.parse(current.claim!.expiresAt) <= input.now().getTime()) {
    throw new Error("Automatic recovery claim has expired");
  }
  const heartbeatAt = input.now().toISOString();
  const updated = withAutomaticRecoveryAttemptHash({
    ...current,
    claim: {
      ...current.claim!,
      heartbeatAt,
      expiresAt: new Date(Date.parse(heartbeatAt) + input.ttlMs).toISOString(),
      revision: current.claim!.revision + 1,
    },
    updatedAt: heartbeatAt,
    revision: current.revision + 1,
  });
  input.state.automaticRecoveryAttempts[index] = updated;
  return stripAutomaticRecoverySecrets(updated);
}

export function bindAutomaticRecoveryRunState(
  input: AutomaticRecoveryMutationInput & { recoveryRunId: string },
): AutomaticRecoveryAttempt {
  const { index, current } = activeAttempt(
    input.state,
    input.attemptId,
    "Automatic recovery attempt cannot bind a Run",
    (attempt) => attempt.status === "claimed" && attempt.claim !== undefined,
  );
  input.assertToken(current.claimTokenSha256, input.token);
  const run = input.state.runs.find(
    (candidate) => candidate.id === input.recoveryRunId,
  );
  if (
    !run ||
    run.threadId !== current.threadId ||
    run.agentId !== current.agentId ||
    run.source !== "recovery" ||
    run.parentRunId !== current.interruptedRunId ||
    run.triggerId !== current.triggerId ||
    (run.status !== "queued" && run.status !== "running")
  ) {
    throw new Error("Automatic recovery Run binding is invalid");
  }
  const updated = withAutomaticRecoveryAttemptHash({
    ...current,
    status: "running",
    recoveryRunId: run.id,
    startedAt: run.startedAt,
    updatedAt: input.now().toISOString(),
    revision: current.revision + 1,
  });
  input.state.automaticRecoveryAttempts[index] = updated;
  return stripAutomaticRecoverySecrets(updated);
}

export function settleAutomaticRecoveryState(
  input: AutomaticRecoveryMutationInput & { recoveryRunId: string },
): AutomaticRecoveryAttempt {
  const { index, current } = activeAttempt(
    input.state,
    input.attemptId,
    "Automatic recovery attempt is not active",
    (attempt) => attempt.status === "claimed" || attempt.status === "running",
  );
  input.assertToken(current.claimTokenSha256, input.token);
  const run = input.state.runs.find(
    (candidate) => candidate.id === input.recoveryRunId,
  );
  if (
    !run ||
    run.triggerId !== current.triggerId ||
    run.parentRunId !== current.interruptedRunId ||
    run.status === "queued" ||
    run.status === "running"
  ) {
    throw new Error("Automatic recovery Run is not settled");
  }
  const updated = settleAutomaticRecoveryAttemptRecord(
    current,
    run,
    input.now().toISOString(),
  );
  input.state.automaticRecoveryAttempts[index] = updated;
  return stripAutomaticRecoverySecrets(updated);
}

export function abandonAutomaticRecoveryState(
  input: AutomaticRecoveryMutationInput & { error: string },
): AutomaticRecoveryAttempt {
  const { index, current } = activeAttempt(
    input.state,
    input.attemptId,
    "Automatic recovery attempt cannot be abandoned",
    (attempt) =>
      attempt.status === "claimed" &&
      attempt.recoveryRunId === undefined &&
      attempt.claim !== undefined,
  );
  input.assertToken(current.claimTokenSha256, input.token);
  const timestamp = input.now().toISOString();
  const {
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    ...withoutClaim
  } = current;
  const updated = withAutomaticRecoveryAttemptHash({
    ...withoutClaim,
    status: "abandoned",
    error: normalizeAutomaticRecoveryError(input.error),
    updatedAt: timestamp,
    finishedAt: timestamp,
    revision: current.revision + 1,
  });
  input.state.automaticRecoveryAttempts[index] = updated;
  return stripAutomaticRecoverySecrets(updated);
}

function activeAttempt(
  state: AutomaticRecoveryMutationState,
  attemptId: string,
  error: string,
  predicate: (attempt: PersistedAutomaticRecoveryAttempt) => boolean,
): { index: number; current: PersistedAutomaticRecoveryAttempt } {
  const index = state.automaticRecoveryAttempts.findIndex(
    (candidate) => candidate.id === attemptId,
  );
  const current = state.automaticRecoveryAttempts[index];
  if (!current || !predicate(current)) throw new Error(error);
  return { index, current };
}

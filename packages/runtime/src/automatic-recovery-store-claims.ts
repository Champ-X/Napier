import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryClaim,
  AutomaticRecoveryAttempt,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";

import { assessAutomaticRecovery } from "./automatic-recovery.js";
import {
  automaticRecoveryRoot,
  createAutomaticRecoveryAttemptRecord,
  reissueAutomaticRecoveryClaim,
  settleAutomaticRecoveryAttemptRecord,
  stripAutomaticRecoverySecrets,
  type PersistedAutomaticRecoveryAttempt,
} from "./automatic-recovery-store-records.js";

interface AutomaticRecoveryClaimState {
  automaticRecoveryAssessments: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[];
  runs: RunRecord[];
  threads: ThreadRecord[];
}

export interface AutomaticRecoveryClaimSweep {
  claims: AutomaticRecoveryClaim[];
  skipped: AutomaticRecoveryAssessment[];
  settled: AutomaticRecoveryAttempt[];
  deferred: number;
  changed: boolean;
}

export function claimAutomaticRecoveryState(input: {
  state: AutomaticRecoveryClaimState;
  ownerId: string;
  leaseMs: number;
  limit: number;
  now: Date;
  createToken(): string;
  listEvents(threadId: string): RunEvent[];
}): AutomaticRecoveryClaimSweep {
  const timestamp = input.now.toISOString();
  const claims: AutomaticRecoveryClaim[] = [];
  const skipped: AutomaticRecoveryAssessment[] = [];
  const settled: AutomaticRecoveryAttempt[] = [];
  let deferred = 0;
  let changed = false;

  for (
    let index = 0;
    index < input.state.automaticRecoveryAttempts.length;
    index += 1
  ) {
    const current = input.state.automaticRecoveryAttempts[index]!;
    if (current.status !== "claimed" && current.status !== "running") {
      continue;
    }
    const recoveryRun = current.recoveryRunId
      ? input.state.runs.find(
          (candidate) => candidate.id === current.recoveryRunId,
        )
      : undefined;
    if (
      recoveryRun &&
      recoveryRun.status !== "queued" &&
      recoveryRun.status !== "running"
    ) {
      const updated = settleAutomaticRecoveryAttemptRecord(
        current,
        recoveryRun,
        timestamp,
      );
      input.state.automaticRecoveryAttempts[index] = updated;
      settled.push(stripAutomaticRecoverySecrets(updated));
      changed = true;
      continue;
    }
    if (
      current.status === "claimed" &&
      !current.recoveryRunId &&
      current.claim &&
      Date.parse(current.claim.expiresAt) <= input.now.getTime() &&
      claims.length < input.limit
    ) {
      const assessment = input.state.automaticRecoveryAssessments.find(
        (candidate) => candidate.contentSha256 === current.assessmentSha256,
      );
      if (!assessment) {
        throw new Error(
          `Automatic recovery assessment is missing: ${current.id}`,
        );
      }
      const token = input.createToken();
      const updated = reissueAutomaticRecoveryClaim(
        current,
        input.ownerId,
        token,
        timestamp,
        input.leaseMs,
      );
      input.state.automaticRecoveryAttempts[index] = updated;
      claims.push({
        assessment: structuredClone(assessment),
        attempt: stripAutomaticRecoverySecrets(updated),
        token,
      });
      changed = true;
    }
  }

  const candidates = input.state.runs
    .filter((run) => run.status === "interrupted")
    .filter(
      (run) =>
        !input.state.runs.some(
          (candidate) =>
            candidate.threadId === run.threadId &&
            candidate.source === "recovery" &&
            candidate.parentRunId === run.id,
        ),
    )
    .filter(
      (run) =>
        !input.state.automaticRecoveryAssessments.some(
          (assessment) => assessment.runId === run.id,
        ),
    )
    .sort((left, right) =>
      (left.interruptedAt ?? left.finishedAt ?? left.startedAt).localeCompare(
        right.interruptedAt ?? right.finishedAt ?? right.startedAt,
      ),
    );

  for (const run of candidates) {
    if (claims.length >= input.limit) break;
    const thread = input.state.threads.find(
      (candidate) => candidate.id === run.threadId,
    );
    if (
      !thread ||
      thread.status !== "waiting" ||
      thread.currentRunId !== undefined
    ) {
      continue;
    }
    const chain = automaticRecoveryRoot(input.state.runs, run);
    const priorAttempts = input.state.automaticRecoveryAttempts.filter(
      (attempt) => attempt.rootRunId === chain.rootRunId,
    ).length;
    const assessment = assessAutomaticRecovery({
      run,
      events: input.listEvents(run.threadId),
      rootRunId: chain.rootRunId,
      priorAttempts,
      chainTrusted: chain.trusted && !thread.importProvenance,
      assessedAt: input.now,
    });
    if (
      assessment.eligible &&
      Date.parse(assessment.eligibleAt) > input.now.getTime()
    ) {
      deferred += 1;
      continue;
    }
    input.state.automaticRecoveryAssessments.push(assessment);
    changed = true;
    if (!assessment.eligible) {
      skipped.push(structuredClone(assessment));
      continue;
    }
    const token = input.createToken();
    const attempt = createAutomaticRecoveryAttemptRecord(
      assessment,
      input.ownerId,
      token,
      timestamp,
      input.leaseMs,
    );
    input.state.automaticRecoveryAttempts.push(attempt);
    claims.push({
      assessment: structuredClone(assessment),
      attempt: stripAutomaticRecoverySecrets(attempt),
      token,
    });
  }
  return { claims, skipped, settled, deferred, changed };
}

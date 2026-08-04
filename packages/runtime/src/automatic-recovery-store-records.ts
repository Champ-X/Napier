import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunRecord,
} from "@napier/contracts";

import {
  hashAutomaticRecoveryAttempt,
  validateAutomaticRecoveryAttempt,
} from "./automatic-recovery.js";
import { createId } from "./ids.js";
import { storeSha256 as sha256 } from "./store-hashing.js";

export interface PersistedAutomaticRecoveryAttempt extends AutomaticRecoveryAttempt {
  claimTokenSha256?: string;
}

export function stripAutomaticRecoverySecrets(
  attempt: PersistedAutomaticRecoveryAttempt,
): AutomaticRecoveryAttempt {
  const output = structuredClone(attempt);
  delete output.claimTokenSha256;
  return output;
}

export function withAutomaticRecoveryAttemptHash(
  input: Omit<PersistedAutomaticRecoveryAttempt, "contentSha256"> & {
    contentSha256?: string;
  },
): PersistedAutomaticRecoveryAttempt {
  const { contentSha256: _contentSha256, claimTokenSha256, ...content } = input;
  const publicContent = content as Omit<
    AutomaticRecoveryAttempt,
    "contentSha256"
  >;
  const validated = validateAutomaticRecoveryAttempt({
    ...publicContent,
    contentSha256: hashAutomaticRecoveryAttempt(publicContent),
  });
  return {
    ...validated,
    ...(claimTokenSha256 ? { claimTokenSha256 } : {}),
  };
}

export function createAutomaticRecoveryAttemptRecord(
  assessment: AutomaticRecoveryAssessment,
  ownerId: string,
  token: string,
  timestamp: string,
  leaseMs: number,
): PersistedAutomaticRecoveryAttempt {
  const content: Omit<AutomaticRecoveryAttempt, "contentSha256"> = {
    id: createId("recovery"),
    threadId: assessment.threadId,
    agentId: assessment.agentId,
    rootRunId: assessment.rootRunId,
    interruptedRunId: assessment.runId,
    attempt: assessment.priorAttempts + 1,
    maxAttempts: assessment.policy.maxAttempts,
    triggerId: `automatic-recovery:${assessment.rootRunId}:${assessment.priorAttempts + 1}`,
    assessmentSha256: assessment.contentSha256,
    status: "claimed",
    claim: {
      ownerId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
      revision: 1,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  };
  return withAutomaticRecoveryAttemptHash({
    ...content,
    claimTokenSha256: sha256(token),
  });
}

export function reissueAutomaticRecoveryClaim(
  current: PersistedAutomaticRecoveryAttempt,
  ownerId: string,
  token: string,
  timestamp: string,
  leaseMs: number,
): PersistedAutomaticRecoveryAttempt {
  return withAutomaticRecoveryAttemptHash({
    ...current,
    claim: {
      ownerId,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + leaseMs).toISOString(),
      revision: (current.claim?.revision ?? 0) + 1,
    },
    claimTokenSha256: sha256(token),
    updatedAt: timestamp,
    revision: current.revision + 1,
  });
}

export function settleAutomaticRecoveryAttemptRecord(
  current: PersistedAutomaticRecoveryAttempt,
  run: RunRecord,
  timestamp: string,
): PersistedAutomaticRecoveryAttempt {
  if (
    run.status === "queued" ||
    run.status === "running" ||
    run.triggerId !== current.triggerId ||
    run.parentRunId !== current.interruptedRunId
  ) {
    throw new Error("Automatic recovery attempt cannot settle from this Run");
  }
  const {
    claim: _claim,
    claimTokenSha256: _claimTokenSha256,
    contentSha256: _contentSha256,
    error: _error,
    ...base
  } = current;
  const status: AutomaticRecoveryAttempt["status"] =
    run.status === "completed"
      ? "completed"
      : run.status === "failed"
        ? "failed"
        : run.status === "cancelled"
          ? "cancelled"
          : "interrupted";
  return withAutomaticRecoveryAttemptHash({
    ...base,
    status,
    recoveryRunId: run.id,
    ...(status === "completed"
      ? {}
      : {
          error: normalizeAutomaticRecoveryError(
            run.error ?? `Recovery Run settled as ${run.status}`,
          ),
        }),
    startedAt: current.startedAt ?? run.startedAt,
    finishedAt: run.finishedAt ?? timestamp,
    updatedAt: timestamp,
    revision: current.revision + 1,
  });
}

export function automaticRecoveryRoot(
  runs: RunRecord[],
  candidate: RunRecord,
): { rootRunId: string; trusted: boolean } {
  let current = candidate;
  let trusted = true;
  const visited = new Set([candidate.id]);
  for (let depth = 0; current.source === "recovery"; depth += 1) {
    if (depth >= 32 || !current.parentRunId) {
      trusted = false;
      break;
    }
    const parent = runs.find(
      (run) =>
        run.id === current.parentRunId &&
        run.threadId === candidate.threadId &&
        run.agentId === candidate.agentId,
    );
    if (!parent || visited.has(parent.id) || parent.status !== "interrupted") {
      trusted = false;
      break;
    }
    visited.add(parent.id);
    current = parent;
  }
  return { rootRunId: current.id, trusted };
}

export function normalizeAutomaticRecoveryError(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Automatic recovery failed").slice(0, 1_000);
}

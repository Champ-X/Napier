import { DEFAULT_RUN_LIMITS, normalizeRunLimits } from "./agents.js";
import { stripAutomaticRecoverySecrets } from "./automatic-recovery-store-records.js";
import {
  validateAutomaticRecoveryAssessment,
  validateAutomaticRecoveryAttempt,
} from "./automatic-recovery.js";
import { normalizeRunReleaseIdentity } from "./release-product-identity-policy.js";
import { validateRunConfigurationFingerprint } from "./run-config.js";
import { assertOutcome } from "./run-outcomes.js";
import type { PersistedStoreState } from "./store-state.js";
export function validatePersistedRunState(state: PersistedStoreState): void {
  validateRuns(state);
  validateRecoveryAssessments(state);
  validateRecoveryAttempts(state);
}

function validateRuns(state: PersistedStoreState): void {
  for (const run of state.runs) {
    const agent = state.agents.find(
      (candidate) => candidate.id === run.agentId,
    );
    assertOutcome(run.status, run.outcome);
    if (run.workflowPlanId !== undefined) {
      validateStoreResourceId(run.workflowPlanId);
      const workflowPlan = state.plans.find(
        (candidate) => candidate.id === run.workflowPlanId,
      );
      if (
        (run.source !== "workflow" && run.source !== "workflow_simulation") ||
        !workflowPlan ||
        workflowPlan.threadId !== run.threadId
      ) {
        throw new Error(
          `Persisted Workflow Run Plan binding is invalid: ${run.id}`,
        );
      }
    } else if (run.source === "workflow_simulation") {
      throw new Error(
        `Persisted Workflow simulation Run Plan binding is missing: ${run.id}`,
      );
    }
    const configuration = run.configuration
      ? validateRunConfigurationFingerprint(run.configuration)
      : undefined;
    if (configuration) run.configuration = configuration;
    normalizeRunReleaseIdentity(run);
    if (!Number.isInteger(run.agentRevision) || Number(run.agentRevision) < 1) {
      run.agentRevision = configuration?.agentRevision ?? agent?.revision ?? 1;
    }
    run.limits = normalizeRunLimits(
      run.limits ??
        configuration?.runLimits ??
        agent?.runLimits ??
        structuredClone(DEFAULT_RUN_LIMITS),
    );
    if (
      configuration &&
      (run.agentRevision !== configuration.agentRevision ||
        JSON.stringify(run.limits) !== JSON.stringify(configuration.runLimits))
    ) {
      throw new Error(
        `Run configuration fingerprint conflicts with Run record: ${run.id}`,
      );
    }
  }
}

function validateRecoveryAssessments(state: PersistedStoreState): void {
  const automaticRecoveryAssessmentIds = new Set<string>();
  for (const input of state.automaticRecoveryAssessments) {
    const assessment = validateAutomaticRecoveryAssessment(input);
    if (automaticRecoveryAssessmentIds.has(assessment.runId)) {
      throw new Error(
        `Duplicate automatic recovery assessment: ${assessment.runId}`,
      );
    }
    const run = state.runs.find(
      (candidate) => candidate.id === assessment.runId,
    );
    const rootRun = state.runs.find(
      (candidate) => candidate.id === assessment.rootRunId,
    );
    if (
      !run ||
      !rootRun ||
      run.threadId !== assessment.threadId ||
      run.agentId !== assessment.agentId ||
      rootRun.threadId !== assessment.threadId ||
      assessment.runConfigurationSha256 !== run.configuration?.contentSha256
    ) {
      throw new Error(
        `Persisted automatic recovery assessment references invalid state: ${assessment.runId}`,
      );
    }
    automaticRecoveryAssessmentIds.add(assessment.runId);
    Object.assign(input, assessment);
  }
}

function validateRecoveryAttempts(state: PersistedStoreState): void {
  const automaticRecoveryAttemptIds = new Set<string>();
  const automaticRecoveryTriggers = new Set<string>();
  for (const input of state.automaticRecoveryAttempts) {
    const attempt = validateAutomaticRecoveryAttempt(
      stripAutomaticRecoverySecrets(input),
    );
    if (
      automaticRecoveryAttemptIds.has(attempt.id) ||
      automaticRecoveryTriggers.has(attempt.triggerId)
    ) {
      throw new Error(`Duplicate automatic recovery attempt: ${attempt.id}`);
    }
    const assessment = state.automaticRecoveryAssessments.find(
      (candidate) => candidate.contentSha256 === attempt.assessmentSha256,
    );
    const interruptedRun = state.runs.find(
      (candidate) => candidate.id === attempt.interruptedRunId,
    );
    const recoveryRun = attempt.recoveryRunId
      ? state.runs.find((candidate) => candidate.id === attempt.recoveryRunId)
      : undefined;
    if (
      !assessment ||
      assessment.runId !== attempt.interruptedRunId ||
      assessment.rootRunId !== attempt.rootRunId ||
      assessment.priorAttempts + 1 !== attempt.attempt ||
      assessment.policy.maxAttempts !== attempt.maxAttempts ||
      !interruptedRun ||
      interruptedRun.threadId !== attempt.threadId ||
      interruptedRun.agentId !== attempt.agentId ||
      (attempt.recoveryRunId &&
        (!recoveryRun ||
          recoveryRun.threadId !== attempt.threadId ||
          recoveryRun.parentRunId !== attempt.interruptedRunId ||
          recoveryRun.triggerId !== attempt.triggerId))
    ) {
      throw new Error(
        `Persisted automatic recovery attempt references invalid state: ${attempt.id}`,
      );
    }
    if (
      Boolean(attempt.claim) !== Boolean(input.claimTokenSha256) ||
      (input.claimTokenSha256 && !/^[a-f0-9]{64}$/.test(input.claimTokenSha256))
    ) {
      throw new Error(
        `Persisted automatic recovery claim secret is invalid: ${attempt.id}`,
      );
    }
    automaticRecoveryAttemptIds.add(attempt.id);
    automaticRecoveryTriggers.add(attempt.triggerId);
    Object.assign(input, attempt);
  }
}

function validateStoreResourceId(id: string): void {
  if (!/^[a-z][a-z0-9_]{2,80}$/.test(id)) {
    throw new Error("Invalid resource ID: " + id);
  }
}

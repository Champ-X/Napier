import type {
  ExecutionPlan,
  OperatorDecision,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";
import {
  manualRunRecoveryBlockReason,
  manualRunRecoverySettlementMatches,
} from "@napier/contracts/manual-run-recovery";

import { resolveOperatorDecisionCapabilityContinuation } from "./agent-capability-override.js";
import type {
  ContinueOperatorDecisionOptions,
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
import { modernRunConfiguration } from "./effective-run-profile.js";
import { formatOperatorDecisionContinuation } from "./operator-decisions.js";
import {
  prepareAutomaticSkillRecoveryOptions,
  prepareManualSkillRecoveryOptions,
} from "./research-recovery-options.js";
import { buildRunRecoveryPrompt } from "./run-recovery-prompt.js";
import { isWorkflowRunSource } from "./workflow-node-execution.js";

type RunPrompt = (options: RunPromptOptions) => Promise<RunRecord>;

interface AgentRunRecoveryHost {
  store: AgentRunRecoveryStore;
  runPrompt: RunPrompt;
}

interface AgentRunRecoveryStore {
  readonly workspaceRoot: string;
  getThread(threadId: string): ThreadRecord;
  listRuns(threadId: string): RunRecord[];
  listRunEvents(runId: string): Promise<RunEvent[]>;
  listPlans(threadId: string): ExecutionPlan[];
  listOperatorDecisions(threadId: string): Promise<OperatorDecision[]>;
  continueOperatorDecision(
    threadId: string,
    decisionId: string,
    continuationRunId: string,
  ): Promise<unknown>;
}

export async function resumeInterruptedAgentRun(
  host: AgentRunRecoveryHost,
  options: ResumeInterruptedRunOptions,
): Promise<RunRecord> {
  const thread = host.store.getThread(options.threadId);
  const interrupted = host.store
    .listRuns(thread.id)
    .filter((run) => manualRunRecoverySettlementMatches(thread.status, run))
    .findLast((run) => !options.runId || run.id === options.runId);
  if (!interrupted) throw new Error("Manually resumable run not found");
  assertManualRecoveryAllowed(interrupted);

  const events = await host.store.listRunEvents(interrupted.id);
  const recoveryOptions: RunPromptOptions = {
    threadId: thread.id,
    text: buildRunRecoveryPrompt(
      interrupted,
      thread.goal?.status === "active" ? thread.goal.objective : undefined,
      { events, plans: host.store.listPlans(thread.id) },
    ),
    parentRunId: interrupted.id,
    source: "recovery",
    recovery: { mode: "manual" },
    ...(options.model ? { model: options.model } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  };
  return host.runPrompt(
    await prepareManualSkillRecoveryOptions(
      host.store.workspaceRoot,
      interrupted,
      events,
      recoveryOptions,
    ),
  );
}

export async function continueAnsweredOperatorDecision(
  host: AgentRunRecoveryHost,
  options: ContinueOperatorDecisionOptions,
): Promise<RunRecord> {
  const decision = (
    await host.store.listOperatorDecisions(options.threadId)
  ).find((candidate) => candidate.id === options.decisionId);
  if (!decision) {
    throw new Error(`Operator decision not found: ${options.decisionId}`);
  }
  if (decision.status !== "answered") {
    throw new Error(
      `Operator decision cannot continue in ${decision.status} state`,
    );
  }
  const continuation = await resolveOperatorDecisionCapabilityContinuation(
    host.store,
    options.threadId,
    decision.runId,
  );
  return host.runPrompt({
    threadId: options.threadId,
    text: formatOperatorDecisionContinuation(decision),
    ...continuation.runOptions,
    parentRunId: continuation.originRun.id,
    operatorDecisionId: decision.id,
    source: "user",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    onRunCreated: async (run) => {
      await host.store.continueOperatorDecision(
        options.threadId,
        decision.id,
        run.id,
      );
      await options.onRunCreated?.(run);
    },
  });
}

export async function resumeInterruptedAgentRunAutomatically(
  host: AgentRunRecoveryHost,
  options: ResumeInterruptedRunAutomaticallyOptions,
): Promise<RunRecord> {
  const { assessment, attempt } = options;
  if (
    !assessment.eligible ||
    assessment.runId !== attempt.interruptedRunId ||
    assessment.rootRunId !== attempt.rootRunId ||
    assessment.contentSha256 !== attempt.assessmentSha256 ||
    assessment.priorAttempts + 1 !== attempt.attempt ||
    attempt.status !== "claimed"
  ) {
    throw new Error("Automatic recovery claim evidence is invalid");
  }
  const thread = host.store.getThread(assessment.threadId);
  if (thread.status !== "waiting" || thread.currentRunId) {
    throw new Error("Thread is not waiting for automatic recovery");
  }
  const interrupted = host.store
    .listRuns(thread.id)
    .find((run) => run.id === assessment.runId);
  if (!automaticRecoveryEligible(interrupted, assessment)) {
    throw new Error(
      "Interrupted Run is not eligible for safe automatic recovery",
    );
  }

  const events = await host.store.listRunEvents(interrupted.id);
  const recoveryOptions: RunPromptOptions = {
    threadId: thread.id,
    text: buildRunRecoveryPrompt(
      interrupted,
      thread.goal?.status === "active" ? thread.goal.objective : undefined,
      events,
      "automatic",
    ),
    model: interrupted.configuration.model,
    agentRevision: interrupted.configuration.agentRevision,
    executionMode: "safe_read_only_recovery",
    parentRunId: interrupted.id,
    source: "recovery",
    triggerId: attempt.triggerId,
    recovery: {
      mode: "automatic",
      attemptId: attempt.id,
      assessmentSha256: assessment.contentSha256,
    },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.onRunCreated ? { onRunCreated: options.onRunCreated } : {}),
  };
  return host.runPrompt(
    await prepareAutomaticSkillRecoveryOptions(
      host.store.workspaceRoot,
      interrupted,
      events,
      recoveryOptions,
    ),
  );
}

function assertManualRecoveryAllowed(run: RunRecord): void {
  const blockReason = manualRunRecoveryBlockReason(run);
  const message =
    blockReason === "workflow_managed"
      ? "Workflow node Runs must be resumed through their Workflow Plan"
      : blockReason === "model_experiment"
        ? "Model invocation experiment Runs must be retried from their source checkpoint"
        : blockReason === "tool_experiment"
          ? "Tool invocation experiment Runs must be retried from their source checkpoint"
          : blockReason === "agent_experiment"
            ? "Agent message experiment Runs must be retried from their source checkpoint"
            : undefined;
  if (message) throw new Error(message);
}

function automaticRecoveryEligible(
  run: RunRecord | undefined,
  assessment: ResumeInterruptedRunAutomaticallyOptions["assessment"],
): run is RunRecord & {
  configuration: NonNullable<RunRecord["configuration"]>;
} {
  return Boolean(
    run &&
    run.status === "interrupted" &&
    !isWorkflowRunSource(run.source) &&
    run.configuration &&
    modernRunConfiguration(run.configuration) &&
    run.configuration.automaticRecovery.mode === "safe_read_only" &&
    run.configuration.contentSha256 === assessment.runConfigurationSha256,
  );
}

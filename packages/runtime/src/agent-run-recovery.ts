import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";
import {
  manualRunRecoveryBlockReason,
  manualRunRecoverySettlementMatches,
} from "@napier/contracts/manual-run-recovery";

import type {
  ResumeInterruptedRunAutomaticallyOptions,
  ResumeInterruptedRunOptions,
  RunPromptOptions,
} from "./agent-runtime-options.js";
import { modernRunConfiguration } from "./effective-run-profile.js";
import {
  prepareAutomaticSkillRecoveryOptions,
  prepareManualSkillRecoveryOptions,
} from "./research-recovery-options.js";
import { buildRunRecoveryPrompt } from "./run-recovery-prompt.js";
import { isWorkflowRunSource } from "./workflow-node-execution.js";
import { inheritedHarnessPolicyOptions } from "./harness-run-policy.js";
import { assessAutomaticRecovery } from "./automatic-recovery.js";
import { loadSettledPatchRecoveryEvidence } from "./workspace-patch-result-recovery.js";
import { reconcileSettledWorkspacePatches } from "./workspace-patch-reconciliation.js";
import { operatorDecisionRecoveryContext } from "./operator-decision-recovery-context.js";

export { continueAnsweredOperatorDecision } from "./agent-operator-decision-continuation.js";

type RunPrompt = (options: RunPromptOptions) => Promise<RunRecord>;

interface AgentRunRecoveryHost {
  store: AgentRunRecoveryStore;
  runPrompt: RunPrompt;
}

interface AgentRunRecoveryStore {
  readonly workspaceRoot: string;
  readonly dataRoot: string;
  getThread(threadId: string): ThreadRecord;
  listRuns(threadId: string): RunRecord[];
  listRunEvents(runId: string): Promise<RunEvent[]>;
  listPlans(threadId: string): ExecutionPlan[];
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
    ...inheritedHarnessPolicyOptions(events, interrupted.id),
    threadId: thread.id,
    text: [
      buildRunRecoveryPrompt(
        interrupted,
        thread.goal?.status === "active" ? thread.goal.objective : undefined,
        { events, plans: host.store.listPlans(thread.id) },
      ),
      await operatorDecisionRecoveryContext(host.store, interrupted),
    ]
      .filter(Boolean)
      .join("\n\n"),
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
  // A claim is a scheduling decision. Recheck durable operations and live
  // postconditions before starting another Run, including reclaimed claims.
  const fresh = assessAutomaticRecovery({
    run: interrupted,
    events,
    rootRunId: assessment.rootRunId,
    priorAttempts: assessment.priorAttempts,
  });
  if (!fresh.eligible)
    throw new Error("Automatic recovery operation evidence changed");
  const { patches, retainedResults } = await loadSettledPatchRecoveryEvidence(
    host.store.dataRoot,
    events,
  );
  await reconcileSettledWorkspacePatches(
    host.store.workspaceRoot,
    host.store.dataRoot,
    patches,
  );
  const recoveryOptions: RunPromptOptions = {
    ...inheritedHarnessPolicyOptions(events, interrupted.id),
    threadId: thread.id,
    text:
      buildRunRecoveryPrompt(
        interrupted,
        thread.goal?.status === "active" ? thread.goal.objective : undefined,
        events,
        "automatic",
      ) +
      "\n" +
      (await operatorDecisionRecoveryContext(host.store, interrupted)) +
      (patches.length
        ? `\n${patches.filter((patch) => !patch.preparedCapsuleSha256).length} settled patch operation(s) were retained; ${patches.filter((patch) => patch.preparedCapsuleSha256).length} prepared patch operation(s) were independently reconciled. Reconciled operations have no fabricated tool result; diagnostics after the write may be unavailable. Their latest file postconditions were rechecked before this recovery; do not repeat those writes. Continue the remaining read-only work. This does not verify the overall objective.\n<retained-patch-evidence>${JSON.stringify({ patches, retainedResults })}</retained-patch-evidence>`
        : ""),
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

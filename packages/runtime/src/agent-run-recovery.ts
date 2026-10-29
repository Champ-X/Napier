import type { OsSandboxAdapter } from "./sandbox-types.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EventSink } from "./event-sink.js";
import type { PatchRecoveryExecutionStore } from "./workspace-patch-recovery-execution.js";
import type { AgentProfile } from "@napier/contracts";
import type { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import { executeWorkspacePatchRecovery } from "./workspace-patch-recovery-execution.js";
import { VERIFIED_PATCH_RECOVERY } from "./internal-research-recovery-authorization.js";
import { planWorkspacePatchRecovery } from "./workspace-patch-recovery-plan.js";
import { inspectWorkspacePatchRecoveryPlan } from "./workspace-patch-recovery-execution.js";
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
import { moveRecoveryEvidence } from "./workspace-file-move-evidence.js";
import { reconcileSettledWorkspaceMoves } from "./workspace-file-move-reconciliation.js";
import { operatorDecisionRecoveryContext } from "./operator-decision-recovery-context.js";
import { isSubagentChildRun, latestPrimaryRun } from "./primary-run-selection.js";

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
  const interrupted = latestPrimaryRun(host.store.listRuns(thread.id));
  if (!interrupted ||
      !manualRunRecoverySettlementMatches(thread.status, interrupted) ||
      (options.runId && options.runId !== interrupted.id))
    throw new Error("Manually resumable run not found or checkpoint superseded");
  assertManualRecoveryAllowed(interrupted);

  const events = await host.store.listRunEvents(interrupted.id);
  const recoveryOptions: RunPromptOptions = {
    ...inheritedHarnessPolicyOptions(events, interrupted.id),
    threadId: thread.id,
    text: [
      buildRunRecoveryPrompt(
        interrupted,
        thread.goal?.status === "active" ? thread.goal.objective : undefined,
        { events, plans: options.readOnly ? [] : host.store.listPlans(thread.id) },
      ),
      await operatorDecisionRecoveryContext(host.store, interrupted),
      options.readOnly
        ? "The operator requested read-only inspection. Only local read-only tools are available. Inspect preserved results and report unresolved effects and the next required action. Do not execute pending patches or repeat writes; this inspection does not complete the original task."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    parentRunId: interrupted.id,
    source: "recovery",
    recovery: { mode: "manual", ...(options.readOnly ? { inspection: true as const } : {}) },
    ...(options.readOnly ? { executionMode: "safe_read_only_recovery" as const } : {}),
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
  const moves = moveRecoveryEvidence(events).filter((move) => move.status === "completed");
  await reconcileSettledWorkspaceMoves(host.store.workspaceRoot, host.store.dataRoot, moves);
  const patchPlan =
    modernRunConfiguration(interrupted.configuration) &&
    interrupted.configuration.automaticRecovery.mode === "verified_patches"
      ? planWorkspacePatchRecovery(interrupted, events)
      : undefined;
  if (patchPlan)
    await inspectWorkspacePatchRecoveryPlan(host.store, thread.id, patchPlan);
  const recoveryOptions: RunPromptOptions = {
    ...(patchPlan ? { [VERIFIED_PATCH_RECOVERY]: patchPlan } : {}),
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
        : "") +
      (moves.length ? `\n${moves.length} file move operation was retained after checking both paths, parent identities and the destination file identity and bytes. No tool result was fabricated. Do not repeat the move; continue remaining read-only work.\n<retained-move-evidence>${JSON.stringify(moves.map(({ callId, operationId, evidenceSeq, reason }) => ({ callId, operationId, evidenceSeq, reason })))}</retained-move-evidence>` : ""),
    model: interrupted.configuration.model,
    agentRevision: interrupted.configuration.agentRevision,
    executionMode: patchPlan
      ? "verified_patch_recovery"
      : "safe_read_only_recovery",
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
    blockReason === "subagent_managed"
      ? "Subagent child Runs do not support generic recovery"
      : blockReason === "workflow_managed"
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
    !isSubagentChildRun(run) &&
    !isWorkflowRunSource(run.source) &&
    run.configuration &&
    modernRunConfiguration(run.configuration) &&
    ["safe_read_only", "verified_patches"].includes(
      run.configuration.automaticRecovery.mode,
    ) &&
    run.configuration.contentSha256 === assessment.runConfigurationSha256,
  );
}

/** Prepare deterministic recovery before model context or source continuation. */
export async function prepareAgentRunRecoveryStage(input: {
  store: PatchRecoveryExecutionStore;
  sandbox: OsSandboxAdapter;
  run: RunRecord;
  profile: AgentProfile;
  capabilities: {
    createTools(options: {
      profile: AgentProfile;
      threadId: string;
      runId: string;
      beforeWorkspaceWrite: () => Promise<void>;
    }): AgentTool[];
    prepareSourceContinuityGuidance(input: {
      owner: { threadId: string; runId: string };
      invocationSource: string;
      automaticRecovery: boolean;
      sourceContinuityRequired: boolean;
      sourceContinuityRunId: string | undefined;
      enabledTools: readonly string[];
      onEvent: EventSink | undefined;
    }): Promise<string>;
  };
  concurrencyGate: ToolConcurrencyGate;
  signal: AbortSignal;
  options: RunPromptOptions;
  agentProfile: AgentProfile;
}) {
  const {
    store,
    sandbox,
    run,
    profile,
    capabilities,
    concurrencyGate,
    signal,
    options,
    agentProfile,
  } = input;
  const patchRecoveryGuidance = await executeWorkspacePatchRecovery({
    store,
    sandbox,
    run,
    profile,
    concurrencyGate,
    signal,
    onEvent: options.onEvent,
    createTools: (beforeWorkspaceWrite) =>
      capabilities.createTools({
        profile,
        threadId: run.threadId,
        runId: run.id,
        beforeWorkspaceWrite,
      }),
  });
  const sourceContinuityGuidance =
    await capabilities.prepareSourceContinuityGuidance({
      owner: { threadId: run.threadId, runId: run.id },
      invocationSource: options.source ?? "user",
      automaticRecovery: options.recovery?.mode === "automatic",
      sourceContinuityRequired: options.sourceContinuityRunId !== undefined,
      sourceContinuityRunId: options.sourceContinuityRunId,
      enabledTools: agentProfile.enabledTools,
      onEvent: options.onEvent,
    });
  return { sourceContinuityGuidance, patchRecoveryGuidance };
}

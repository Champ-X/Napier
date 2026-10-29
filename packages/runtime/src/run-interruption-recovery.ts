import type { RunEvent } from "@napier/contracts";

import type { PatchInterruptionReconciliation } from "./workspace-patch-interruption-reconciliation.js";
export { RUN_EFFECT_INDETERMINATE_REASON } from "./run-lost-owner-recovery.js";
import { recoverLostRuns } from "./run-lost-owner-recovery.js";
import { deferredOperationHint, type DeferredOperationHint } from "./run-deferred-operation-recovery.js";
import { nowIso } from "./ids.js";
import { refreshRunAccounting } from "./model-accounting-projection.js";
import { interruptPlanRun } from "./plans.js";
import type { TerminalRunStatus } from "./run-event-admission.js";
import { runPlanProgressEventPayload } from "./run-progress-plan-state.js";
import {
  cancelTerminalRunInteractions,
  repairRunsFromTerminalEvidence,
  resetTerminalThreads,
  RUN_INTERRUPTION_REASON,
} from "./run-terminal-recovery.js";
import type {
  StoreRepositoryHost,
  StoreRepositoryState,
} from "./store-repository-host.js";

interface InterruptedPlanStep {
  threadId: string;
  planId: string;
  stepId: string;
  runId: string;
  blocker: string;
  progressPayload: ReturnType<typeof runPlanProgressEventPayload>;
}

interface InterruptedStateResult {
  changed: boolean;
  terminalEvents: RunEvent[];
  cancellationEvents: RunEvent[];
  planSteps: InterruptedPlanStep[];
  restartedRunIds: Set<string>;
  deferredOperations: DeferredOperationHint[];
}

export async function reconcileInterruptedRuns(
  host: StoreRepositoryHost,
  interruptActiveLeases = false,
  deferred?: readonly DeferredOperationHint[],
): Promise<DeferredOperationHint[]> {
  const timestamp = nowIso();
  let planSteps: InterruptedPlanStep[] = [];
  let deferredOperations: DeferredOperationHint[] = [];
  let restartedRunIds: Set<string> | undefined;
  await host.stateQueue.run(async () => {
    planSteps = []; deferredOperations = []; restartedRunIds = undefined;
    const reconciliations: PatchInterruptionReconciliation[] = [];
    try {
      const runIds = deferred && selectDeferredOperations(host, deferred);
      // A stale/terminal/live-owner hint never turns into a general startup scan.
      if (runIds?.size === 0) return;
      const result = await reconcileInterruptedState(
        host,
        timestamp,
        interruptActiveLeases,
        reconciliations,
        runIds,
      );
      planSteps = result.planSteps;
      deferredOperations = result.deferredOperations;
      restartedRunIds = result.restartedRunIds;
      if (result.changed) {
        await host.persistState([
          ...result.terminalEvents,
          ...result.cancellationEvents,
        ]);
      }
    } finally {
      for (const reconciliation of reconciliations)
        await reconciliation.release();
    }
  });
  if (!deferred || restartedRunIds?.size) await appendOrphanedSubagentRecoveryEvidence(host, deferred ? restartedRunIds : undefined);
  await appendInterruptedPlanEvidence(host, planSteps);
  return deferredOperations;
}

function selectDeferredOperations(host: StoreRepositoryHost, hints: readonly DeferredOperationHint[]): Set<string> {
  const selected = new Set<string>();
  for (const hint of hints) {
    const run = host.state.runs.find((value) => value.id === hint.runId);
    if (!run) continue;
    const current = deferredOperationHint(run, host.requireLedger().listRunEvents(run.id));
    if (current?.bindingSha256 === hint.bindingSha256) selected.add(run.id);
  }
  return selected;
}

async function reconcileInterruptedState(
  host: StoreRepositoryHost,
  timestamp: string,
  interruptActiveLeases: boolean,
  reconciliations: PatchInterruptionReconciliation[],
  runIds?: ReadonlySet<string>,
): Promise<InterruptedStateResult> {
  const durableTerminalRepairs = repairRunsFromTerminalEvidence(host, runIds);
  const recovery = await recoverLostRuns(
    host,
    timestamp,
    interruptActiveLeases,
    reconciliations,
    runIds,
  );
  const interruptedRunIds = new Set(recovery.interruptedRunIds);
  const restartedRunIds = new Set([
    ...recovery.interruptedRunIds,
    ...recovery.blockedSafetyRunIds,
  ]);
  for (const [runId, repair] of durableTerminalRepairs) {
    if (repair.status === "interrupted") {
      interruptedRunIds.add(runId);
      restartedRunIds.add(runId);
    }
  }
  const terminalStatuses = new Map<string, TerminalRunStatus>(
    [...durableTerminalRepairs].map(([runId, repair]) => [
      runId,
      repair.status,
    ]),
  );
  for (const runId of interruptedRunIds) {
    if (!terminalStatuses.has(runId))
      terminalStatuses.set(runId, "interrupted");
  }
  for (const runId of recovery.blockedSafetyRunIds) {
    terminalStatuses.set(runId, "failed");
  }
  let changed = terminalStatuses.size > 0;
  changed =
    failInterruptedDeliveries(host.state, restartedRunIds, timestamp, Boolean(runIds)) ||
    changed;
  const cancellationEvents = cancelTerminalRunInteractions(
    host,
    terminalStatuses,
  );
  changed =
    resetTerminalThreads(
      host,
      terminalStatuses,
      cancellationEvents,
      timestamp,
    ) || changed;
  changed =
    orphanInterruptedSubagents(host.state, restartedRunIds, timestamp) ||
    changed;
  const accountingRunIds = runIds && new Set([...restartedRunIds, ...host.state.runs
    .filter((run) => restartedRunIds.has(run.id) && run.parentRunId).map((run) => run.parentRunId!)]);
  changed = markTerminalParentsWithIncompleteChildUsage(host.state, accountingRunIds) || changed;
  for (const run of [...host.state.runs].sort((left, right) => Number(!!right.subagent) - Number(!!left.subagent))) {
    if (accountingRunIds && !accountingRunIds.has(run.id)) continue;
    if (run.accounting) changed = refreshRunAccounting(host, run.id, [...recovery.terminalEvents, ...cancellationEvents]) || changed;
  }
  const interruptedPlans = interruptActivePlanSteps(
    host.state,
    restartedRunIds,
  );
  changed = interruptedPlans.changed || changed;
  if (!runIds) changed = disconnectOpeningExtensions(host.state, timestamp) || changed;
  return {
    changed,
    terminalEvents: recovery.terminalEvents,
    cancellationEvents,
    planSteps: interruptedPlans.steps,
    restartedRunIds,
    deferredOperations: recovery.deferredOperations,
  };
}

function failInterruptedDeliveries(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
  timestamp: string,
  scoped = false,
): boolean {
  let changed = false;
  for (const delivery of state.inboundDeliveries) {
    if (delivery.status !== "running") continue;
    const attemptTriggerId =
      delivery.attemptCount <= 1
        ? delivery.triggerId
        : `${delivery.triggerId}:attempt:${delivery.attemptCount}`;
    if (scoped && !state.runs.some((run) => interruptedRunIds.has(run.id) &&
      (run.id === delivery.runId || run.triggerId === attemptTriggerId))) continue;
    const activeRun = state.runs.find(
      (run) =>
        (run.id === delivery.runId || run.triggerId === attemptTriggerId) &&
        (run.status === "queued" || run.status === "running"),
    );
    if (activeRun && !interruptedRunIds.has(activeRun.id)) continue;
    delivery.status = "failed";
    delivery.error = "Runtime restarted before the inbound delivery settled.";
    delivery.finishedAt = timestamp;
    delete delivery.nextAttemptAt;
    delivery.revision += 1;
    changed = true;
  }
  return changed;
}

function orphanInterruptedSubagents(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
  timestamp: string,
): boolean {
  let changed = false;
  for (const task of state.subagents) {
    if (
      !(interruptedRunIds.has(task.runId) || (task.childRunId && interruptedRunIds.has(task.childRunId))) ||
      (task.status !== "pending" && task.status !== "running")
    ) {
      continue;
    }
    task.status = "failed";
    task.stopReason = "error";
    task.supervisorStatus = "orphaned";
    task.error = task.childRunId && interruptedRunIds.has(task.childRunId)
      ? "Child run was interrupted by a runtime restart; child continuation is unavailable."
      : "Parent run was interrupted by a runtime restart.";
    task.finishedAt = timestamp;
    task.revision += 1;
    changed = true;
  }
  return changed;
}

function markTerminalParentsWithIncompleteChildUsage(state: StoreRepositoryState, runIds?: ReadonlySet<string>): boolean {
  let changed = false;
  for (const task of state.subagents) {
    if (runIds && !runIds.has(task.runId)) continue;
    if (!task.childRunId || task.usageStatus !== "incomplete") continue;
    const parent = state.runs.find((run) => run.id === task.runId);
    if (!parent || parent.status === "queued" || parent.status === "running" ||
        parent.usageStatus === "incomplete") continue;
    parent.usageStatus = "incomplete";
    changed = true;
  }
  return changed;
}

function interruptActivePlanSteps(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
): { changed: boolean; steps: InterruptedPlanStep[] } {
  const steps: InterruptedPlanStep[] = [];
  let changed = false;
  for (let index = 0; index < state.plans.length; index += 1) {
    const current = state.plans[index]!;
    let updated = current;
    for (const runId of interruptedRunIds) {
      const affected = updated.steps.filter(
        (step) => step.status === "running" && step.runId === runId,
      );
      if (affected.length === 0) continue;
      updated = interruptPlanRun(updated, runId, RUN_INTERRUPTION_REASON);
      steps.push(
        ...affected.map((step) => ({
          threadId: updated.threadId,
          planId: updated.id,
          stepId: step.id,
          runId,
          blocker: RUN_INTERRUPTION_REASON,
          progressPayload: runPlanProgressEventPayload(updated),
        })),
      );
    }
    if (updated.revision === current.revision) continue;
    state.plans[index] = updated;
    changed = true;
  }
  return { changed, steps };
}

function disconnectOpeningExtensions(
  state: StoreRepositoryState,
  timestamp: string,
): boolean {
  let changed = false;
  for (const extension of state.extensions) {
    if (extension.connection.status !== "connecting") continue;
    extension.connection = {
      status: "disconnected",
      toolCount: extension.tools.length,
      error: "Runtime restarted while the MCP connection was opening.",
    };
    extension.updatedAt = timestamp;
    extension.revision += 1;
    changed = true;
  }
  return changed;
}

async function appendOrphanedSubagentRecoveryEvidence(
  host: StoreRepositoryHost,
  runIds?: ReadonlySet<string>,
): Promise<void> {
  const orphanedRunIds = new Set(
    host.state.subagents
      .filter((task) => task.supervisorStatus === "orphaned" &&
        (!runIds || runIds.has(task.runId) || (task.childRunId && runIds.has(task.childRunId))))
      .map((task) => task.runId),
  );
  for (const run of host.state.runs.filter((candidate) =>
    orphanedRunIds.has(candidate.id),
  )) {
    await appendOrphanedSubagentEvidence(host, run.id, run.threadId);
  }
}

async function appendOrphanedSubagentEvidence(
  host: StoreRepositoryHost,
  runId: string,
  threadId: string,
): Promise<void> {
  const tasks = host.state.subagents.filter(
    (task) => task.runId === runId && task.supervisorStatus === "orphaned",
  );
  const currentEvents = await host.listEvents(threadId);
  for (const task of tasks) {
    if (hasOrphanedSubagentEvent(currentEvents, task.id)) continue;
    await host.appendEvent({
      threadId: task.threadId,
      runId: task.runId,
      type: "subagent.orphaned",
      category: "subagent",
      visibility: "user",
      payload: {
        taskId: task.id,
        role: task.role,
        description: task.description,
        status: task.status,
        stopReason: task.stopReason ?? "cancelled",
        error: task.error ?? "",
      },
    });
  }
}

function hasOrphanedSubagentEvent(events: RunEvent[], taskId: string): boolean {
  return events.some(
    (event) =>
      event.type === "subagent.orphaned" &&
      event.payload &&
      !Array.isArray(event.payload) &&
      typeof event.payload === "object" &&
      event.payload["taskId"] === taskId,
  );
}

async function appendInterruptedPlanEvidence(
  host: StoreRepositoryHost,
  steps: InterruptedPlanStep[],
): Promise<void> {
  for (const step of steps) {
    const events = await host.listEvents(step.threadId);
    if (hasBlockedPlanStepEvent(events, step)) continue;
    await host.appendEvent({
      threadId: step.threadId,
      runId: step.runId,
      type: "plan.step.blocked",
      category: "plan",
      visibility: "user",
      payload: {
        planId: step.planId,
        stepId: step.stepId,
        runId: step.runId,
        status: "blocked",
        blocker: step.blocker,
        evidence:
          "The step outcome is unknown and must be verified before reopening.",
        ...step.progressPayload,
      },
    });
  }
}

function hasBlockedPlanStepEvent(
  events: RunEvent[],
  step: InterruptedPlanStep,
): boolean {
  return events.some(
    (event) =>
      event.type === "plan.step.blocked" &&
      event.payload &&
      !Array.isArray(event.payload) &&
      typeof event.payload === "object" &&
      event.payload["planId"] === step.planId &&
      event.payload["stepId"] === step.stepId &&
      event.payload["runId"] === step.runId,
  );
}

import type { RunEvent } from "@napier/contracts";

import { nowIso, preserveRunLeaseOnStartup } from "./ids.js";
import { interruptPlanRun } from "./plans.js";
import { cancelPendingRunControlMessages } from "./run-lifecycle-cancellation.js";
import { transitionRunStatus } from "./run-state-machine.js";
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
}

interface InterruptedStateResult {
  changed: boolean;
  cancellationEvents: RunEvent[];
  planSteps: InterruptedPlanStep[];
}

const INTERRUPTION_REASON =
  "The runtime process exited or its renewable owner lease expired before this run reached a terminal state.";

export async function reconcileInterruptedRuns(
  host: StoreRepositoryHost,
  interruptActiveLeases = false,
): Promise<void> {
  const timestamp = nowIso();
  let planSteps: InterruptedPlanStep[] = [];
  await host.stateQueue.run(async () => {
    const result = reconcileInterruptedState(
      host,
      timestamp,
      interruptActiveLeases,
    );
    planSteps = result.planSteps;
    if (result.changed) await host.persistState(result.cancellationEvents);
  });
  await appendInterruptedRunEvidence(host, timestamp);
  await appendInterruptedPlanEvidence(host, planSteps);
}

function reconcileInterruptedState(
  host: StoreRepositoryHost,
  timestamp: string,
  interruptActiveLeases: boolean,
): InterruptedStateResult {
  const interruptedRunIds = interruptExpiredRuns(
    host.state,
    timestamp,
    interruptActiveLeases,
  );
  let changed = interruptedRunIds.size > 0;
  changed =
    failInterruptedDeliveries(host.state, interruptedRunIds, timestamp) ||
    changed;
  changed =
    resetInterruptedThreads(host.state, interruptedRunIds, timestamp) ||
    changed;
  const cancellationEvents = cancelInterruptedRunMessages(
    host,
    interruptedRunIds,
  );
  changed =
    orphanInterruptedSubagents(host.state, interruptedRunIds, timestamp) ||
    changed;
  const interruptedPlans = interruptActivePlanSteps(
    host.state,
    interruptedRunIds,
  );
  changed = interruptedPlans.changed || changed;
  changed = disconnectOpeningExtensions(host.state, timestamp) || changed;
  return { changed, cancellationEvents, planSteps: interruptedPlans.steps };
}

function interruptExpiredRuns(
  state: StoreRepositoryState,
  timestamp: string,
  interruptActiveLeases: boolean,
): Set<string> {
  const timestampMs = Date.parse(timestamp);
  const interrupted = new Set<string>();
  for (const run of state.runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    if (
      preserveRunLeaseOnStartup(
        run.lease,
        Boolean(run.leaseTokenSha256),
        timestampMs,
        interruptActiveLeases,
      )
    ) {
      continue;
    }
    transitionRunStatus(run, "interrupted");
    run.interruptedAt = timestamp;
    run.interruptionReason = INTERRUPTION_REASON;
    run.finishedAt = timestamp;
    run.error = INTERRUPTION_REASON;
    delete run.lease;
    delete run.leaseTokenSha256;
    interrupted.add(run.id);
  }
  return interrupted;
}

function failInterruptedDeliveries(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
  timestamp: string,
): boolean {
  let changed = false;
  for (const delivery of state.inboundDeliveries) {
    if (delivery.status !== "running") continue;
    const attemptTriggerId =
      delivery.attemptCount <= 1
        ? delivery.triggerId
        : `${delivery.triggerId}:attempt:${delivery.attemptCount}`;
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

function resetInterruptedThreads(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
  timestamp: string,
): boolean {
  let changed = false;
  for (const thread of state.threads) {
    const currentInterrupted =
      thread.currentRunId && interruptedRunIds.has(thread.currentRunId);
    const hasInterruptedRun = thread.runIds.some((runId) =>
      interruptedRunIds.has(runId),
    );
    if (
      !currentInterrupted &&
      !(thread.status === "running" && hasInterruptedRun)
    ) {
      continue;
    }
    if (currentInterrupted) delete thread.currentRunId;
    thread.status = "waiting";
    thread.updatedAt = timestamp;
    changed = true;
  }
  return changed;
}

function cancelInterruptedRunMessages(
  host: StoreRepositoryHost,
  interruptedRunIds: Set<string>,
): RunEvent[] {
  const events: RunEvent[] = [];
  for (const runId of interruptedRunIds) {
    const run = host.mutableRun(runId);
    const thread = host.mutableThread(run.threadId);
    events.push(
      ...cancelPendingRunControlMessages(
        host,
        thread,
        run.id,
        "run_interrupted_before_delivery",
      ),
    );
  }
  return events;
}

function orphanInterruptedSubagents(
  state: StoreRepositoryState,
  interruptedRunIds: Set<string>,
  timestamp: string,
): boolean {
  let changed = false;
  for (const task of state.subagents) {
    if (
      !interruptedRunIds.has(task.runId) ||
      (task.status !== "pending" && task.status !== "running")
    ) {
      continue;
    }
    task.status = "failed";
    task.stopReason = "error";
    task.supervisorStatus = "orphaned";
    task.error = "Parent run was interrupted by a runtime restart.";
    task.finishedAt = timestamp;
    task.revision += 1;
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
      updated = interruptPlanRun(updated, runId, INTERRUPTION_REASON);
      steps.push(
        ...affected.map((step) => ({
          threadId: updated.threadId,
          planId: updated.id,
          stepId: step.id,
          runId,
          blocker: INTERRUPTION_REASON,
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

async function appendInterruptedRunEvidence(
  host: StoreRepositoryHost,
  timestamp: string,
): Promise<void> {
  const interruptedRuns = host.state.runs.filter(
    (run) => run.status === "interrupted",
  );
  for (const run of interruptedRuns) {
    const events = await host.listEvents(run.threadId);
    if (!hasInterruptedRunEvent(events, run.id)) {
      await host.appendEvent({
        threadId: run.threadId,
        runId: run.id,
        type: "run.interrupted",
        category: "lifecycle",
        visibility: "user",
        payload: {
          status: "interrupted",
          reason: run.interruptionReason ?? INTERRUPTION_REASON,
          interruptedAt: run.interruptedAt ?? timestamp,
        },
      });
    }
    await appendOrphanedSubagentEvidence(host, run.id, run.threadId);
  }
}

function hasInterruptedRunEvent(events: RunEvent[], runId: string): boolean {
  return events.some(
    (event) => event.runId === runId && event.type === "run.interrupted",
  );
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

import type { RunEvent } from "@napier/contracts";

import { nowIso } from "./ids.js";
import { lostRunLeaseDisposition } from "./run-lease-loss.js";
import { interruptPlanRun } from "./plans.js";
import type { TerminalRunStatus } from "./run-event-admission.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { applyOutcome } from "./run-outcomes.js";
import { runPlanProgressEventPayload } from "./run-progress-plan-state.js";
import { transitionRunStatus } from "./run-state-machine.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { effectIndeterminateEventPayload } from "./tool-effect-indeterminate-event.js";
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
}

interface LostRunRecovery {
  interruptedRunIds: Set<string>;
  blockedSafetyRunIds: Set<string>;
  terminalEvents: RunEvent[];
}

export const RUN_EFFECT_INDETERMINATE_REASON =
  "The runtime owner became unavailable after a tool crossed its durable effect boundary; the external effect cannot be safely replayed or asserted complete.";

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
    if (result.changed) {
      await host.persistState([
        ...result.terminalEvents,
        ...result.cancellationEvents,
      ]);
    }
  });
  await appendOrphanedSubagentRecoveryEvidence(host);
  await appendInterruptedPlanEvidence(host, planSteps);
}

function reconcileInterruptedState(
  host: StoreRepositoryHost,
  timestamp: string,
  interruptActiveLeases: boolean,
): InterruptedStateResult {
  const durableTerminalRepairs = repairRunsFromTerminalEvidence(host);
  const recovery = recoverLostRuns(host, timestamp, interruptActiveLeases);
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
    failInterruptedDeliveries(host.state, restartedRunIds, timestamp) ||
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
  const interruptedPlans = interruptActivePlanSteps(
    host.state,
    restartedRunIds,
  );
  changed = interruptedPlans.changed || changed;
  changed = disconnectOpeningExtensions(host.state, timestamp) || changed;
  return {
    changed,
    terminalEvents: recovery.terminalEvents,
    cancellationEvents,
    planSteps: interruptedPlans.steps,
  };
}

function recoverLostRuns(
  host: StoreRepositoryHost,
  timestamp: string,
  interruptActiveLeases: boolean,
): LostRunRecovery {
  const timestampMs = Date.parse(timestamp);
  const interrupted = new Set<string>();
  const blockedSafety = new Set<string>();
  const terminalEvents: RunEvent[] = [];
  for (const run of host.state.runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    const disposition = lostRunLeaseDisposition(
      run.lease,
      Boolean(run.leaseTokenSha256),
      timestampMs,
      interruptActiveLeases,
    );
    if (!disposition) continue;
    const liveAuthorities = liveToolEffectAuthoritiesFromEvents(
      host.requireLedger().listRunEvents(run.id),
    );
    if (liveAuthorities.length > 0) {
      const recoverable = liveAuthorities.filter(
        (authority) => authority.current && authority.boundaryEvent,
      );
      // Corrupt or legacy histories with multiple live generations stay
      // fenced; recovery never invents authority for a non-current token.
      if (recoverable.length !== liveAuthorities.length) continue;
      const operationIds = [
        ...new Set(recoverable.map((authority) => authority.operationId)),
      ].sort();
      const markerInputs: AppendEventInput[] = recoverable.map((authority) => ({
        threadId: run.threadId,
        runId: run.id,
        type: "tool.operation.effect_indeterminate",
        category: "tool",
        visibility: "debug",
        payload: effectIndeterminateEventPayload({
          boundary: authority.boundaryEvent!,
          run,
          disposition,
          recoveredAt: timestamp,
        }),
      }));
      terminalEvents.push(
        ...host.appendEventsToThread(
          host.mutableThread(run.threadId),
          [
            ...markerInputs,
            {
              threadId: run.threadId,
              runId: run.id,
              type: "run.failed",
              category: "lifecycle",
              visibility: "user",
              payload: {
                status: "failed",
                outcome: "blocked_safety",
                reason: "effect_indeterminate",
                message: RUN_EFFECT_INDETERMINATE_REASON,
                operationIds,
              },
            },
          ],
          { createdAt: timestamp },
        ),
      );
      applyOutcome(run, "failed", "blocked_safety");
      run.finishedAt = timestamp;
      run.error = RUN_EFFECT_INDETERMINATE_REASON;
      delete run.lease;
      delete run.leaseTokenSha256;
      blockedSafety.add(run.id);
      continue;
    }
    terminalEvents.push(
      ...host.appendEventsToThread(
        host.mutableThread(run.threadId),
        [
          {
            threadId: run.threadId,
            runId: run.id,
            type: "run.interrupted",
            category: "lifecycle",
            visibility: "user",
            payload: {
              status: "interrupted",
              reason: RUN_INTERRUPTION_REASON,
              interruptedAt: timestamp,
            },
          },
        ],
        { createdAt: timestamp },
      ),
    );
    transitionRunStatus(run, "interrupted");
    run.interruptedAt = timestamp;
    run.interruptionReason = RUN_INTERRUPTION_REASON;
    run.finishedAt = timestamp;
    run.error = RUN_INTERRUPTION_REASON;
    delete run.lease;
    delete run.leaseTokenSha256;
    interrupted.add(run.id);
  }
  return {
    interruptedRunIds: interrupted,
    blockedSafetyRunIds: blockedSafety,
    terminalEvents,
  };
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
): Promise<void> {
  const orphanedRunIds = new Set(
    host.state.subagents
      .filter((task) => task.supervisorStatus === "orphaned")
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

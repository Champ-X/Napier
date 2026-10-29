import type { RunEvent, RunRecord, ThreadRecord } from "@napier/contracts";
import { lostRunLeaseDisposition } from "./run-lease-loss.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { applyOutcome } from "./run-outcomes.js";
import { transitionRunStatus } from "./run-state-machine.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { effectIndeterminateEventPayload } from "./tool-effect-indeterminate-event.js";
import { RUN_INTERRUPTION_REASON } from "./run-terminal-recovery.js";
import { reconcileInterruptedWorkspaceOperations } from "./workspace-operation-reconciliation.js";
import {
  type PatchInterruptionReconciliation,
} from "./workspace-patch-interruption-reconciliation.js";
interface LostRunRecoveryHost {
  workspaceRoot: string;
  dataRoot: string;
  state: { runs: Array<RunRecord & { leaseTokenSha256?: string }> };
  requireLedger(): { listRunEvents(runId: string): RunEvent[] };
  mutableThread(threadId: string): ThreadRecord;
  appendEventsToThread(
    thread: ThreadRecord,
    inputs: AppendEventInput[],
    options?: { createdAt?: string },
  ): RunEvent[];
}

interface LostRunRecovery {
  interruptedRunIds: Set<string>;
  blockedSafetyRunIds: Set<string>;
  terminalEvents: RunEvent[];
}

export const RUN_EFFECT_INDETERMINATE_REASON =
  "The runtime owner became unavailable after a tool crossed its durable effect boundary; the external effect cannot be safely replayed or asserted complete.";

export async function recoverLostRuns(
  host: LostRunRecoveryHost,
  timestamp: string,
  interruptActiveLeases: boolean,
  reconciliations: PatchInterruptionReconciliation[],
): Promise<LostRunRecovery> {
  const timestampMs = Date.parse(timestamp);
  const interrupted = new Set<string>();
  const blockedSafety = new Set<string>();
  const terminalEvents: RunEvent[] = [];
  for (const run of host.state.runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    const parent = run.source === "subagent"
      ? host.state.runs.find((candidate) => candidate.id === run.parentRunId)
      : undefined;
    const parentLost = parent && run.subagent?.parentConfigurationSha256 === parent.configuration?.contentSha256 &&
      ((parent.status !== "running" && parent.status !== "queued") || lostRunLeaseDisposition(
        parent.lease, Boolean(parent.leaseTokenSha256), timestampMs, interruptActiveLeases));
    const disposition = parentLost ? "run_owner_unavailable" : lostRunLeaseDisposition(
      run.lease,
      Boolean(run.leaseTokenSha256),
      timestampMs,
      interruptActiveLeases,
    );
    if (!disposition) continue;
    const events = host.requireLedger().listRunEvents(run.id);
    const liveAuthorities = liveToolEffectAuthoritiesFromEvents(events);
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
      const reconciliation = await reconcileInterruptedWorkspaceOperations({
        workspaceRoot: host.workspaceRoot,
        dataRoot: host.dataRoot,
        events,
        boundaries: recoverable.map((authority) => authority.boundaryEvent!),
      });
      reconciliations.push(reconciliation);
      // Contention can belong to a recoverer still holding both paths through
      // its atomic commit. Leave the original Run unknown; do not race that
      // owner with a terminal safety failure. A later recovery can inspect it.
      if (reconciliation.reason === "move_target_busy") continue;
      if (reconciliation.inputs.length === recoverable.length) {
        terminalEvents.push(
          ...host.appendEventsToThread(
            host.mutableThread(run.threadId),
            [
              ...markerInputs,
              ...reconciliation.inputs,
              {
                threadId: run.threadId,
                runId: run.id,
                type: "run.interrupted",
                category: "lifecycle",
                visibility: "user",
                payload: {
                  status: "interrupted",
                  reason: reconciliation.terminalReason,
                  interruptedAt: timestamp,
                  operationIds,
                },
              },
            ],
            { createdAt: timestamp },
          ),
        );
        transitionRunStatus(run, "interrupted");
        run.interruptedAt = timestamp;
        run.interruptionReason =
          "Workspace operation state reconciled; original executor fenced. Remaining work requires continuation.";
        run.finishedAt = timestamp;
        run.error = run.interruptionReason;
        delete run.lease;
        delete run.leaseTokenSha256;
        interrupted.add(run.id);
        continue;
      }
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
                reconciliationReason:
                  reconciliation.reason ?? "operation_reconciliation_unavailable",
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

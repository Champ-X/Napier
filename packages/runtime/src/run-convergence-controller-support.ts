import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { RunConvergencePolicy } from "./run-convergence-policy.js";
import {
  advancesRunDelivery,
  eventRunProgress,
  runProgressDefinition,
} from "./run-convergence-tool-progress.js";
import type {
  RunDirectiveDecision,
  RunDirectiveState,
} from "./run-progress-directive-types.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

const CONVERGENCE_STATE_SHAPES = [
  "open",
  "requested_pending",
  "requested_delivered",
  "active",
] as const;
const NO_PROGRESS_STATE_SHAPES = [
  "idle",
  "requested_pending",
  "requested_delivered",
  "repair_pending",
  "repair_delivered",
  "observability_degraded_pending",
  "observability_degraded_delivered",
  "halted_pending",
  "halted_delivered",
] as const;

/** Finite product of every materialized directive-state shape. */
export const RUN_DIRECTIVE_FIXED_POINT_STATE_LIMIT =
  CONVERGENCE_STATE_SHAPES.length * NO_PROGRESS_STATE_SHAPES.length;

export class RunDirectiveFixedPointGuard {
  private readonly evaluated = new Set<string>();

  prepare(state: RunDirectiveState, decision: RunDirectiveDecision): string {
    const key = sha256(
      canonicalJson({
        vectorSha256: decision.vector.contentSha256,
        decisionKind: decision.kind,
        controlEpochId: state.controlEpochId,
        convergence: convergenceStateShape(state),
        noProgress: noProgressStateShape(state),
      }),
    );
    if (this.evaluated.has(key)) {
      throw new Error("Run directive projection entered a state cycle");
    }
    if (this.evaluated.size >= RUN_DIRECTIVE_FIXED_POINT_STATE_LIMIT) {
      throw new Error(
        "Run directive projection exceeded its finite state space",
      );
    }
    return key;
  }

  commit(key: string): void {
    this.evaluated.add(key);
  }
}

function convergenceStateShape(state: RunDirectiveState): string {
  const convergence = state.convergence;
  return convergence.phase === "requested"
    ? `requested_${convergence.delivered ? "delivered" : "pending"}`
    : convergence.phase;
}

function noProgressStateShape(state: RunDirectiveState): string {
  const noProgress = state.noProgress;
  return noProgress.phase === "idle"
    ? "idle"
    : `${noProgress.phase}_${noProgress.delivered ? "delivered" : "pending"}`;
}

export function filterToolsForConvergence<T extends { name: string }>(input: {
  tools: T[];
  state: RunDirectiveState;
  registry: ToolProtocolRegistry;
  policy: Readonly<RunConvergencePolicy>;
  opaqueAdmissionsSinceClosure: number;
  latestTurnIndex: number;
}): T[] {
  const convergence = input.state.convergence;
  if (convergence.phase === "open") return input.tools;
  return input.tools.filter((tool) => {
    const progress = runProgressDefinition(input.registry, tool.name);
    if (progress.coverage === "opaque") {
      return (
        input.opaqueAdmissionsSinceClosure <
        input.policy.unclassifiedActivityLeaseTurns
      );
    }
    if (
      convergence.phase === "active" &&
      input.latestTurnIndex >= convergence.graceThroughTurn
    ) {
      return (
        progress.contributions.some(advancesRunDelivery) ||
        progress.operations.some(
          (operation) => operation !== "acquire" && operation !== "neutral",
        )
      );
    }
    return !(
      progress.operations.length > 0 &&
      progress.operations.every((operation) => operation === "acquire") &&
      !progress.contributions.some(advancesRunDelivery)
    );
  });
}

export function progressRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

export function progressInteger(
  value: JsonValue | undefined,
): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function opaqueAdmissionsInCurrentClosure(
  events: readonly RunEvent[],
): number {
  let count = 0;
  for (const event of events) {
    if (
      event.type === "run.control.delivered" ||
      event.type === "run.progress.operator_epoch" ||
      event.type === "run.progress.convergence_reopened"
    ) {
      count = 0;
      continue;
    }
    if (event.type === "run.progress.convergence_requested") {
      count = 0;
      continue;
    }
    if (
      event.type === "tool.admitted" &&
      eventRunProgress(progressRecord(event.payload))?.coverage === "opaque"
    ) {
      count += 1;
    }
  }
  return count;
}

export async function emitRunConvergenceEvent(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable directive evidence survives a disconnected event stream.
  }
}

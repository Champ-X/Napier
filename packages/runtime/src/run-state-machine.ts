import type {
  RegisteredRunEventType,
  RunRecord,
  RunStatus,
} from "@napier/contracts";

export type RunTransitionSource = RunStatus | "new";
export type RunTransitionDelivery = "at_most_once" | "exactly_once";

export interface RunTransitionDefinition {
  from: RunTransitionSource;
  to: RunStatus;
  durableEvent: RegisteredRunEventType;
  recoverable: boolean;
  cancellationBoundary: "before_start" | "while_running" | "settled";
  delivery: RunTransitionDelivery;
}

const ACTIVE_STATUSES = ["queued", "running"] as const;
const TERMINAL_TRANSITIONS = [
  ["completed", "run.completed", false, "exactly_once"],
  ["failed", "run.failed", false, "exactly_once"],
  ["cancelled", "run.cancelled", false, "at_most_once"],
  ["interrupted", "run.interrupted", true, "at_most_once"],
] as const;

export const RUN_TRANSITION_DEFINITIONS: readonly RunTransitionDefinition[] = [
  {
    from: "new",
    to: "running",
    durableEvent: "run.started",
    recoverable: true,
    cancellationBoundary: "before_start",
    delivery: "exactly_once",
  },
  {
    from: "queued",
    to: "running",
    durableEvent: "run.started",
    recoverable: true,
    cancellationBoundary: "before_start",
    delivery: "exactly_once",
  },
  ...ACTIVE_STATUSES.flatMap((from) =>
    TERMINAL_TRANSITIONS.map(
      ([to, durableEvent, recoverable, delivery]): RunTransitionDefinition => ({
        from,
        to,
        durableEvent,
        recoverable,
        cancellationBoundary:
          from === "queued" ? "before_start" : "while_running",
        delivery,
      }),
    ),
  ),
];

export class RunStateTransitionError extends Error {
  constructor(
    readonly from: RunTransitionSource,
    readonly to: RunStatus,
  ) {
    super(`Run status transition is invalid: ${from} -> ${to}`);
    this.name = "RunStateTransitionError";
  }
}

export function initialRunStatus(): "running" {
  requireRunTransition("new", "running");
  return "running";
}

export function transitionRunStatus(
  run: Pick<RunRecord, "status">,
  status: RunStatus,
): RunTransitionDefinition {
  const transition = requireRunTransition(run.status, status);
  run.status = status;
  return transition;
}

export function requireRunTransition(
  from: RunTransitionSource,
  to: RunStatus,
): RunTransitionDefinition {
  const transition = RUN_TRANSITION_DEFINITIONS.find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  if (!transition) throw new RunStateTransitionError(from, to);
  return transition;
}

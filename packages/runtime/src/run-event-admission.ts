import {
  RUN_TERMINAL_EVENT_TYPES_V1,
  type RunEvent,
  type RunEventAdmissionPolicyV1,
  type RunStatus,
} from "@napier/contracts";
import type { ResolvedRunEventInput } from "./run-event-registry.js";
import { RUN_TRANSITION_DEFINITIONS } from "./run-state-machine.js";

export const RUN_TERMINAL_EVENT_TYPES = RUN_TERMINAL_EVENT_TYPES_V1;

export type TerminalRunStatus = Extract<
  RunStatus,
  "completed" | "failed" | "cancelled" | "interrupted"
>;

const TERMINAL_STATUS_BY_EVENT = new Map<string, TerminalRunStatus>(
  RUN_TRANSITION_DEFINITIONS.filter(
    (transition) => transition.from === "running",
  ).map((transition) => [
    transition.durableEvent,
    transition.to as TerminalRunStatus,
  ]),
);

interface RunEventAdmissionRun {
  threadId: string;
  status: RunStatus;
}

export class RunEventAdmissionError extends Error {
  readonly status: RunStatus | "missing";

  constructor(
    status: RunStatus | "missing",
    readonly eventType?: string,
  ) {
    super(
      `Run event${eventType ? ` ${eventType}` : ""} admission rejected because the Run is not active`,
    );
    this.name = "RunEventAdmissionError";
    this.status = status;
  }
}

export class RunTerminalEventConflictError extends Error {
  constructor(
    readonly requestedStatus: TerminalRunStatus,
    readonly existingStatus: RunStatus | "missing",
  ) {
    super(
      `Run terminal event ${requestedStatus} conflicts with existing Run terminal state ${existingStatus}`,
    );
    this.name = "RunTerminalEventConflictError";
  }
}

export function assertRunEventAdmission(
  input: Pick<ResolvedRunEventInput, "admission" | "threadId" | "type">,
  run: RunEventAdmissionRun | undefined,
  terminalStatus?: TerminalRunStatus,
): void {
  if (input.admission === "run_any") return;
  const runMatches = run?.threadId === input.threadId;
  if (input.admission === "terminal_transition") {
    const requestedStatus = terminalRunStatusFromEventType(input.type);
    if (!requestedStatus) {
      throw new Error(
        `Run terminal transition admission is invalid for ${input.type}`,
      );
    }
    if (terminalStatus) {
      throw new RunTerminalEventConflictError(requestedStatus, terminalStatus);
    }
    if (
      runMatches &&
      (run.status === "queued" ||
        run.status === "running" ||
        run.status === requestedStatus)
    ) {
      return;
    }
    throw new RunTerminalEventConflictError(
      requestedStatus,
      run?.status ?? "missing",
    );
  }
  if (
    !terminalStatus &&
    runMatches &&
    (run.status === "queued" || run.status === "running")
  )
    return;
  throw new RunEventAdmissionError(
    terminalStatus ?? run?.status ?? "missing",
    input.type,
  );
}

export function assertDurableRunEventAdmission(
  admission: RunEventAdmissionPolicyV1,
  eventType: string,
  run: RunEventAdmissionRun | undefined,
  threadId: string,
  terminalStatus?: TerminalRunStatus,
): void {
  assertRunEventAdmission(
    {
      threadId,
      type: eventType,
      admission,
    },
    run,
    terminalStatus,
  );
}

export function terminalRunStatusFromEventType(
  type: string,
): TerminalRunStatus | undefined {
  return TERMINAL_STATUS_BY_EVENT.get(type);
}

/** The first durable terminal event is the Run's execution-admission fence. */
export function durableTerminalRunStatus(
  events: readonly Pick<RunEvent, "runId" | "threadId" | "type" | "seq">[],
  threadId: string,
  runId: string,
): TerminalRunStatus | undefined {
  const ordered = [...events].sort(
    (left, right) =>
      left.seq - right.seq || left.type.localeCompare(right.type),
  );
  for (const event of ordered) {
    if (event.threadId !== threadId || event.runId !== runId) continue;
    const status = terminalRunStatusFromEventType(event.type);
    if (status) return status;
  }
  return undefined;
}

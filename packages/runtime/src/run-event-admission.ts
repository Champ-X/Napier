import type {
  EventCategory,
  EventVisibility,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

export interface AppendEventInput {
  threadId: string;
  runId: string;
  type: string;
  category: EventCategory;
  visibility?: EventVisibility;
  payload: JsonValue;
  admission?: "run_active";
}

export class RunEventAdmissionError extends Error {
  readonly status: RunRecord["status"] | "missing";

  constructor(status: RunRecord["status"] | "missing") {
    super("Run event admission rejected because the Run is not active");
    this.name = "RunEventAdmissionError";
    this.status = status;
  }
}

export function assertRunEventAdmission(
  input: AppendEventInput,
  run: RunRecord | undefined,
): void {
  if (input.admission !== "run_active") return;
  if (
    run?.threadId === input.threadId &&
    (run.status === "queued" || run.status === "running")
  ) {
    return;
  }
  throw new RunEventAdmissionError(run?.status ?? "missing");
}

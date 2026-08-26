import type { RunStatus } from "@napier/contracts";
import type { ResolvedRunEventInput } from "./run-event-registry.js";

interface RunEventAdmissionRun {
  threadId: string;
  status: RunStatus;
}

export class RunEventAdmissionError extends Error {
  readonly status: RunStatus | "missing";

  constructor(status: RunStatus | "missing") {
    super("Run event admission rejected because the Run is not active");
    this.name = "RunEventAdmissionError";
    this.status = status;
  }
}

export function assertRunEventAdmission(
  input: ResolvedRunEventInput,
  run: RunEventAdmissionRun | undefined,
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
